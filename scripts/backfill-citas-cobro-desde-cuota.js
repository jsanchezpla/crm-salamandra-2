/**
 * backfill-citas-cobro-desde-cuota.js — cada cita hereda la cuota de su familia.
 *
 *   node --env-file=.env.local scripts/backfill-citas-cobro-desde-cuota.js <slug>
 *   docker exec crm-salamandra-app-1 node scripts/backfill-citas-cobro-desde-cuota.js aumenta
 *
 * ENSAYA POR DEFECTO. Solo escribe con `--confirm`.
 *
 * ── POR QUÉ (Rodrigo, 04/09/2026, Aumenta) ──────────────────────────────────
 * «Lo que hacía antes Aumenta era que en lugar de tener citas con títulos
 * propios directamente iban a la cuota. Nosotros hemos añadido la capacidad de
 * que todo vaya por citas, lo que pasa es que lo que no está conectado son las
 * distintas cuotas a cada tipo de cita.»
 *
 * Y así está la agenda: de las 12.422 citas vivas de Aumenta, 12.239 son de UN
 * solo tipo, «Sesión (importada)», y los 57 tipos que vinieron de Organízate no
 * los usa ninguna. Atarlas por el tipo de cita no ataría nada. Lo que sí sabe
 * el CRM es de qué familia es cada cita y qué cuota paga esa familia, y eso es
 * suficiente para decir de qué se cobra cada una.
 *
 * ── QUÉ ESCRIBE, Y CUÁNDO NO ESCRIBE ───────────────────────────────────────
 * Rellena `cobro_modo`, `cobro_concept_id`, `cobro_texto` y `cobro_importe` de
 * las citas que NO tienen cobro puesto. No pisa ninguna: una cita que ya diga
 * de qué se cobra se queda como está, la haya puesto una persona o el alta.
 *
 * Se salta —y las cuenta— las que no puede afirmar:
 *   · sin familia enlazada;
 *   · familia sin cuota viva;
 *   · **familia con varias cuotas** y ninguna del paciente de la cita: elegir
 *     una sería adivinar;
 *   · **cuota con varios conceptos**: la cuota dice cuánto paga la familia al
 *     mes, pero no cuál de sus tres servicios es ESTA cita. Esas quedan para
 *     cuando se repartan las cuotas por hijo.
 *
 * Con paciente, manda la cuota DE ESE paciente; si no la tiene, la de la
 * familia (la que no lleva paciente). Nunca la de un hermano — es la misma
 * regla que `lib/billing/cuotaParaRellenar.js`, escrita el mismo día porque en
 * Cobros se colaba.
 *
 * ── EL PERIODO ─────────────────────────────────────────────────────────────
 * Por defecto, desde el día 1 del mes en curso: lo de antes ya está cobrado o
 * facturado y anotarlo no ayuda a nadie. Se cambia con `--desde=AAAA-MM-DD`.
 *
 * Es idempotente: lo que ya tiene cobro no se toca, así que relanzarlo solo
 * alcanza a lo que haya entrado nuevo.
 */

import { Sequelize, QueryTypes } from "sequelize";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const CONFIRMAR = args.includes("--confirm");
const desdeArg = args.find((a) => a.startsWith("--desde="))?.split("=")[1];

function log(msg = "") { process.stdout.write(`${msg}\n`); }

