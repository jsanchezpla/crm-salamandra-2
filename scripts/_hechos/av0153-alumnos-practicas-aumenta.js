/**
 * av0153-alumnos-practicas-aumenta.js — lo que pidió Rosa en el AV-0153 de
 * Aumenta (15/09/2026): el grupo de alumnos en prácticas y sus pendientes.
 *
 * En Aumenta las universidades ya eran fichas (vinieron de Organízate) y sus
 * alumnos cuelgan de ellas como PACIENTES, así que no hay que mover a nadie:
 *
 *   1. Marca como `tipo_ficha = 'universidad'` las fichas cuyo nombre dice
 *      «universi» (UNIR, UNIE, Univ. Privada de Madrid, Nebrija y CEU), para
 *      que salgan en el filtro «Universidades» del listado.
 *   2. Deja PENDIENTES DE COBRO, a nombre de la universidad y con el alumno de
 *      paciente, los dos importes de los alumnos que ya están en el CRM:
 *        · Sofía Carvalho (Universidad Privada de Madrid) — 100,00 €
 *        · Sonia Ramos Martín de Hijas (UNIR)             — 214,20 €
 *      El texto de la factura es el de su última factura a esa universidad.
 *      Ángel Muñoz Ledesma (1.200 €) NO está en el CRM: queda a la espera de
 *      que Rosa diga su universidad.
 *
 * Idempotente: no marca dos veces ni crea un pendiente que ya exista (misma
 * ficha, paciente, mes e importe). Ensayo por defecto; `--confirm` escribe en
 * una transacción y deja auditoría.
 *
 * Uso VPS: docker exec crm-salamandra-app-1 node scripts/_hechos/av0153-alumnos-practicas-aumenta.js [--confirm]
 */

import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { auditar } from "../../lib/utils/auditoria.js";

const CONFIRMAR = process.argv.includes("--confirm");
const out = (m = "") => process.stdout.write(`${m}\n`);
const S = `"crm_aumenta"`;
const MES = "2026-09-01";
const HOY = "2026-09-15";

const PENDIENTES = [
  {
    alumno: "SOFÍA CARVALHO",
    clientId: "04e5c417-d071-494a-83b7-2c2000683a4d",
    patientId: "029c13dd-4e7f-43f2-8995-089f490c982b",
    importe: 100,
    textoFactura: "TUTORIZACIÓN DE PRÁCTICAS ALUMNO SOFIA CARVALHO",
  },
  {
    alumno: "SONIA RAMOS MARTÍN DE HIJAS",
    clientId: "51d603da-51a1-4f96-8ab7-e23af025a562",
    patientId: "52a566d1-a57e-478f-a334-a421cf61deab",
    importe: 214.2,
    textoFactura: "Máster Univ. Interv. Psicológ. Niños y Adolescentes",
  },
];

const db = getMasterDb();
const q = (sql, replacements = {}, transaction) => db.query(sql, { type: "SELECT", replacements, transaction });

async function main() {
  out(`\nAV-0153 · alumnos en prácticas de Aumenta — ${CONFIRMAR ? "ESCRIBE" : "ensayo"}\n`);

  const unis = await q(`SELECT id, name, tipo_ficha FROM ${S}.clients WHERE name ILIKE '%universi%' ORDER BY name`);
  const aMarcar = unis.filter((u) => u.tipo_ficha !== "universidad");
  out(`Fichas de universidad: ${unis.length} (${aMarcar.length} por marcar)`);
  for (const u of unis) out(`  ${u.tipo_ficha === "universidad" ? "·" : "→"} ${u.name}`);

  const aCrear = [];
  for (const p of PENDIENTES) {
    const [ficha] = await q(`SELECT id, name FROM ${S}.clients WHERE id = :id`, { id: p.clientId });
    const [pac] = await q(`SELECT id, client_id FROM ${S}.patients WHERE id = :id`, { id: p.patientId });
    if (!ficha || !pac || String(pac.client_id) !== p.clientId) {
      out(`  ✗ ${p.alumno}: la ficha o el paciente ya no cuadran — no se toca`);
      continue;
    }
    const [ya] = await q(
      `SELECT id FROM ${S}.payments WHERE client_id = :c AND patient_id = :p AND period_month = :m AND amount = :a AND status = 'pending'`,
      { c: p.clientId, p: p.patientId, m: MES, a: p.importe }
    );
    out(`  ${ya ? "·" : "→"} ${p.alumno}: ${p.importe.toFixed(2)} € pendiente a nombre de ${ficha.name}${ya ? " (ya estaba)" : ""}`);
    if (!ya) aCrear.push({ ...p, universidad: ficha.name });
  }

  if (!CONFIRMAR) {
    out("\nEnsayo: no se ha escrito nada. Relánzalo con --confirm.");
    return;
  }

  const creados = [];
  await db.transaction(async (t) => {
    if (aMarcar.length) {
      await db.query(`UPDATE ${S}.clients SET tipo_ficha = 'universidad', updated_at = now() WHERE id IN (:ids)`, {
        replacements: { ids: aMarcar.map((u) => u.id) },
        transaction: t,
      });
    }
    for (const p of aCrear) {
      const [fila] = await q(
        `INSERT INTO ${S}.payments (id, client_id, patient_id, period_month, amount, paid_at, method, status, notes, invoice_text, created_at, updated_at)
         VALUES (gen_random_uuid(), :c, :p, :m, :a, :f, NULL, 'pending', :n, :txt, now(), now())
         RETURNING id, amount`,
        {
          c: p.clientId, p: p.patientId, m: MES, a: p.importe, f: HOY,
          n: `Alumno en prácticas: ${p.alumno} — lo paga ${p.universidad} (AV-0153, pedido por Rosa)`,
          txt: p.textoFactura,
        },
        t
      );
      creados.push({ ...fila, clientId: p.clientId });
    }
  });

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: "aumenta" }, attributes: ["id"] });
  for (const u of aMarcar) {
    await auditar({ tenantId: tenant?.id ?? null, userId: null, action: "client.updated", entity: "Client", entityId: u.id, after: { tipoFicha: "universidad" } });
  }
  for (const c of creados) {
    await auditar({ tenantId: tenant?.id ?? null, userId: null, action: "payment.created", entity: "Payment", entityId: c.id, after: { amount: Number(c.amount), status: "pending", clientId: c.clientId } });
  }
  out(`\n✓ Escrito: ${aMarcar.length} fichas marcadas, ${creados.length} pendientes creados.`);
}

main()
  .then(() => db.close())
  .catch(async (err) => {
    process.stderr.write(`\n✗ ${err.message}\n`);
    await db.close().catch(() => {});
    process.exit(1);
  });
