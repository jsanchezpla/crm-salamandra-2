import { Op } from "sequelize";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, resumenFactura, datosPeticion } from "../../../../../../lib/billing/audit.js";
import { assignInvoiceNumber } from "../../../../../../lib/billing/generateInvoiceNumber.js";
import { calculateInvoice } from "../../../../../../lib/billing/calculateInvoice.js";
import { fotoFiscalDe, ATRIBUTOS_PARA_CONGELAR } from "../../../../../../lib/billing/datosFiscales.js";
import { lineasDeCuota } from "../../../../../../lib/billing/lotesCuotas.js";
import { planDePartir, criterioValido, lineasDeAnulacion } from "../../../../../../lib/billing/partirFactura.js";
import { madridToday } from "../../../../../../lib/utils/madridDate.js";

/**
 * GET/POST /api/billing/invoices/[id]/partir — partir una factura del lote en
 * varias, por paciente o por terapia (06/09/2026, Rodrigo).
 *
 *   GET  ?por=paciente|terapia → vista previa: qué facturas saldrían, o por
 *                                qué no se puede
 *   POST { por, issueDate?, reason? } → lo hace
 *
 * ── LO QUE HACE, EN ORDEN Y EN UNA TRANSACCIÓN ─────────────────────────────
 *   1. Anula la original con una rectificativa TOTAL (serie R, todo en
 *      negativo) — el mismo documento que emite «Rectificar» con base 0 — y la
 *      deja en `rectified`, enlazadas las dos.
 *   2. Emite N facturas nuevas en la serie F, una por grupo, con los MISMOS
 *      cobros repartidos: cada una nace cobrada (`paid`, `paidAmount = total`),
 *      con la foto fiscal del pagador y la marca `partidaDe` en customFields.
 *   3. Cambia los cobros de factura (`payments.invoice_id`). El dinero no se
 *      toca: ni su estado, ni su fecha, ni su mes.
 *
 * ── LO QUE NO HACE, Y NO ES UNA LIMITACIÓN NUESTRA ──────────────────────────
 * No renumera nada. La numeración es correlativa y una factura emitida no
 * cambia de número: las nuevas cogen los siguientes libres de la serie, y la
 * original se queda con el suyo, anulada. Es lo que exige el Reglamento de
 * facturación y lo que Verifactu encadena. La regla de qué se puede partir y en
 * qué vive en `lib/billing/partirFactura.js`, con su prueba.
 *
 * Solo dirección, como emitir y rectificar.
 */

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
class PartirConflicto extends Error {}

async function recoger({ tenantModels, id, por }) {
  const { Invoice, Payment, Client, BillingConcept, Patient } = tenantModels;
  const factura = await Invoice.findByPk(id);
  if (!factura) return null;

  const cobros = await Payment.findAll({
    where: { invoiceId: factura.id },
    attributes: ["id", "clientId", "patientId", "conceptId", "amount", "method", "paidAt", "notes", "status", "periodMonth"],
    order: [["paidAt", "ASC"]],
  });
  const ficha = await Client.findByPk(factura.clientId, { attributes: ATRIBUTOS_PARA_CONGELAR });

  const conceptos =
    por === "terapia" && BillingConcept ? await BillingConcept.findAll({ attributes: ["id", "name"] }) : [];
  const idsPacientes = por === "paciente" ? [...new Set(cobros.map((c) => c.patientId).filter(Boolean))] : [];
  const pacientes =
    idsPacientes.length && Patient
      ? (await Patient.findAll({ where: { id: { [Op.in]: idsPacientes } }, attributes: ["id", "firstName", "lastName"] }))
          .map((p) => ({ id: p.id, name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() }))
      : [];

  const plan = planDePartir({
    factura: factura.toJSON(),
    cobros: cobros.map((c) => c.toJSON()),
    ficha: ficha ? ficha.toJSON() : null,
    por,
    conceptos: conceptos.map((c) => ({ id: c.id, name: c.name })),
    pacientes,
  });
  return { factura, ficha, plan };
}

const vistaGrupo = (g) => ({
  grupoId: g.grupoId,
  paciente: g.paciente ?? null,
  terapia: g.terapia ?? null,
  importe: g.importe,
  cobros: g.cobros.map((c) => ({ id: c.id, amount: c.amount, paidAt: c.paidAt, notes: c.notes ?? null })),
});