function primeroDeMes() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`;
}

async function main() {
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) {
    process.stderr.write("\nUso: node scripts/backfill-citas-cobro-desde-cuota.js <slug> [--desde=AAAA-MM-DD] [--confirm]\n\n");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const desde = desdeArg && /^\d{4}-\d{2}-\d{2}$/.test(desdeArg) ? desdeArg : primeroDeMes();
  const schema = `crm_${slug}`;
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  log("\n════════════════════════════════════════════════════");
  log(` Cada cita, con la cuota de su familia — ${slug}`);
  log(` Desde ${desde} · ${CONFIRMAR ? "ESCRIBIENDO" : "ENSAYO (no escribe)"}`);
  log("════════════════════════════════════════════════════\n");

  /*
   * Todo en una consulta de lectura: cada cita candidata con las cuotas vivas
   * de su familia ya filtradas por la regla (la suya, o la de la familia). Se
   * agrupa en memoria, que son miles de filas y no millones.
   */
  const filas = await s.query(
    `
    SELECT b.id AS booking_id,
           b.patient_id,
           b.client_id,
           q.id           AS cuota_id,
           q.patient_id   AS cuota_patient_id,
           q.concept_ids  AS concept_ids
      FROM "${schema}".bookings b
      LEFT JOIN "${schema}".billing_cuotas q
        ON q.client_id = b.client_id
       AND q.active
       AND (q.patient_id IS NULL OR b.patient_id IS NULL OR q.patient_id = b.patient_id)
     WHERE b.cobro_modo IS NULL
       AND b.status <> 'cancelled'
       AND b.scheduled_at >= $1
       AND b.taller_grupo_id IS NULL
    `,
    { bind: [desde], type: QueryTypes.SELECT }
  );

  const conceptos = await s.query(
    `SELECT id, name, unit_price FROM "${schema}".billing_concepts WHERE active`,
    { type: QueryTypes.SELECT }
  );
  const porId = new Map(conceptos.map((c) => [String(c.id), c]));

  // Agrupar por cita: una fila por cada cuota candidata.
  const citas = new Map();
  for (const f of filas) {
    if (!citas.has(f.booking_id)) {
      citas.set(f.booking_id, { patientId: f.patient_id, clientId: f.client_id, cuotas: [] });
    }
    if (f.cuota_id) {
      citas.get(f.booking_id).cuotas.push({
        id: f.cuota_id,
        patientId: f.cuota_patient_id,
        conceptIds: Array.isArray(f.concept_ids) ? f.concept_ids.map(String) : [],
      });
    }
  }

  const motivos = { sinFamilia: 0, sinCuota: 0, variasCuotas: 0, variosConceptos: 0, conceptoDesconocido: 0 };
  const aEscribir = [];
  for (const [bookingId, c] of citas) {
    if (!c.clientId) { motivos.sinFamilia += 1; continue; }
    if (!c.cuotas.length) { motivos.sinCuota += 1; continue; }
    // Con paciente, manda la SUYA si la tiene; si no, la de la familia.
    const suyas = c.patientId ? c.cuotas.filter((q) => String(q.patientId ?? "") === String(c.patientId)) : [];
    const candidatas = suyas.length ? suyas : c.cuotas;
    if (candidatas.length > 1) { motivos.variasCuotas += 1; continue; }
    const cuota = candidatas[0];
    if (cuota.conceptIds.length !== 1) { motivos.variosConceptos += 1; continue; }
    const concepto = porId.get(cuota.conceptIds[0]);
    if (!concepto) { motivos.conceptoDesconocido += 1; continue; }
    aEscribir.push({
      bookingId,
      conceptId: concepto.id,
      texto: String(concepto.name ?? "").slice(0, 200),
      importe: Math.round((Number(concepto.unit_price) || 0) * 100),
    });
  }

  log(`  Citas sin cobro en el periodo: ${citas.size}`);
  log(`  · se pueden atar:              ${aEscribir.length}`);
  log(`  · sin familia enlazada:        ${motivos.sinFamilia}`);
  log(`  · familia sin cuota viva:      ${motivos.sinCuota}`);
  log(`  · familia con varias cuotas:   ${motivos.variasCuotas}`);
  log(`  · cuota con varios conceptos:  ${motivos.variosConceptos}`);
  log(`  · concepto ya no existe:       ${motivos.conceptoDesconocido}`);

  // Qué cuotas se van a repartir, para poder mirarlo antes de escribir.
  const porConcepto = new Map();
  for (const x of aEscribir) porConcepto.set(x.texto, (porConcepto.get(x.texto) ?? 0) + 1);
  if (porConcepto.size) {
    log("\n  Reparto por cuota:");
    for (const [nombre, n] of [...porConcepto.entries()].sort((a, b) => b[1] - a[1])) {
      log(`    ${String(n).padStart(6)}  ${nombre}`);
    }
  }

  if (!CONFIRMAR) {
    log("\n  (ensayo: no se ha escrito nada. Para hacerlo, --confirm)\n");
    await s.close();
    process.exit(0);
  }

  let escritas = 0;
  const t = await s.transaction();
  try {
    for (const x of aEscribir) {
      await s.query(
        `UPDATE "${schema}".bookings
            SET cobro_modo = 'cuota', cobro_concept_id = $1, cobro_texto = $2, cobro_importe = $3, updated_at = NOW()
          WHERE id = $4 AND cobro_modo IS NULL`,
        { bind: [x.conceptId, x.texto, x.importe, x.bookingId], transaction: t }
      );
      escritas += 1;
    }
    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  const [{ con_cobro }] = await s.query(
    `SELECT count(*)::int AS con_cobro FROM "${schema}".bookings WHERE cobro_modo IS NOT NULL`,
    { type: QueryTypes.SELECT }
  );
  log(`\n  ✓ ${escritas} citas atadas a su cuota.`);
  log(`  ✓ En total, ${con_cobro} citas del cliente ya dicen de qué se cobran.\n`);
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
