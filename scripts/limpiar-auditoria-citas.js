/**
 * limpiar-auditoria-citas.js — quita de `master.audit_logs` los datos de
 * pacientes que las citas copiaron ahí hasta el 13/09/2026 (14/09/2026).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── DE DÓNDE NACE ──────────────────────────────────────────────────────────
 * Hasta el commit e06aeb8d (13/09/2026) el alta, la edición y la cancelación de
 * una cita volcaban la fila entera en la auditoría de master —nombre, correo,
 * teléfono, notas, respuestas, texto del cobro y el token del enlace
 * «cancelar»— y la huella de una cita borrada guardaba el nombre. Medido el
 * 13/09: 1.550 filas enteras + 129 huellas = 1.679. Jorge decidió el 14/09/2026
 * REESCRIBIRLAS en sitio, no borrarlas: se conserva quién creó, editó, canceló
 * o borró cada cita y cuándo. Los tokens de cancelación NO se rotan.
 * Ver docs/decisions/2026-09-13-la-auditoria-de-una-cita-no-lleva-al-paciente.md
 *
 * ── QUÉ HACE ───────────────────────────────────────────────────────────────
 * Lee las filas `entity = 'Booking'` y pasa cada una por `limpiarFilaDeCita`
 * (`lib/citas/limpiarAuditoriaDeCita.js`), que usa las MISMAS funciones que las
 * rutas de hoy: la fila limpiada queda igual que una nueva. Solo cambian
 * `before` y `after`; ni `created_at`, ni `user_id`, ni `action`, ni el número
 * de filas. Las huellas recuperan `clientId`/`patientId` si otra fila de la
 * misma cita los tenía. Una fila sin nada privado no se toca: se puede lanzar
 * dos veces. Todo en UNA transacción; después, fuera de ella, una sola fila de
 * auditoría con el recuento (`citas.auditoria_limpiada`).
 *
 * Es la ÚNICA excepción, puntual, a «los logs no se modifican salvo
 * podar-audit-logs.js» (CLAUDE.md, Seguridad → Auditoría).
 *
 * Imprime SOLO recuentos (por acción y cliente, antes y después), nunca valores.
 *
 * Uso:
 *   node --env-file=.env.local scripts/limpiar-auditoria-citas.js            (simula)
 *   docker exec crm-salamandra-app-1 node scripts/limpiar-auditoria-citas.js
 *   docker exec crm-salamandra-app-1 node scripts/limpiar-auditoria-citas.js --confirm
 *
 * Antes de --confirm en producción, copia de la tabla (la copia CONSERVA lo que
 * se quita: guardarla lo justo y borrarla después).
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { auditar } from "../lib/utils/auditoria.js";
import { CAMPOS_PRIVADOS_CITA } from "../lib/citas/resumenDeCita.js";
import {
  CLAVE_NOMBRE_HUELLA,
  identidadDeCita,
  ladoConDatosPrivados,
  limpiarFilaDeCita,
} from "../lib/citas/limpiarAuditoriaDeCita.js";

const CONFIRM = process.argv.includes("--confirm");

/** Commit e06aeb8d: una fila posterior con datos privados querría decir que el arreglo no está desplegado. */
const ARREGLO = new Date("2026-09-13T16:55:34Z");

const CLAVES_PROHIBIDAS = [...CAMPOS_PRIVADOS_CITA, CLAVE_NOMBRE_HUELLA];

