/**
 * conciliar-facturas-organizate.js — las facturas que llegaron del Organízate
 * sin su cobro al lado (18/09/2026, AV-0176 de Aumenta: «hay facturas emitidas
 * que ponen que están en borrador, pero que ya se han facturado. Están mal y
 * hay que editarlas. Son las facturas: Sara Isabel, Osinaga»).
 *
 * ── QUÉ PASÓ ───────────────────────────────────────────────────────────────
 * La importación del 09/09/2026 trajo las facturas de septiembre que ya
 * existían allí, y las que no encontraron un cobro en el CRM se quedaron
 * `issued` con `paid_amount 0` y una nota que lo dice: «Sin cobro que la
 * respalde en el CRM: queda emitida y pendiente». Pero el cobro SÍ está: suelto
 * (`invoice_id NULL`), con su `period_month` del mes. Desde recepción eso se ve
 * como una factura emitida que nadie ha pagado, cuando la familia pagó.
 *
 * ── QUÉ HACE, Y QUÉ NO ─────────────────────────────────────────────────────
 * Por FAMILIA: si sus facturas importadas y pendientes suman EXACTAMENTE lo
 * mismo que sus cobros sueltos de ese mes, engancha unos a otras y deja las
 * facturas cobradas. Nada más:
 *
 *   · Si no cuadra al céntimo, esa familia no se toca (sale listada). Un
 *     descuadre es trabajo de recepción, no de un script.
 *   · Un cobro que cubre DOS facturas se PARTE en dos filas (la original se
 *     queda con la primera parte y nace una hermana con el resto): el dinero,
 *     la fecha, el método y el mes son los mismos, así que el arqueo, la
 *     morosidad y el bono siguen sumando igual.
 *   · No se emite, ni se numera, ni se rectifica nada: estas facturas YA están
 *     emitidas. Solo pasan de «emitida y pendiente» a «cobrada».
 *
 * EN SECO por defecto; `--confirm` escribe. Uso en el VPS:
 *   docker exec -it crm-salamandra-app-1 node scripts/conciliar-facturas-organizate.js aumenta --mes 2026-09 [--detalle] [--confirm]
 */

import { pathToFileURL } from "node:url";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getMasterModels } from "../lib/db/masterDb.js";
import { logBillingAudit, resumenFactura, resumenImporte } from "../lib/billing/audit.js";

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * El reparto: qué trozo de qué cobro paga qué factura. Es la mitad que se
 * decide SIN base de datos, y por eso se prueba sola
 * (`scripts/_smoke-conciliar-organizate.mjs`).
 *
 * Se sirven las facturas en orden y se van consumiendo los cobros: al cobro
 * que se pasa de lo que falta se le corta un trozo, y ese resto es lo que paga
 * la factura siguiente.
 *
 * @param {Array} facturas [{ id, total }]  en el orden en que se quieren pagar
 * @param {Array} cobros   [{ id, amount }] en el orden en que se quieren gastar
 * @returns {{ ok: boolean, motivo: string|null, asignaciones: Array }}
 *   asignaciones: [{ facturaId, trozos: [{ cobroId, importe, parte: 'entero'|'corte' }] }]
 */
export function repartir(facturas = [], cobros = []) {
  const fallo = (motivo) => ({ ok: false, motivo, asignaciones: [] });
  if (!facturas.length) return fallo("sin facturas pendientes");
  if (!cobros.length) return fallo("sin cobros sueltos");

  const sumaF = round2(facturas.reduce((s, f) => s + Number(f.total), 0));
  const sumaC = round2(cobros.reduce((s, c) => s + Number(c.amount), 0));
  if (sumaF !== sumaC) return fallo(`las facturas suman ${sumaF} € y los cobros ${sumaC} €`);
  if (facturas.some((f) => round2(f.total) <= 0)) return fallo("hay una factura sin importe positivo");
  if (cobros.some((c) => round2(c.amount) <= 0)) return fallo("hay un cobro sin importe positivo");

  const pila = cobros.map((c) => ({ id: c.id, queda: round2(c.amount), entero: true }));
  const asignaciones = [];
  let i = 0;

  for (const factura of facturas) {
    let falta = round2(factura.total);
    const trozos = [];
    while (falta > 0) {
      const cobro = pila[i];
      if (!cobro) return fallo("se acabaron los cobros antes que las facturas");
      if (cobro.queda <= 0) { i++; continue; }
      const importe = round2(Math.min(cobro.queda, falta));
      trozos.push({ cobroId: cobro.id, importe, parte: cobro.entero && importe === cobro.queda ? "entero" : "corte" });
      cobro.queda = round2(cobro.queda - importe);
      cobro.entero = false;
      falta = round2(falta - importe);
      if (cobro.queda === 0) i++;
    }
    asignaciones.push({ facturaId: factura.id, trozos });
  }
  if (pila.some((c) => c.queda > 0)) return fallo("sobró dinero sin factura");
  return { ok: true, motivo: null, asignaciones };
}

