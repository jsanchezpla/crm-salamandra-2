import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { getMasterModels } from "@/lib/db/masterDb.js";
import { getTenantIaModel, getTenantProveedorIa } from "@/lib/ai/proveedorIa.js";
import { estadoDelTope, leerTope } from "@/lib/ai/topeDeGasto.js";

/**
 * GET /api/tenant/ia/consumo — cuánto lleva gastado este tenant en IA
 * (11/09/2026), estimado con los precios públicos de `lib/ai/precios.js`.
 *
 * Solo administradores: es la misma pantalla en la que se pone la clave.
 * Devuelve el mes en curso y el anterior (hora de Madrid), en total y por
 * acción, más desde cuándo hay datos: la tabla `master.ai_uso` empezó a
 * llenarse el día que se desplegó, así que el primer mes va incompleto y la
 * pantalla lo dice.
 *
 * Respuesta: { proveedor, modelo, desdeCuando, mes: Tramo, anterior: Tramo,
 *             tope, personasSinAdmin }
 *   (`proveedor` y `modelo` son los que redactan HOY, `lib/ai/proveedorIa.js`;
 *   las filas del mes pueden ser de los dos si se cambió a mitad)
 *   Tramo = { desde, hasta, total: { llamadas, reutilizadas, fallidas, costeUsd,
 *             minutosAudio, tokensEntrada, tokensSalida }, porAccion: [...],
 *             fallos: [{ causa, llamadas, ultima }] }
 *
 * Desde el 14/09/2026 `master.ai_uso` guarda también las llamadas que FALLAN
 * (`registrarFallo`, `lib/ai/usoDeIA.js`), a coste 0 y con la causa en
 * `error`. `llamadas` y `reutilizadas` son solo las que respondieron
 * (`error IS NULL`); las fallidas se cuentan aparte (`total.fallidas`, y por
 * causa en `fallos`, con `causa` una clave de `CAUSAS_DE_FALLO`). Una acción
 * con solo fallos suma al total pero no entra en `porAccion`: saldría «0 · 0,00 $».
 * Necesita la columna `error` (`scripts/migrate-ai-uso.js`, antes del despliegue);
 * si falta (42703), contesta como antes, sin fallidas, y lo dice en los logs.
 *
 * Desde el 14/09/2026 lleva también el TOPE mensual de gasto
 * (`lib/ai/topeDeGasto.js`): `tope` es `estadoDelTope` sobre el total del mes
 * —el mismo número que frena en `vetoAi`, con la misma frontera de mes— o
 * `null` sin tope; `personasSinAdmin` es a cuántas personas frenaría al 100 %
 * (solo el número, o `null` si no se pudo contar). La suma del freno no está
 * redondeada y esta sí (4 decimales): en la frontera pueden diferir en menos
 * de 0,0001 $, y se acepta.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

// El mes `:mesesAtras` (0 = el que corre), en hora de Madrid.
const DEL_MES = `
    AND created_at >= (date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid') - (:mesesAtras || ' months')::interval) AT TIME ZONE 'Europe/Madrid')
    AND created_at <  (date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid') - (:mesesAtras || ' months')::interval + interval '1 month') AT TIME ZONE 'Europe/Madrid')
`;

/*
 * `conError = false` es la tabla de antes del 14/09/2026, sin la columna: si se
 * despliega sin haber lanzado la migración, la tarjeta no se esconde (el
 * componente calla un 500): enseña el consumo de siempre, sin las fallidas.
 */
const sqlTramo = (conError) => {
  const error = conError ? "error" : "NULL::text";
  return `
  SELECT proveedor, accion,
         count(*) FILTER (WHERE ${error} IS NULL)::int AS llamadas,
         count(*) FILTER (WHERE ${error} IS NULL AND cacheado)::int AS reutilizadas,
         count(*) FILTER (WHERE ${error} IS NOT NULL)::int AS fallidas,
         coalesce(sum(coste_usd), 0)::float AS coste_usd,
         coalesce(sum(segundos_audio), 0)::int AS segundos_audio,
         coalesce(sum(input_tokens + cache_write_tokens + cache_read_tokens), 0)::bigint AS tokens_entrada,
         coalesce(sum(output_tokens), 0)::bigint AS tokens_salida
  FROM master.ai_uso
  WHERE tenant_id = :tenantId
  ${DEL_MES}
  GROUP BY 1, 2
  ORDER BY coste_usd DESC, llamadas DESC
`;
};

// Por qué fallaron las que fallaron (14/09/2026): la causa, cuántas y la última.
const SQL_FALLOS = `
  SELECT error AS causa, count(*)::int AS llamadas,
         to_char(max(created_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS ultima
  FROM master.ai_uso
  WHERE tenant_id = :tenantId AND error IS NOT NULL
  ${DEL_MES}
  GROUP BY 1
  ORDER BY 2 DESC, 3 DESC
`;

