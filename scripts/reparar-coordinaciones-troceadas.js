/**
 * reparar-coordinaciones-troceadas.js — las actas de coordinación escritas a
 * mano que se guardaron partidas en cada coma (13/09/2026, Aumenta).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 * Cuando se haya ejecutado de verdad y comprobado, se mueve a `scripts/_hechos/`.
 *
 * ── QUÉ PASÓ ───────────────────────────────────────────────────────────────
 * Hasta el 13/09/2026 el POST de `app/api/clinica/coordinations` hacía
 * `split(",")` sobre Temas, Acuerdos y Próximos pasos. «Reforzar pautas en
 * casa, revisar en un mes» se guardaba como DOS acuerdos. En producción, el
 * 100 % de lo escrito a mano: 3 actas de Aumenta (del 09/09 al 11/09), con 31
 * trozos de acuerdos, 14 de próximos pasos y 19 de temas. Las 695 importadas de
 * Organízate no pasaron por ese POST y están bien. Desde el arreglo, el POST
 * parte por LÍNEAS (`lib/clinica/actaCoordinacion.js`).
 *
 * ── LO QUE HACE ────────────────────────────────────────────────────────────
 * Para cada acta que (1) tiene auditoría `clinica.coordination.created` ANTES
 * de `--antes` —solo las que entraron por el POST viejo—, (2) no es importada
 * (`ai_transcription` vacío) y (3) NO tiene ya una auditoría
 * `clinica.coordination.repaired`, recompone `topics`, `agreements` y
 * `next_actions` con `repararTroceado`: vuelve a unir con ", " y parte por las
 * líneas. `participants` no se toca (ahí la coma sí separa).
 *
 * El punto (3) es el FRENO: `repararTroceado` no es idempotente —sobre un acta
 * ya reparada uniría sus líneas en una—, así que una segunda pasada estropearía
 * lo que arregló la primera. Relanzar la simulación después tiene que decir
 * «0 actas por reparar».
 *
 * Y una RED por debajo de los dos frenos (`--antes` y la auditoría): se salta
 * el acta en la que algún punto ya lleva coma. Un `split(",")` nunca dejó un
 * trozo con coma, así que esa acta vino del POST nuevo, ya se reparó o entró
 * por API como array. Sale en la simulación como «SALTADA», sin texto. No cubre
 * un acta nueva sin ninguna coma: para esa, el freno es `--antes`.
 *
 * ── LO QUE NO PUEDE DEVOLVER ───────────────────────────────────────────────
 * · donde se escribió «a,b» queda «a, b»;
 * · una línea que acababa en coma («Punto uno,⏎Punto dos») queda como UN punto:
 *   el trim del split viejo se comió ese salto;
 * · un acta que alguien mandara por API como ARRAY sin ninguna coma (no desde
 *   la pantalla) se uniría con comas: por eso la simulación enseña los
 *   recuentos por acta antes.
 * No se pierde texto.
 *
 * ── LO QUE NO SE PIERDE ────────────────────────────────────────────────────
 * Con `--confirm`, ANTES de escribir se guarda en `--copia` (por defecto
 * `/tmp/coordinaciones-troceadas-<ms>.json`, permisos 600) cómo estaban los
 * tres campos de cada acta. Nunca bajo `/app`: en el contenedor el proceso es
 * `nextjs` y `/app` es de root y no está montado (ver `lib/provisioning/bajaTenant.js`,
 * `escribirRed`). `/tmp` del contenedor desaparece con el siguiente `deploy.sh`:
 * se borra a mano cuando esté comprobado. En `master.audit_logs` queda una fila
 * por acta con SOLO los recuentos, sin texto clínico.
 *
 * Tenants: los de `master.tenants` con `status = 'active'` (regla 12: un arreglo
 * de datos mira el estado, como los backfills), o el de `--tenant`. Ningún slug
 * escrito a mano.
 *
 * Uso:
 *   node --env-file=.env.local scripts/reparar-coordinaciones-troceadas.js --antes 2026-09-14
 *   docker exec -it crm-salamandra-app-1 node scripts/reparar-coordinaciones-troceadas.js --antes <fecha del despliegue> [--tenant aumenta]
 *   docker exec -it crm-salamandra-app-1 node scripts/reparar-coordinaciones-troceadas.js --antes <fecha del despliegue> --confirm [--copia /tmp/x.json]
 *
 * `--antes` es OBLIGATORIO: cuándo se desplegó el arreglo. Sin él no existe el
 * filtro «de antes del arreglo». Vale AAAA-MM-DD (= 00:00 UTC de ese día, las
 * 02:00 en Madrid en verano) o AAAA-MM-DDTHH:MM con zona OBLIGATORIA
 * (`2026-09-14T10:32+02:00`, o `Z`): la hora que enseñan `date` o `git log` en
 * el VPS es de Madrid y la base compara en UTC, así que sin zona se rechaza.
 * Ante la duda, una hora ANTES del despliegue: lo que quede fuera no se estropea,
 * solo se queda sin reparar.
 * `--copia`, si se pasa, tiene que ser una ruta ABSOLUTA fuera de `/app`.
 */