/** Las facturas importadas que siguen emitidas y pendientes, de ese mes. */
async function facturasPendientes({ models, mes }) {
  const { Invoice } = models;
  const filas = await Invoice.findAll({
    where: { status: "issued" },
    attributes: ["id", "number", "clientId", "total", "paidAmount", "issueDate", "customFields", "rectifiesInvoiceId", "rectifiedByInvoiceId"],
    order: [["number", "ASC"]],
  });
  return filas.filter((f) => {
    const j = f.toJSON();
    if (!j.customFields?.deOrganizate) return false; // solo las importadas
    if (j.rectifiesInvoiceId || j.rectifiedByInvoiceId) return false; // ni las R ni las anuladas
    // Y las rectificativas que la importación trajo SUELTAS, sin enlazar a la
    // que anulan (tres de −30 € en Aumenta): por el número y por el signo, que
    // una factura en negativo no se «cobra» con el cobro de nadie.
    if (String(j.number ?? "").toUpperCase().startsWith("R-")) return false;
    if (round2(j.total) <= 0) return false;
    return String(j.issueDate).slice(0, 7) === mes;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const detalle = args.includes("--detalle");
  const mes = args.includes("--mes") ? args[args.indexOf("--mes") + 1] : null;
  const slug = args.find((a) => !a.startsWith("--") && a !== mes);
  if (!slug || !mes || !/^\d{4}-\d{2}$/.test(mes)) {
    process.stderr.write("Uso: node scripts/conciliar-facturas-organizate.js <slug> --mes AAAA-MM [--detalle] [--confirm]\n");
    process.exit(1);
  }

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug }, attributes: ["id", "slug", "name"] });
  if (!tenant) {
    process.stderr.write(`No existe el cliente '${slug}'.\n`);
    process.exit(1);
  }

  const { sequelize, models } = getTenantDb(slug);
  const { Payment, Client, Invoice } = models;

  const facturas = await facturasPendientes({ models, mes });
  const cobros = await Payment.findAll({
    where: { invoiceId: null, status: "completed", periodMonth: `${mes}-01` },
    attributes: [
      "id", "clientId", "amount", "method", "paidAt", "periodMonth", "notes", "invoiceText",
      "patientId", "conceptId", "cuotaId", "packId", "bankTransactionId", "stripePaymentIntentId",
    ],
    order: [["paidAt", "ASC"], ["id", "ASC"]],
  });

  process.stdout.write(`\n${tenant.name ?? slug} · ${mes}\n`);
  process.stdout.write(`  ${facturas.length} facturas importadas emitidas y pendientes · ${cobros.length} cobros sueltos del mes\n`);
  if (!facturas.length) {
    process.stdout.write("  Nada que conciliar.\n");
    process.exit(0);
  }

  // Por familia: sus facturas pendientes y sus cobros sueltos.
  const porCliente = new Map();
  const cubo = (id) => {
    if (!porCliente.has(id)) porCliente.set(id, { facturas: [], cobros: [] });
    return porCliente.get(id);
  };
  for (const f of facturas) cubo(String(f.clientId)).facturas.push(f);
  for (const c of cobros) if (porCliente.has(String(c.clientId))) cubo(String(c.clientId)).cobros.push(c);

  const nombres = new Map(
    (await Client.findAll({ where: { id: [...porCliente.keys()] }, attributes: ["id", "name"] }))
      .map((c) => [String(c.id), c.name])
  );

  const planes = [];
  const descartadas = [];
  for (const [clientId, { facturas: fs, cobros: cs }] of porCliente) {
    const plan = repartir(
      fs.map((f) => ({ id: String(f.id), total: f.total })),
      cs.map((c) => ({ id: String(c.id), amount: c.amount }))
    );
    if (!plan.ok) {
      descartadas.push({ nombre: nombres.get(clientId) ?? clientId, motivo: plan.motivo, nF: fs.length, nC: cs.length });
      continue;
    }
    planes.push({ nombre: nombres.get(clientId) ?? clientId, facturas: fs, cobros: cs, asignaciones: plan.asignaciones });
  }

  const cortes = planes.reduce((s, p) => s + p.asignaciones.reduce((n, a) => n + a.trozos.filter((t) => t.parte === "corte").length, 0), 0);
  const dinero = planes.reduce((s, p) => s + p.facturas.reduce((n, f) => n + round2(f.total), 0), 0);
  process.stdout.write(
    `\n  ✓ ${planes.length} familias cuadran al céntimo: ${planes.reduce((s, p) => s + p.facturas.length, 0)} facturas ` +
      `(${round2(dinero).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €), ${cortes} trozos de cobro partido.\n` +
      `  · ${descartadas.length} familias se quedan exactamente como están.\n`
  );
  if (detalle) {
    for (const p of planes) {
      process.stdout.write(`\n    ${p.nombre}\n`);
      for (const a of p.asignaciones) {
        const f = p.facturas.find((x) => String(x.id) === a.facturaId);
        process.stdout.write(`      ${f.number}  ${round2(f.total)} €  ←  ${a.trozos.map((t) => `${t.importe} € (${t.parte})`).join(" + ")}\n`);
      }
    }
    for (const d of descartadas) process.stdout.write(`\n    — ${d.nombre}: ${d.motivo} (${d.nF} facturas, ${d.nC} cobros)\n`);
  }

  if (!confirm) {
    process.stdout.write("\n  EN SECO. No se ha escrito nada. Añade --confirm para hacerlo.\n\n");
    process.exit(0);
  }

  // ── Escribir, una transacción por familia ────────────────────────────────
  const rastro = [];
  let facturasCobradas = 0;
  let cobrosEnganchados = 0;
  let cobrosNuevos = 0;

  for (const plan of planes) {
    await sequelize.transaction(async (t) => {
      const porId = new Map(plan.cobros.map((c) => [String(c.id), c]));
      const yaUsado = new Set();

      for (const a of plan.asignaciones) {
        const factura = plan.facturas.find((x) => String(x.id) === a.facturaId);
        // El cerrojo: si alguien la cobró o la rectificó mientras mirábamos, fuera.
        const viva = await Invoice.findByPk(factura.id, { lock: t.LOCK.UPDATE, transaction: t });
        if (!viva || viva.status !== "issued" || viva.rectifiedByInvoiceId) {
          throw new Error(`La factura ${factura.number} ha cambiado mientras se conciliaba; esta familia se queda como estaba.`);
        }

        for (const trozo of a.trozos) {
          const original = porId.get(trozo.cobroId);
          const primero = !yaUsado.has(trozo.cobroId);
          yaUsado.add(trozo.cobroId);

          if (primero) {
            // La fila de siempre: se queda con su trozo y con esta factura.
            const [tocadas] = await Payment.update(
              { invoiceId: factura.id, amount: trozo.importe },
              { where: { id: original.id, invoiceId: null, status: "completed" }, transaction: t }
            );
            if (tocadas !== 1) throw new Error(`El cobro ${original.id} cambió mientras se conciliaba.`);
            cobrosEnganchados++;
            rastro.push({
              tipo: "cobro.editado",
              id: String(original.id),
              before: resumenImporte(original),
              after: { ...resumenImporte(original), importe: String(trozo.importe), facturaId: String(factura.id) },
            });
          } else {
            // El resto del cobro, en su propia fila: mismo dinero, misma fecha,
            // mismo método y mismo mes. `paymentSessionId` NO se copia (es única).
            const nuevo = await Payment.create(
              {
                clientId: original.clientId,
                invoiceId: factura.id,
                amount: trozo.importe,
                method: original.method,
                paidAt: original.paidAt,
                periodMonth: original.periodMonth,
                status: "completed",
                notes: [original.notes, `Parte de un cobro partido al conciliar las facturas del Organízate (${mes}).`]
                  .filter(Boolean)
                  .join(" · ")
                  .slice(0, 2000),
                invoiceText: original.invoiceText,
                patientId: original.patientId,
                conceptId: original.conceptId,
                cuotaId: original.cuotaId,
                packId: original.packId,
                bankTransactionId: original.bankTransactionId,
                stripePaymentIntentId: original.stripePaymentIntentId,
              },
              { transaction: t }
            );
            cobrosNuevos++;
            rastro.push({
              tipo: "cobro.nuevo",
              id: String(nuevo.id),
              after: { ...resumenImporte(nuevo), partidoDe: String(original.id) },
            });
          }
        }

        const ultimo = a.trozos.map((x) => porId.get(x.cobroId)).filter(Boolean).pop();
        await viva.update(
          { status: "paid", paidAmount: round2(factura.total), paidAt: ultimo?.paidAt ?? viva.issueDate },
          { transaction: t }
        );
        facturasCobradas++;
        rastro.push({
          tipo: "factura.cobrada",
          id: String(factura.id),
          before: { ...resumenFactura(factura), pagado: String(factura.paidAmount) },
          after: { ...resumenFactura(viva), pagado: String(round2(factura.total)) },
        });
      }
    });
  }

  // Auditoría DESPUÉS de mutar y FUERA de la transacción, un resumen por fila.
  for (const r of rastro) {
    await logBillingAudit({
      tenantId: tenant.id,
      userId: null,
      action: r.tipo === "factura.cobrada" ? "invoice.updated" : r.tipo === "cobro.nuevo" ? "payment.created" : "payment.updated",
      entity: r.tipo === "factura.cobrada" ? "Invoice" : "Payment",
      entityId: r.id,
      before: r.before ?? null,
      after: { ...r.after, motivo: `Conciliación de las facturas importadas del Organízate (${mes}) con sus cobros — AV-0176` },
    });
  }

  process.stdout.write(
    `\n  ✓ ${facturasCobradas} facturas pasadas a cobradas, ${cobrosEnganchados} cobros enganchados y ${cobrosNuevos} filas nuevas de los cobros partidos.\n\n`
  );
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
