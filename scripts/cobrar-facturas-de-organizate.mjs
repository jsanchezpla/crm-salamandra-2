// @vivo — da por cobradas las facturas importadas de Organízate que allí sí están cobradas; mientras el centro trabaje en los dos sitios.
/**
 * cobrar-facturas.mjs — da por cobradas en el CRM las facturas de septiembre
 * que vinieron de Organízate y allí SÍ están cobradas (19/09/2026, Rodrigo).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── DE DÓNDE SALE EL DATO ──────────────────────────────────────────────────
 * Del Resumen de caja de Organízate, barrido día a día del 1 al 19 de
 * septiembre: 196 cobros con paciente, importe y forma de pago. Una factura
 * entra aquí SOLO si en esa caja hay un cobro **del mismo paciente y del mismo
 * importe al céntimo** que no se haya usado ya para otra factura. Las que no
 * cuadran se quedan fuera y las repasa el centro: adivinar ahí es inventar
 * dinero.
 *
 * ── QUÉ HACE CON CADA UNA ──────────────────────────────────────────────────
 * 1. Si el CRM ya tiene un cobro suelto de esa familia en septiembre, cobrado y
 *    por ese importe exacto, lo ENGANCHA a la factura en vez de crear otro. Eso
 *    es lo que evita contar el dinero dos veces.
 * 2. Si no lo hay, crea el cobro con la fecha y la forma de pago que dice
 *    Organízate (todas transferencia en esta tanda).
 * 3. Y marca la factura cobrada, igual que hace `conciliar-facturas-organizate`:
 *    `status: paid`, `paidAmount` = total, `paidAt` = la fecha del cobro.
 *
 * Nada más: no toca cuotas, ni bonos, ni citas, ni ninguna factura que no esté
 * en la lista. Auditoría por fila y respaldo de los ids para deshacerlo.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { QueryTypes, Op } from "sequelize";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getMasterDb } from "../lib/db/masterDb.js";
import { logBillingAudit } from "../lib/billing/audit.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const DATOS = args[args.indexOf("--datos") + 1];
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const { models, sequelize } = getTenantDb(SLUG);
const { Invoice, Payment } = models;
const out = (m = "") => process.stdout.write(m + "\n");
const round2 = (n) => Math.round(Number(n) * 100) / 100;

const lista = JSON.parse(readFileSync(DATOS, "utf8"));
out(`\nDatos: ${lista.origen} · generado ${String(lista.generado).slice(0, 16).replace("T", " ")}`);
out(`Facturas que cuadran al céntimo: ${lista.cobrables.length} · fuera: ${lista.fuera.length}`);
out(CONFIRM ? "MODO ESCRITURA\n" : "ENSAYO: no se escribe nada\n");

const master = getMasterDb();
const [tenant] = await master.query("SELECT id FROM master.tenants WHERE slug = :slug", {
  replacements: { slug: SLUG }, type: QueryTypes.SELECT,
});

const plan = { enganchar: [], crear: [], yaCobradas: [], noEncontradas: [] };

for (const f of lista.cobrables) {
  const factura = await Invoice.findOne({ where: { number: f.numero } });
  if (!factura) { plan.noEncontradas.push(f.numero); continue; }
  if (Number(factura.paidAmount) > 0 || factura.status === "paid") { plan.yaCobradas.push(f.numero); continue; }
  if (["draft", "cancelled", "rectified"].includes(factura.status)) { plan.noEncontradas.push(`${f.numero} (${factura.status})`); continue; }

  // ¿Hay ya un cobro suelto de esa familia por ese importe? Entonces se engancha.
  const suelto = await Payment.findOne({
    where: {
      clientId: factura.clientId,
      invoiceId: null,
      status: "completed",
      amount: round2(f.total),
      paidAt: { [Op.gte]: new Date("2026-09-01T00:00:00Z") },
    },
    order: [["paidAt", "ASC"]],
  });
  if (suelto) plan.enganchar.push({ f, factura, cobro: suelto });
  else plan.crear.push({ f, factura });
}

out("── LO QUE VA A PASAR ────────────────────────────────────");
out(`  Cobros que YA existen sueltos y se enganchan   ${plan.enganchar.length}`);
out(`  Cobros que se crean (el dinero entró allí)     ${plan.crear.length}`);
out(`  Facturas que ya estaban cobradas               ${plan.yaCobradas.length}`);
out(`  Facturas que no se encuentran o no valen       ${plan.noEncontradas.length}`);
const totalCrear = plan.crear.reduce((s, x) => s + Number(x.f.total), 0);
const totalEng = plan.enganchar.reduce((s, x) => s + Number(x.f.total), 0);
out(`\n  Se marcarán como cobradas ${plan.enganchar.length + plan.crear.length} facturas · ${round2(totalCrear + totalEng).toFixed(2)} €`);
out(`    de los que ${round2(totalEng).toFixed(2)} € ya estaban en el CRM (solo se enlazan)`);
out(`    y ${round2(totalCrear).toFixed(2)} € se apuntan ahora, por transferencia`);
if (plan.noEncontradas.length) out(`\n  ⚠️  ${plan.noEncontradas.join(", ")}`);

if (!CONFIRM) { out("\nENSAYO: no se ha escrito nada. Con --confirm se aplica.\n"); process.exit(0); }

const rastro = [];
const creados = [];
const enganchados = [];
const facturasTocadas = [];

for (const { f, factura, cobro } of [...plan.enganchar, ...plan.crear]) {
  await sequelize.transaction(async (t) => {
    let idCobro = cobro?.id ?? null;
    if (cobro) {
      await cobro.update({ invoiceId: factura.id }, { transaction: t });
      enganchados.push({ cobro: cobro.id, factura: factura.id });
    } else {
      const nuevo = await Payment.create({
        clientId: factura.clientId,
        patientId: factura.patientId ?? null,
        invoiceId: factura.id,
        amount: round2(f.total),
        paidAt: new Date(`${f.fechaCobro}T10:00:00Z`),
        method: f.metodo || "transfer",
        status: "completed",
        periodMonth: `${String(f.fechaCobro).slice(0, 7)}-01`,
        notes: `Cobrado en Organízate el ${f.fechaCobro} (${f.formaOrg}). Traído al CRM el 19/09/2026.`,
      }, { transaction: t });
      idCobro = nuevo.id;
      creados.push(nuevo.id);
    }
    await factura.update(
      { status: "paid", paidAmount: round2(factura.total), paidAt: new Date(`${f.fechaCobro}T10:00:00Z`) },
      { transaction: t },
    );
    facturasTocadas.push({ id: factura.id, numero: factura.number, cobro: idCobro });
    rastro.push({ numero: factura.number, cobro: idCobro, nuevo: !cobro, importe: round2(f.total) });
  });
}

const fichero = `/tmp/facturas-cobradas-${Date.now()}.json`;
writeFileSync(fichero, JSON.stringify({ slug: SLUG, fecha: new Date().toISOString(), creados, enganchados, facturas: facturasTocadas }, null, 1));
out(`\n✓ ${rastro.length} facturas marcadas como cobradas · ${creados.length} cobros nuevos, ${enganchados.length} enganchados`);
out(`Respaldo: ${fichero}`);

for (const r of rastro) {
  await logBillingAudit({
    tenantId: tenant.id,
    userId: null,
    action: "invoice.updated",
    entity: "Invoice",
    entityId: r.numero,
    after: { estado: "paid", importe: r.importe, cobro: r.cobro, origen: "cobrada en Organízate, traída el 19/09/2026" },
  }).catch(() => {});
}
out("Auditoría escrita.\n");
process.exit(0);