import { writeFileSync } from "node:fs";
import { isAbsolute, posix, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { repararTroceado } from "../lib/clinica/actaCoordinacion.js";

const USO =
  "uso: --antes AAAA-MM-DD | AAAA-MM-DDTHH:MM+02:00 (obligatorio: cuándo se desplegó el arreglo; con hora, la zona también) [--tenant <slug>] [--confirm] [--copia /tmp/ruta.json]";

// Con hora, la zona es OBLIGATORIA: la sesión de Sequelize va en UTC y el
// contenedor en Europe/Madrid; «10:32» sin zona cortaría dos horas tarde y
// metería como candidatas actas ya guardadas con el POST nuevo.
const FECHA_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2}))?$/;

/** Lee los argumentos. Devuelve `{ error }` si falta algo o no vale. */
export function leerArgumentos(argv) {
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] ?? null : null);
  const antes = arg("--antes");
  const dia = antes?.slice(0, 10);
  if (
    !antes ||
    !FECHA_RE.test(antes) ||
    Number.isNaN(new Date(antes).getTime()) ||
    // V8 da por buena «2026-02-30» (la pasa al 2 de marzo): el día tiene que existir.
    new Date(`${dia}T00:00:00Z`).toISOString().slice(0, 10) !== dia
  ) {
    return { error: "Falta --antes o no es una fecha válida (AAAA-MM-DD, o AAAA-MM-DDTHH:MM con zona: Z o +02:00)." };
  }
  const tenant = arg("--tenant");
  if (argv.includes("--tenant") && !/^[a-z0-9_]+$/.test(tenant ?? "")) {
    return { error: "--tenant no es un slug válido." };
  }
  let copia = `/tmp/coordinaciones-troceadas-${Date.now()}.json`;
  if (argv.includes("--copia")) {
    copia = arg("--copia");
    // Una ruta relativa acabaría en el cwd (`/app` en el contenedor, la raíz del
    // repo en local, a tiro de un `git add` con texto clínico); «--copia --confirm»
    // se llamaría «--confirm» y además activaría el modo real.
    if (!copia || copia.startsWith("--") || !isAbsolute(copia)) {
      return { error: "--copia tiene que ser una ruta absoluta (p. ej. /tmp/copia.json)." };
    }
  }
  const resuelta = posix.resolve(copia);
  if (resuelta === "/app" || resuelta.startsWith("/app/")) {
    return { error: "--copia no puede ir bajo /app (en el contenedor no se puede escribir ahí y no sobrevive al deploy)." };
  }
  return {
    antes,
    // Lo que va a SQL: un instante sin ambigüedad. Solo fecha = 00:00 UTC de ese día.
    antesUtc: new Date(antes).toISOString(),
    tenant,
    confirm: argv.includes("--confirm"),
    copia,
  };
}

const CAMPOS = ["topics", "agreements", "nextActions"];

/**
 * ¿Algún punto de temas, acuerdos o próximos pasos lleva coma? Un `split(",")`
 * nunca pudo dejar un trozo con coma: si lo hay, el acta vino del POST nuevo, ya
 * se reparó o llegó por API como array. En los tres casos repararla la estropea.
 */
export function algunTrozoConComa(fila) {
  return CAMPOS.some((c) => Array.isArray(fila[c]) && fila[c].some((x) => typeof x === "string" && x.includes(",")));
}

/**
 * Qué le pasaría a UNA acta. `null` si ningún campo cambia o si algún punto lleva
 * coma (`algunTrozoConComa`: red por debajo de `--antes` y de la auditoría
 * `repaired`). Solo recompone topics, agreements y nextActions; participants no
 * se toca.
 */