export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("billing")) return forbidden("Módulo billing no activo");
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede partir una factura");
    const { id } = await params;
    const por = criterioValido(new URL(request.url).searchParams.get("por"));
    const r = await recoger({ tenantModels: ctx.tenantModels, id, por });
    if (!r) return notFound("Factura no encontrada");
    return ok({
      por,
      numero: r.factura.number,
      total: Number(r.factura.total),
      mes: r.plan.mes,
      ok: r.plan.ok,
      motivo: r.plan.motivo,
      grupos: r.plan.grupos.map(vistaGrupo),
      fechaPropuesta: madridToday(),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("billing")) return forbidden("Módulo billing no activo");
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede partir una factura");
    const { tenant, tenantModels } = ctx;
    const { Invoice, Payment, InvoiceSeries, TenantBillingSettings } = tenantModels;
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const por = criterioValido(body?.por);
    const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 255) : "Factura partida por " + por;

    const r = await recoger({ tenantModels, id, por });
    if (!r) return notFound("Factura no encontrada");
    if (!r.plan.ok) return error(`No se puede partir: ${r.plan.motivo}`, 422);
    const { factura: original, ficha, plan } = r;

    // La fecha: hoy, o la que venga, y nunca anterior a la original (la
    // anulación no puede retroceder a otro periodo).
    let issueDate = madridToday();
    if (body?.issueDate) {
      if (!DATE_RE.test(String(body.issueDate))) return error("issueDate debe ser 'AAAA-MM-DD'", 422);
      if (String(body.issueDate) < String(original.issueDate).slice(0, 10)) {
        return error("La fecha no puede ser anterior a la factura original", 422);
      }
      issueDate = String(body.issueDate);
    }

    const serieR =
      (await InvoiceSeries.findOne({ where: { kind: "rectificative" } })) ||
      (await InvoiceSeries.findOne({ where: { code: "R" } }));
    if (!serieR) return error("No hay serie rectificativa configurada. Crea una serie de tipo 'rectificative' en Configuración.", 409);

    // El IVA de las nuevas, como en el lote: la exención general o el tipo por
    // defecto del centro, con la base buscada hacia atrás desde lo cobrado.
    const settings = await TenantBillingSettings.findOne();
    const vatExempt = !!settings?.vatExempt;
    const vatRate = vatExempt ? 0 : Number(settings?.defaultVatRate ?? 21);
    const vatExemptNote = vatExempt
      ? settings?.vatExemptNote || "Operación exenta de IVA conforme al artículo 20 de la Ley 37/1992 del IVA."
      : null;

    const sequelize = Invoice.sequelize;
    const { rect, nuevas } = await sequelize.transaction(async (t) => {
      // La original, con cerrojo: dos pestañas no pueden partirla dos veces.
      const locked = await Invoice.findByPk(original.id, { lock: t.LOCK.UPDATE, transaction: t });
      if (!locked) throw new PartirConflicto("Factura no encontrada");
      if (locked.rectifiedByInvoiceId) throw new PartirConflicto("Esta factura ya está rectificada");
      if (!["issued", "sent", "paid", "partially_paid", "overdue"].includes(locked.status)) {
        throw new PartirConflicto(`No se puede partir una factura en estado '${locked.status}'`);
      }

      /* 1. La anulación: el mismo documento que «Rectificar» con base 0
            (rectify/route.js), campo a campo. Si allí se añade uno, aquí también. */
      const calcR = calculateInvoice({ lines: lineasDeAnulacion(locked.toJSON()), irpfRate: Number(locked.irpfRate ?? 0) });
      const numeroR = await assignInvoiceNumber({ sequelize, models: tenantModels, seriesCode: serieR.code, date: issueDate, t });
      const rect = await Invoice.create(
        {
          clientId: locked.clientId,
          fiscalSnapshot: locked.fiscalSnapshot ?? null,
          patientId: locked.patientId,
          guardianId: locked.guardianId ?? null,
          eventTypeId: locked.eventTypeId ?? null,
          employeeId: locked.employeeId,
          partnerId: locked.partnerId,
          projectId: locked.projectId,
          issueDate,
          dueDate: null,
          lines: calcR.lines,
          taxBase: calcR.taxBase,
          vatAmount: calcR.vatAmount,
          irpfRate: calcR.irpfRate,
          irpfAmount: calcR.irpfAmount,
          total: calcR.total,
          // Hereda lo cobrado en negativo, como la anulación total de
          // «Rectificar»: el par (original, R) queda fuera de los KPI por
          // `invoiceScope.js`, y lo cobrado lo cuentan las nuevas.
          paidAmount: -Number(locked.paidAmount ?? 0),
          series: serieR.code,
          number: numeroR,
          status: "issued",
          notes: `Anulación de ${locked.number} para partirla por ${por}`,
          correctionReason: reason,
          customFields: {},
          subtotal: calcR.taxBase,
          vatRate: 0,
          rectifiesInvoiceId: locked.id,
        },
        { transaction: t }
      );
      await locked.update({ rectifiedByInvoiceId: rect.id, status: "rectified" }, { transaction: t });

      /* 2 y 3. Las nuevas, como las del lote, con sus cobros cambiados de factura. */
      const nuevas = [];
      for (const grupo of plan.grupos) {
        const lines = lineasDeCuota({ cobros: grupo.cobros, mes: plan.mes, vatRate });
        const calc = calculateInvoice({ lines, irpfRate: 0 });
        if (calc.total !== grupo.importe) {
          throw new PartirConflicto(`El total (${calc.total}) no cuadra con lo cobrado (${grupo.importe}) en ${grupo.paciente ?? grupo.terapia ?? "un grupo"}`);
        }
        const number = await assignInvoiceNumber({ sequelize, models: tenantModels, seriesCode: "F", date: issueDate, t });
        const ultimo = grupo.cobros[grupo.cobros.length - 1];
        const nueva = await Invoice.create(
          {
            clientId: locked.clientId,
            patientId: grupo.patientId ?? locked.patientId ?? null,
            guardianId: locked.guardianId ?? null,
            employeeId: locked.employeeId,
            partnerId: locked.partnerId,
            issueDate,
            dueDate: issueDate,
            lines: calc.lines,
            taxBase: calc.taxBase,
            vatAmount: calc.vatAmount,
            irpfRate: 0,
            irpfAmount: 0,
            total: calc.total,
            paidAmount: calc.total,
            series: "F",
            number,
            status: "paid",
            paidAt: ultimo?.paidAt ?? new Date(),
            fiscalSnapshot: fotoFiscalDe(ficha),
            customFields: {
              loteCuotas: plan.mes,
              partidaDe: locked.number,
              ...(grupo.paciente ? { paciente: grupo.paciente } : {}),
              ...(grupo.terapia ? { terapia: grupo.terapia } : {}),
              ...(vatExemptNote ? { vatExemptNote } : {}),
            },
            subtotal: calc.taxBase,
            vatRate: 0,
          },
          { transaction: t }
        );
        const ids = grupo.cobros.map((c) => c.id);
        const [movidos] = await Payment.update(
          { invoiceId: nueva.id },
          { where: { id: { [Op.in]: ids }, invoiceId: locked.id, status: "completed" }, transaction: t }
        );
        if (movidos !== ids.length) {
          throw new PartirConflicto("Los cobros cambiaron mientras se partía la factura; vuelve a intentarlo");
        }
        nuevas.push({ factura: nueva, grupo });
      }
      return { rect, nuevas };
    });

    // Auditoría DESPUÉS de mutar y FUERA de la transacción: la anulación, cada
    // emisión y una línea que cuenta el conjunto.
    const base = { tenantId: tenant.id, ...datosPeticion(request) };
    await logBillingAudit({
      ...base,
      action: "invoice.rectified",
      entity: "Invoice",
      entityId: original.id,
      before: { status: original.status, total: Number(original.total) },
      after: { mode: "annul", reason, rectifyingNumber: rect.number, rectifyingId: rect.id, status: "rectified", partida: true },
    });
    for (const { factura } of nuevas) {
      await logBillingAudit({
        ...base,
        action: "invoice.issued",
        entity: "Invoice",
        entityId: factura.id,
        before: null,
        after: { ...resumenFactura(factura), lote: plan.mes, partidaDe: original.number },
      });
    }
    await logBillingAudit({
      ...base,
      action: "invoice.split",
      entity: "Invoice",
      entityId: original.id,
      before: { numero: original.number, total: Number(original.total) },
      after: { por, rectificativa: rect.number, nuevas: nuevas.map(({ factura }) => factura.number) },
    });

    return ok({
      por,
      rectificativa: { id: rect.id, numero: rect.number, total: Number(rect.total) },
      nuevas: nuevas.map(({ factura, grupo }) => ({
        id: factura.id,
        numero: factura.number,
        importe: Number(factura.total),
        paciente: grupo.paciente ?? null,
        terapia: grupo.terapia ?? null,
        cobros: grupo.cobros.length,
      })),
    });
  } catch (err) {
    if (err instanceof PartirConflicto) return error(err.message, 409);
    if (err?.code === "OUT_OF_ORDER_DATE") return error(err.message, 422);
    return serverError(err);
  }
});