const SQL_LIMITES = `
  SELECT to_char(date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid') - (:mesesAtras || ' months')::interval), 'YYYY-MM-DD') AS desde,
         to_char(date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid') - (:mesesAtras || ' months')::interval + interval '1 month') - interval '1 day', 'YYYY-MM-DD') AS hasta
`;

async function tramo(sequelize, tenantId, mesesAtras, conError = true) {
  const [[limites]] = await sequelize.query(SQL_LIMITES, { replacements: { mesesAtras: String(mesesAtras) } });
  const replacements = { tenantId, mesesAtras: String(mesesAtras) };
  const [[filas], [filasFallos]] = await Promise.all([
    sequelize.query(sqlTramo(conError), { replacements }),
    conError ? sequelize.query(SQL_FALLOS, { replacements }) : [[]],
  ]);
  const total = { llamadas: 0, reutilizadas: 0, fallidas: 0, costeUsd: 0, minutosAudio: 0, tokensEntrada: 0, tokensSalida: 0 };
  const porAccion = [];
  for (const f of filas) {
    total.llamadas += f.llamadas;
    total.reutilizadas += f.reutilizadas;
    total.fallidas += f.fallidas;
    total.costeUsd += Number(f.coste_usd);
    total.minutosAudio += f.segundos_audio / 60;
    total.tokensEntrada += Number(f.tokens_entrada);
    total.tokensSalida += Number(f.tokens_salida);
    // Solo fallos: cuenta en el total, no en «en qué se va» (14/09/2026).
    if (f.llamadas === 0) continue;
    porAccion.push({
      proveedor: f.proveedor,
      // Sin etiqueta, lo único que distingue a Whisper es que trae audio:
      // desde el 12/09/2026 OpenAI también redacta.
      accion: f.accion ?? (f.segundos_audio > 0 ? "transcribir audio" : "otros usos"),
      llamadas: f.llamadas,
      reutilizadas: f.reutilizadas,
      fallidas: f.fallidas,
      costeUsd: Math.round(Number(f.coste_usd) * 10000) / 10000,
      minutosAudio: Math.round((f.segundos_audio / 60) * 10) / 10,
    });
  }
  total.costeUsd = Math.round(total.costeUsd * 10000) / 10000;
  total.minutosAudio = Math.round(total.minutosAudio * 10) / 10;
  const fallos = filasFallos.map((f) => ({ causa: f.causa, llamadas: f.llamadas, ultima: f.ultima }));
  return { desde: limites.desde, hasta: limites.hasta, total, porAccion, fallos };
}

const codigoPg = (err) => err?.original?.code ?? err?.parent?.code;

export const GET = withTenant(async (request, rc, ctx) => {
  try {
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo administradores");
    // Cualquier modelo lleva su instancia: así no depende de la forma exacta de
    // lo que devuelve `getMasterModels()`.
    const { AiUso } = getMasterModels();
    const sequelize = AiUso.sequelize;
    const tenantId = ctx.tenant.id;
    const [[primera]] = await sequelize.query(
      `SELECT to_char(min(created_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS desde FROM master.ai_uso WHERE tenant_id = :tenantId`,
      { replacements: { tenantId } }
    );
    const tramos = (conError) => Promise.all([tramo(sequelize, tenantId, 0, conError), tramo(sequelize, tenantId, 1, conError)]);
    let mes, anterior;
    try {
      [mes, anterior] = await tramos(true);
    } catch (err) {
      // 42703: falta la columna `error` (desplegado sin `scripts/migrate-ai-uso.js`).
      if (codigoPg(err) !== "42703") throw err;
      console.warn("[ia:consumo] master.ai_uso sin la columna error: falta lanzar scripts/migrate-ai-uso.js; se enseña sin las fallidas");
      [mes, anterior] = await tramos(false);
    }
    // El tope (14/09/2026, ver cabecera).
    const guardado = leerTope(ctx.tenant.settings?.integrations);
    const tope = guardado ? estadoDelTope({ gastadoUsd: mes.total.costeUsd, tope: guardado }) : null;
    let personasSinAdmin = null;
    try {
      const { User } = getMasterModels();
      personasSinAdmin = await User.count({ where: { tenantId, role: { [Op.notIn]: ["admin", "superadmin"] } } });
    } catch (err) {
      // Sin el número la tarjeta lo dice en genérico; no se esconde el consumo.
      console.warn("[ia:consumo] no se pudo contar quién no es admin:", err?.message);
    }
    return ok({
      proveedor: getTenantProveedorIa(ctx),
      modelo: getTenantIaModel(ctx),
      desdeCuando: primera?.desde ?? null,
      mes,
      anterior,
      tope,
      personasSinAdmin,
    });
  } catch (err) {
    // Sin la tabla migrada (42P01) la pantalla no debe caerse: se contesta vacío.
    if (codigoPg(err) === "42P01") {
      return ok({ proveedor: getTenantProveedorIa(ctx), modelo: getTenantIaModel(ctx), desdeCuando: null, mes: null, anterior: null, tope: null, personasSinAdmin: null, sinTabla: true });
    }
    return serverError(err);
  }
});