export function planDeFila(fila) {
  if (algunTrozoConComa(fila)) return null;
  const campos = CAMPOS;
  const viejo = {};
  const nuevo = {};
  for (const c of campos) {
    viejo[c] = Array.isArray(fila[c]) ? fila[c] : [];
    nuevo[c] = repararTroceado(viejo[c]);
  }
  if (campos.every((c) => isDeepStrictEqual(viejo[c], nuevo[c]))) return null;
  const cuenta = (o) => Object.fromEntries(campos.map((c) => [c, o[c].length]));
  return { id: fila.id, viejo, nuevo, antes: cuenta(viejo), despues: cuenta(nuevo) };
}

async function main() {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (opciones.error) {
    console.error(`✗ ${opciones.error}\n${USO}`);
    process.exit(1);
  }
  const { antes, antesUtc, tenant: SLUG, confirm: CONFIRM, copia: COPIA } = opciones;

  // Imports de base aquí dentro: así la prueba puede leer las funciones puras
  // de arriba sin arrastrar Sequelize.
  const { getMasterDb } = await import("../lib/db/masterDb.js");
  const { getTenantDb } = await import("../lib/db/tenantDb.js");
  const { auditar } = await import("../lib/utils/auditoria.js");

  console.log(`\n${"═".repeat(70)}`);
  console.log(` ACTAS DE COORDINACIÓN TROCEADAS · creadas antes de ${antes} (${antesUtc})${SLUG ? ` · tenant "${SLUG}"` : ""}`);
  console.log(CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada");
  console.log(`${"═".repeat(70)}\n`);

  const master = getMasterDb();
  const sel = (db, sql, replacements) => db.query(sql, { replacements, type: db.QueryTypes.SELECT });

  const tenants = await sel(
    master,
    `SELECT id, slug FROM master.tenants WHERE status = 'active'${SLUG ? " AND slug = :slug" : ""} ORDER BY slug`,
    SLUG ? { slug: SLUG } : {}
  );
  if (SLUG && !tenants.length) {
    console.error(`✗ No hay un tenant activo con slug "${SLUG}".`);
    process.exit(1);
  }

  const trabajo = []; // { tenantId, slug, schema, planes: [...] }
  const conComa = []; // saltadas por la red de la coma (solo el id, sin texto)
  for (const t of tenants) {
    if (!/^[a-z0-9_]+$/.test(t.slug)) continue;
    const schema = `crm_${t.slug}`;
    const [{ tabla }] = await sel(master, `SELECT to_regclass(:t) AS tabla`, { t: `${schema}.coordinations` });
    if (!tabla) continue;

    const ids = (
      await sel(
        master,
        `SELECT DISTINCT entity_id FROM master.audit_logs
          WHERE tenant_id = :tenantId AND action = 'clinica.coordination.created'
            AND created_at < :antes AND entity_id IS NOT NULL
         EXCEPT
         SELECT entity_id FROM master.audit_logs
          WHERE tenant_id = :tenantId AND action = 'clinica.coordination.repaired' AND entity_id IS NOT NULL`,
        { tenantId: t.id, antes: antesUtc }
      )
    ).map((r) => r.entity_id);
    if (!ids.length) continue;

    const { sequelize } = getTenantDb(t.slug);
    const filas = await sel(
      sequelize,
      `SELECT id, coordination_date, topics, agreements, next_actions AS "nextActions"
         FROM "${schema}".coordinations
        WHERE id::text IN (:ids) AND ai_transcription IS NULL
        ORDER BY coordination_date`,
      { ids }
    );
    const planes = [];
    for (const f of filas) {
      const plan = planDeFila(f);
      if (!plan) {
        if (algunTrozoConComa(f)) conComa.push(`${schema} · acta ${String(f.id).slice(0, 8)}`);
        continue;
      }
      plan.fecha = f.coordination_date ? new Date(f.coordination_date).toISOString().slice(0, 10) : "—";
      planes.push(plan);
    }
    if (planes.length) trabajo.push({ tenantId: t.id, slug: t.slug, schema, sequelize, planes });
  }

  // Solo recuentos: nada del texto del acta sale por pantalla.
  let total = 0;
  for (const w of trabajo) {
    for (const p of w.planes) {
      total++;
      const tramos = ["topics", "agreements", "nextActions"].map((c) => `${c} ${p.antes[c]}→${p.despues[c]}`).join(" · ");
      console.log(`  ${w.schema} · acta ${String(p.id).slice(0, 8)} · coordinación ${p.fecha} · ${tramos}`);
    }
  }
  for (const c of conComa) console.log(`  ${c} · SALTADA: algún punto ya lleva coma (no la partió el POST viejo)`);
  console.log(`\n  ${total} ${total === 1 ? "acta" : "actas"} por reparar.\n`);

  if (!total) process.exit(0);
  if (!CONFIRM) {
    console.log(`${"═".repeat(70)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(70)}\n`);
    process.exit(0);
  }

  // 1) La copia ANTES de tocar nada. Si no se puede escribir, no se salta.
  const copia = {
    cuando: new Date().toISOString(),
    antes,
    filas: trabajo.flatMap((w) =>
      w.planes.map((p) => ({ tenant: w.slug, id: p.id, topics: p.viejo.topics, agreements: p.viejo.agreements, nextActions: p.viejo.nextActions }))
    ),
  };
  try {
    writeFileSync(COPIA, JSON.stringify(copia, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error(`✗ No se pudo escribir la copia en ${COPIA} (${e.code ?? e.message}). No se ha tocado nada.`);
    process.exit(1);
  }
  console.log(`  Copia de cómo estaban: ${COPIA}`);

  // 2) Las escrituras, en una transacción por tenant.
  const hechas = [];
  let fallo = false;
  for (const w of trabajo) {
    const tx = await w.sequelize.transaction();
    try {
      for (const p of w.planes) {
        // BULKUPDATE: Sequelize devuelve el número de filas tocadas.
        const tocadas = await w.sequelize.query(
          `UPDATE "${w.schema}".coordinations
              SET topics = CAST(:topics AS jsonb), agreements = CAST(:agreements AS jsonb),
                  next_actions = CAST(:nextActions AS jsonb), updated_at = now()
            WHERE id::text = :id AND ai_transcription IS NULL`,
          {
            replacements: {
              id: String(p.id),
              topics: JSON.stringify(p.nuevo.topics),
              agreements: JSON.stringify(p.nuevo.agreements),
              nextActions: JSON.stringify(p.nuevo.nextActions),
            },
            type: w.sequelize.QueryTypes.BULKUPDATE,
            transaction: tx,
          }
        );
        if (tocadas !== 1) throw new Error(`el acta ${String(p.id).slice(0, 8)} no se actualizó (filas: ${tocadas})`);
      }
      await tx.commit();
      hechas.push(w);
    } catch (e) {
      await tx.rollback();
      console.error(`✗ ${w.schema}: se deshace todo lo de este tenant (${e.message}). La copia sigue en ${COPIA}.`);
      // Sin salir aún: los tenants ya confirmados necesitan su auditoría (el freno).
      fallo = true;
      break;
    }
  }

  // 3) Auditoría DESPUÉS del commit y fuera de la transacción, solo recuentos.
  //    Es además el freno contra una segunda pasada: se comprueba que quedó.
  for (const w of hechas) {
    for (const p of w.planes) {
      await auditar({
        tenantId: w.tenantId,
        userId: null,
        action: "clinica.coordination.repaired",
        entity: "Coordination",
        entityId: String(p.id),
        before: p.antes,
        after: p.despues,
      });
    }
    const [{ n }] = await sel(
      master,
      `SELECT count(DISTINCT entity_id)::int AS n FROM master.audit_logs
        WHERE tenant_id = :tenantId AND action = 'clinica.coordination.repaired' AND entity_id IN (:ids)`,
      { tenantId: w.tenantId, ids: w.planes.map((p) => String(p.id)) }
    );
    if (n !== w.planes.length) {
      console.error(
        `⚠️  ${w.schema}: reparadas ${w.planes.length} pero solo ${n} con auditoría. NO relances el script hasta apuntarlas: sin esa fila, una segunda pasada las estropearía.`
      );
    }
  }

  const reparadas = hechas.reduce((s, w) => s + w.planes.length, 0);
  if (fallo) {
    console.error(`\n✗ Se pararon las escrituras. Reparadas (y auditadas) ${reparadas} de ${total}.`);
    process.exit(1);
  }
  console.log(`\n✅ Reparadas ${reparadas}. Relanza sin --confirm: tiene que decir «0 actas por reparar».`);
  console.log(`   Cuando esté comprobado, borra la copia (${COPIA}) y mueve este script a scripts/_hechos/.\n`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`✗ ${e?.message ?? e}`);
    process.exit(1);
  });
}
