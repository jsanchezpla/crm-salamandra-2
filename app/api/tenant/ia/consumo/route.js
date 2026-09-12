import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "@/lib/utils/apiResponse.js";
import { getMasterModels } from "@/lib/db/masterDb.js";
import { getTenantIaModel, getTenantProveedorIa } from "@/lib/ai/proveedorIa.js";

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
 * Respuesta: { proveedor, modelo, desdeCuando, mes: Tramo, anterior: Tramo }
 *   (`proveedor` y `modelo` son los que redactan HOY, `lib/ai/proveedorIa.js`;
 *   las filas del mes pueden ser de los dos si se cambió a mitad)
 *   Tramo = { desde, hasta, total: { llamadas, reutilizadas, costeUsd,
 *             minutosAudio, tokensEntrada, tokensSalida }, porAccion: [...] }
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

const SQL_TRAMO = `
  SELECT proveedor, accion,
         count(*)::int AS llamadas,
         count(*) FILTER (WHERE cacheado)::int AS reutilizadas,
         coalesce(sum(coste_usd), 0)::float AS coste_usd,
         coalesce(sum(segundos_audio), 0)::int AS segundos_audio,
         coalesce(sum(input_tokens + cache_write_tokens + cache_read_tokens), 0)::bigint AS tokens_entrada,
         coalesce(sum(output_tokens), 0)::bigint AS tokens_salida
  FROM master.ai_uso
  WHERE tenant_id = :tenantId
    AND created_at >= (date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid') - (:mesesAtras || ' months')::interval) AT TIME ZONE 'Europe/Madrid')
    AND created_at <  (date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid') - (:mesesAtras || ' months')::interval + interval '1 month') AT TIME ZONE 'Europe/Madrid')
  GROUP BY 1, 2
  ORDER BY coste_usd DESC, llamadas DESC
`;

const SQL_LIMITES = `
  SELECT to_char(date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid') - (:mesesAtras || ' months')::interval), 'YYYY-MM-DD') AS desde,
         to_char(date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid') - (:mesesAtras || ' months')::interval + interval '1 month') - interval '1 day', 'YYYY-MM-DD') AS hasta
`;

async function tramo(sequelize, tenantId, mesesAtras) {
  const [[limites]] = await sequelize.query(SQL_LIMITES, { replacements: { mesesAtras: String(mesesAtras) } });
  const [filas] = await sequelize.query(SQL_TRAMO, { replacements: { tenantId, mesesAtras: String(mesesAtras) } });
  const total = { llamadas: 0, reutilizadas: 0, costeUsd: 0, minutosAudio: 0, tokensEntrada: 0, tokensSalida: 0 };
  const porAccion = [];
  for (const f of filas) {
    total.llamadas += f.llamadas;
    total.reutilizadas += f.reutilizadas;
    total.costeUsd += Number(f.coste_usd);
    total.minutosAudio += f.segundos_audio / 60;
    total.tokensEntrada += Number(f.tokens_entrada);
    total.tokensSalida += Number(f.tokens_salida);
    porAccion.push({
      proveedor: f.proveedor,
      // Sin etiqueta, lo único que distingue a Whisper es que trae audio:
      // desde el 12/09/2026 OpenAI también redacta.
      accion: f.accion ?? (f.segundos_audio > 0 ? "transcribir audio" : "otros usos"),
      llamadas: f.llamadas,
      reutilizadas: f.reutilizadas,
      costeUsd: Math.round(Number(f.coste_usd) * 10000) / 10000,
      minutosAudio: Math.round((f.segundos_audio / 60) * 10) / 10,
    });
  }
  total.costeUsd = Math.round(total.costeUsd * 10000) / 10000;
  total.minutosAudio = Math.round(total.minutosAudio * 10) / 10;
  return { desde: limites.desde, hasta: limites.hasta, total, porAccion };
}

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
    const [mes, anterior] = await Promise.all([tramo(sequelize, tenantId, 0), tramo(sequelize, tenantId, 1)]);
    return ok({ proveedor: getTenantProveedorIa(ctx), modelo: getTenantIaModel(ctx), desdeCuando: primera?.desde ?? null, mes, anterior });
  } catch (err) {
    // Sin la tabla migrada (42P01) la pantalla no debe caerse: se contesta vacío.
    if (err?.original?.code === "42P01" || err?.parent?.code === "42P01") {
      return ok({ proveedor: getTenantProveedorIa(ctx), modelo: getTenantIaModel(ctx), desdeCuando: null, mes: null, anterior: null, sinTabla: true });
    }
    return serverError(err);
  }
});