function log(msg = "") { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

function tabla(titulo, conteo) {
  log(titulo);
  const filas = Object.entries(conteo).sort(([a], [b]) => a.localeCompare(b));
  if (!filas.length) return log("    (ninguna)");
  let total = 0;
  for (const [clave, n] of filas) {
    log(`    ${clave.padEnd(52)} ${String(n).padStart(6)}`);
    total += n;
  }
  log(`    ${"TOTAL".padEnd(52)} ${String(total).padStart(6)}`);
}

const suma = (obj, k) => { obj[k] = (obj[k] ?? 0) + 1; };

async function contarEnBase(s) {
  const lista = `ARRAY[${CLAVES_PROHIBIDAS.map((k) => s.escape(k)).join(",")}]`;
  const [filas] = await s.query(`
    SELECT coalesce(t.slug, '(sin tenant)') AS slug, a.action, count(*)::int AS n
      FROM master.audit_logs a
      LEFT JOIN master.tenants t ON t.id = a.tenant_id
     WHERE a.entity = 'Booking'
       AND (   (jsonb_typeof(a.before) = 'object' AND jsonb_exists_any(a.before, ${lista}))
            OR (jsonb_typeof(a.after)  = 'object' AND jsonb_exists_any(a.after,  ${lista})))
     GROUP BY 1, 2`);
  const conteo = {};
  for (const f of filas) conteo[`${f.slug} · ${f.action}`] = f.n;
  const [[{ total }]] = await s.query(`SELECT count(*)::int AS total FROM master.audit_logs`);
  const [[{ citas }]] = await s.query(`SELECT count(*)::int AS citas FROM master.audit_logs WHERE entity = 'Booking'`);
  return { conteo, total, citas };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL (en local: node --env-file=.env.local …)");
    process.exit(1);
  }
  const s = getMasterDb();
  // Sin eco de SQL: el UPDATE lleva los lados en los parámetros y no se imprimen valores.
  s.options.logging = false;

  header(`Limpieza de la auditoría de citas${CONFIRM ? "" : " (SIMULACIÓN)"}`);

  const antes = await contarEnBase(s);
  log(`Filas en master.audit_logs: ${antes.total} · de citas: ${antes.citas}`);
  tabla("Con datos privados, ANTES (cliente · acción):", antes.conteo);

  const [filas] = await s.query(`
    SELECT a.id, a.entity_id, a.action, a.before, a.after, a.created_at, coalesce(t.slug, '(sin tenant)') AS slug
      FROM master.audit_logs a
      LEFT JOIN master.tenants t ON t.id = a.tenant_id
     WHERE a.entity = 'Booking'
     ORDER BY a.created_at`);

  // De quién es cada cita, sacado de CUALQUIER fila suya (solo FK): lo usa la
  // huella de un borrado viejo, que solo guardaba el nombre.
  const identidades = new Map();
  for (const f of filas) {
    for (const lado of [f.before, f.after]) {
      const id = identidadDeCita(lado);
      if (id) identidades.set(keyCita(f), { ...identidades.get(keyCita(f)), ...id });
    }
  }

  const cambios = [];
  const porTipo = {};
  let posterioresAlArreglo = 0;
  let huellasConFicha = 0;
  for (const f of filas) {
    const r = limpiarFilaDeCita(f, { identidad: identidades.get(keyCita(f)) ?? null });
    if (!r) continue;
    if (new Date(f.created_at) >= ARREGLO) posterioresAlArreglo++;
    if (ladoConDatosPrivados(r.before) || ladoConDatosPrivados(r.after)) {
      throw new Error("La limpieza dejó datos privados en una fila: no se escribe nada.");
    }
    if (r.tipo === "huella" && (r.before?.clientId || r.before?.patientId)) huellasConFicha++;
    suma(porTipo, `${f.slug} · ${r.tipo}`);
    cambios.push({ id: f.id, before: r.before, after: r.after });
  }

  tabla("A reescribir (cliente · tipo):", porTipo);
  log(`Huellas de borrado que recuperan clientId/patientId de otra fila suya: ${huellasConFicha}`);
  log(`Filas con datos privados escritas DESPUÉS del arreglo (${ARREGLO.toISOString()}): ${posterioresAlArreglo}`);

  if (!CONFIRM) {
    header("Simulación: no se ha escrito nada. Repite con --confirm.");
    await s.close();
    return;
  }
  if (!cambios.length) {
    header("Nada que limpiar: ya estaba limpia.");
    await s.close();
    return;
  }

  const json = (x) => (x === null || x === undefined ? null : JSON.stringify(x));
  const tx = await s.transaction();
  try {
    for (const c of cambios) {
      await s.query(
        `UPDATE master.audit_logs
            SET before = CAST(:before AS jsonb), after = CAST(:after AS jsonb)
          WHERE id = :id AND entity = 'Booking'`,
        { replacements: { id: c.id, before: json(c.before), after: json(c.after) }, transaction: tx }
      );
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    console.error("\n❌ Nada se ha escrito (transacción deshecha):", e.message);
    process.exit(1);
  }

  const despues = await contarEnBase(s);
  header("Después");
  log(`Filas en master.audit_logs: ${despues.total} · de citas: ${despues.citas}`);
  tabla("Con datos privados, DESPUÉS (cliente · acción):", despues.conteo);

  // Auditoría DESPUÉS y fuera de la transacción: solo recuentos.
  try {
    const [[t]] = await s.query(`SELECT id FROM master.tenants WHERE slug = 'salamandra_solutions'`);
    await auditar({
      tenantId: t?.id ?? null,
      userId: null,
      action: "citas.auditoria_limpiada",
      entity: "AuditLog",
      entityId: null,
      before: { conDatosPrivados: Object.values(antes.conteo).reduce((x, y) => x + y, 0) },
      after: {
        reescritas: cambios.length,
        porTipo,
        huellasConFicha,
        quedanConDatosPrivados: Object.values(despues.conteo).reduce((x, y) => x + y, 0),
        script: "limpiar-auditoria-citas.js",
      },
    });
  } catch (e) {
    console.warn("(no se pudo auditar:", e.message, ")");
  }

  header(`Hecho. ${cambios.length} fila(s) reescritas; el total de filas no cambia (${antes.total} → ${despues.total}).`);
  await s.close();
}

/** Una cita se reconoce por su id (`entity_id`) dentro de su cliente. */
function keyCita(f) {
  return `${f.slug}|${f.entity_id}`;
}

main().catch((err) => { console.error(err); process.exit(1); });
