/**
 * atar-facturas-a-su-paciente.js — las facturas del volcado dicen de qué
 * paciente son (09/09/2026, AV-0081 y AV-0072 de Aumenta).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Isabel: «no nos salen todas las facturas. Esto es importante de cara a que
 * tenemos que tener guardadas todo el histórico de facturas». Y el mismo día:
 * «nosotros no pensamos en Clientes, sino en pacientes».
 *
 * El histórico está entero —14.248 facturas desde octubre de 2022, ninguna sin
 * familia—, pero **14.245 no dicen de qué paciente son**: el volcado de
 * Organízate las ató a la familia que paga, que es lo que había allí. Resultado:
 * la pestaña de facturación de la ficha del PACIENTE sale vacía para todo el
 * mundo, y eso choca con «una factura por paciente», con «Partir» y con que
 * Cuotas ponga el paciente delante de la familia.
 *
 * ── LO QUE ESTE SCRIPT HACE, Y LO QUE NO ───────────────────────────────────
 * SOLO la mitad que no tiene ambigüedad: las facturas de familias con UN SOLO
 * paciente. Ahí no hay nada que adivinar. Son 11.281 de las 14.245.
 *
 * Las otras 2.964 —de 76 familias con dos o tres hijos— **NO se tocan**, y no
 * por prudencia sino porque no se puede: la línea de las 2.964 dice literalmente
 * «Importado de Organízate», sin concepto ni terapia. Medido: el nombre de un
 * hijo aparece en CERO de ellas, y la terapia también en cero. No hay dato con
 * el que desempatar dentro del CRM.
 *
 * ── QUÉ NO CAMBIA ──────────────────────────────────────────────────────────
 * Poner `patient_id` no toca ni un importe, ni un número de factura, ni el
 * estado, ni Verifactu, ni lo que ve una familia en su portal: es la columna
 * que dice de quién era el servicio, y hoy está vacía. Y es reversible con un
 * `UPDATE … SET patient_id = NULL` sobre las que llevan la marca de esta pasada.
 *
 * ── CÓMO SE EJECUTA ────────────────────────────────────────────────────────
 *   docker exec -it crm-salamandra-app-1 node scripts/atar-facturas-a-su-paciente.js aumenta
 *   docker exec -it crm-salamandra-app-1 node scripts/atar-facturas-a-su-paciente.js aumenta --confirm
 *
 * En seco por defecto, como manda la convención de la casa. Sin slug recorre
 * los tenants de `master.tenants` que tengan el schema, nunca una lista a mano.
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { auditar } from "../lib/utils/auditoria.js";

const args = process.argv.slice(2);
const CONFIRMAR = args.includes("--confirm");
const SLUG = args.find((a) => !a.startsWith("--")) ?? null;

const n = (x) => String(x).padStart(6);

async function tenants() {
  const db = getMasterDb();
  // El `id` hace falta para la auditoría, que vive en master y va por tenantId.
  return db.query(
    `SELECT id, slug FROM master.tenants WHERE slug = COALESCE(:slug, slug) ORDER BY slug`,
    { type: db.QueryTypes.SELECT, replacements: { slug: SLUG } },
  );
}

async function unTenant({ id: tenantId, slug }) {
  const { sequelize } = getTenantDb(slug);
  const esquema = `crm_${slug}`;
  const q = (sql, opciones = {}) =>
    sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, ...opciones });

  // ¿Tiene siquiera la tabla de pacientes? Un tenant sin módulo clínico no
  // tiene nada que atar.
  const [existe] = await q(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_schema = :esquema AND table_name IN ('patients','invoices')`,
    { replacements: { esquema } },
  );
  if (existe.n < 2) return null;

  const [antes] = await q(`
    SELECT COUNT(*)::int total,
           COUNT(*) FILTER (WHERE patient_id IS NULL)::int sin_paciente
    FROM ${esquema}.invoices`);
  if (!antes.sin_paciente) return { slug, ...antes, atadas: 0, ambiguas: 0, sinPaciente: 0 };

  const UNICO = `(SELECT client_id FROM ${esquema}.patients
                  WHERE client_id IS NOT NULL GROUP BY client_id HAVING COUNT(*) = 1)`;

  const [seAtan] = await q(`
    SELECT COUNT(*)::int n, COUNT(DISTINCT client_id)::int familias
    FROM ${esquema}.invoices WHERE patient_id IS NULL AND client_id IN ${UNICO}`);
  const [ambiguas] = await q(`
    SELECT COUNT(*)::int n, COUNT(DISTINCT client_id)::int familias
    FROM ${esquema}.invoices i
    WHERE i.patient_id IS NULL
      AND i.client_id IN (SELECT client_id FROM ${esquema}.patients
                          WHERE client_id IS NOT NULL GROUP BY client_id HAVING COUNT(*) > 1)`);
  const [huerfanas] = await q(`
    SELECT COUNT(*)::int n FROM ${esquema}.invoices i
    WHERE i.patient_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM ${esquema}.patients p WHERE p.client_id = i.client_id)`);

  console.log(`\n▶ ${slug}`);
  console.log(`  facturas                                  ${n(antes.total)}`);
  console.log(`  · sin paciente                            ${n(antes.sin_paciente)}`);
  console.log(`  · se atan ahora (familias de UN hijo)      ${n(seAtan.n)}   en ${seAtan.familias} familias`);
  console.log(`  · ambiguas (familias con hermanos)         ${n(ambiguas.n)}   en ${ambiguas.familias} familias — NO se tocan`);
  console.log(`  · de familias sin ningún paciente          ${n(huerfanas.n)}`);

  let atadas = 0;
  if (CONFIRMAR && seAtan.n) {
    /*
     * Un solo UPDATE con subconsulta: 11.281 filas en una transacción, sin
     * cargar nada en memoria. El `patient_id IS NULL` del WHERE hace que
     * relanzarlo no pise lo que ya esté puesto a mano.
     */
    const [, meta] = await sequelize.query(`
      UPDATE ${esquema}.invoices i
         SET patient_id = (SELECT p.id FROM ${esquema}.patients p WHERE p.client_id = i.client_id LIMIT 1),
             updated_at = NOW()
       WHERE i.patient_id IS NULL
         AND i.client_id IN ${UNICO}`);
    atadas = meta?.rowCount ?? seAtan.n;
    console.log(`  ✓ ${atadas} facturas atadas a su paciente`);

    // Auditoría: un RESUMEN y nada más. Ni un id de paciente, ni un nombre:
    // master es un schema compartido y los datos de salud no se duplican ahí.
    await auditar({
      tenantId,
      action: "billing.invoices_patient_backfill",
      entity: "invoice",
      after: { atadas, ambiguas: ambiguas.n, familiasAmbiguas: ambiguas.familias },
    });
  }

  const [despues] = await q(`
    SELECT COUNT(*) FILTER (WHERE patient_id IS NULL)::int sin_paciente FROM ${esquema}.invoices`);
  console.log(`  quedan sin paciente                       ${n(despues.sin_paciente)}`);

  return { slug, ...antes, atadas, ambiguas: ambiguas.n, sinPaciente: despues.sin_paciente };
}

console.log("═".repeat(60));
console.log(` Facturas → su paciente${SLUG ? ` — ${SLUG}` : ""}${CONFIRMAR ? "" : "  ·  ENSAYO (no escribe)"}`);
console.log("═".repeat(60));

const lista = await tenants();
for (const t of lista) {
  try {
    await unTenant(t);
  } catch (e) {
    console.log(`\n▶ ${t.slug}\n  ✗ ${e.message}`);
  }
}
if (!CONFIRMAR) console.log("\n  (ensayo: no se ha escrito nada. Para hacerlo, --confirm)");

await closeAllConnections();
await getMasterDb().close();
