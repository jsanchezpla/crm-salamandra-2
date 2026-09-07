import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { logBillingAudit, resumenImporte, datosPeticion } from "../../../../../lib/billing/audit.js";
import { ok, noContent, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { updateInvoiceStatus } from "../../../../../lib/billing/updateInvoiceStatus.js";
import { billingHasPatients, pacienteValeParaElCobro } from "../../../../../lib/billing/patientLink.js";

const VALID_STATUS = new Set(["pending", "completed", "failed", "refunded"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La fecha de una devolución tal y como llega del cajón: un día 'AAAA-MM-DD'
 * (se guarda a mediodía para que no cambie de día al pasar por UTC — el
 * resumen de caja agrupa por el día de MADRID) o un instante ISO completo.
 */
function fechaDevolucion(v) {
  const s = String(v ?? "");
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment, Invoice } = tenantModels;
    const { id } = await params;
    const payment = await Payment.findByPk(id, {
      include: [{ model: Invoice, as: "invoice" }],
    });
    if (!payment) return notFound("Cobro no encontrado");
    return ok(payment);
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Payment, Invoice, Patient, Cuota } = tenantModels;
    const { id } = await params;
    const body = await request.json();
    const payment = await Payment.findByPk(id);
    if (!payment) return notFound("Cobro no encontrado");

    const allowed = ["status", "notes", "method", "amount", "paidAt"];
    const updates = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }
    if (updates.status && !VALID_STATUS.has(updates.status)) {
      return error("status inválido");
    }
    if (updates.amount != null && Number(updates.amount) <= 0) {
      return error("amount debe ser mayor que 0");
    }

    // Asociar (o desasociar) el cobro a una factura (31/08/2026): el flujo real
    // es cobrar ANTES de facturar, y hasta hoy un cobro suelto no tenía forma
    // de engancharse a la factura emitida después — la factura se quedaba
    // «emitida» con el dinero ya cobrado. Mismas garantías que el POST:
    // factura viva, mismo cliente y sin exceder el pendiente. El
    // `period_month` NO se toca: morosidad y portal siguen leyendo lo mismo.
    const facturaAnteriorId = payment.invoiceId;
    if ("invoiceId" in body) {
      if (body.invoiceId) {
        const destino = await Invoice.findByPk(body.invoiceId);
        if (!destino) return notFound("Factura no encontrada");
        if (["draft", "cancelled", "rectified"].includes(destino.status)) {
          return error(`No se puede asociar un cobro a una factura en estado '${destino.status}'`, 409);
        }
        if (payment.clientId && destino.clientId && String(payment.clientId) !== String(destino.clientId)) {
          return error("El cobro es de un cliente distinto al de la factura", 409);
        }
        const importeFinal = updates.amount != null ? Number(updates.amount) : Number(payment.amount);
        const pendiente = Number(destino.total) - Number(destino.paidAmount);
        if (String(facturaAnteriorId ?? "") !== String(destino.id) && importeFinal > pendiente + 0.0049) {
          return error(`El importe (${importeFinal}) excede el pendiente de la factura (${pendiente.toFixed(2)})`, 400);
        }
        updates.invoiceId = destino.id;
        if (!payment.clientId) updates.clientId = destino.clientId;
      } else {
        // Desasociar deja el cobro suelto: sin cliente quedaría huérfano.
        if (!payment.clientId) return error("No se puede desasociar: el cobro se quedaría sin cliente", 409);
        updates.invoiceId = null;
      }
    }

    // ── El mes y el paciente también se corrigen (07/09/2026, Registro) ────
    // Un cobro apuntado al mes o al hermano equivocado obligaba a revertirlo y
    // registrarlo de nuevo, y con el pendiente del mes ya cobrado eso era fácil
    // de hacer mal. Las mismas reglas que el POST: el mes 'AAAA-MM' → primer
    // día, y el paciente tiene que existir y ser de la familia del cobro.
    // Vacío = quitarlo (cobro de toda la familia / sin mes).
    if ("periodMonth" in body) {
      if (body.periodMonth == null || body.periodMonth === "") {
        updates.periodMonth = null;
      } else {
        const m = String(body.periodMonth).slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return error("El mes debe ser 'AAAA-MM'");
        updates.periodMonth = `${m}-01`;
      }
    }
    if ("patientId" in body) {
      if (body.patientId == null || body.patientId === "") {
        updates.patientId = null;
      } else {
        if (!UUID_RE.test(String(body.patientId))) return error("patientId inválido");
        if (!billingHasPatients(hasModule) || !Patient) return error("Este centro no lleva pacientes", 409);
        const paciente = await Patient.findByPk(body.patientId, { attributes: ["id", "clientId"] });
        if (!paciente) return notFound("Paciente no encontrado");
        /*
         * Con PAGADOR (07/09/2026) el cliente del cobro es quien paga y el niño
         * es de otra ficha, así que valen las dos: la del cobro y la de la
         * cuota de la que nació. Con la regla vieja, un cobro de una cuota que
         * paga una fundación no se podía ni editar. La regla, con su prueba, en
         * `lib/billing/patientLink.js`.
         */
        let cuotaClientId = null;
        if (payment.cuotaId && Cuota) {
          try {
            const cuota = await Cuota.findByPk(payment.cuotaId, { attributes: ["id", "clientId"] });
            cuotaClientId = cuota?.clientId ?? null;
          } catch {
            // Sin tabla de cuotas en este schema se queda la regla de siempre.
          }
        }
        if (!pacienteValeParaElCobro({
          pacienteClientId: paciente.clientId,
          cobroClientId: updates.clientId ?? payment.clientId,
          cuotaClientId,
        })) {
          return error("Ese paciente no es de la familia de este cobro", 409);
        }
        updates.patientId = paciente.id;
      }
    }

    // ── «Devuelto» apunta CUÁNDO salió el dinero (07/09/2026, Registro) ────
    // Un cobro devuelto son dos movimientos: entró el día del cobro y salió el
    // día de la devolución. Sin la fecha, el resumen de caja no tenía dónde
    // apuntar la salida y el arqueo de ese día cuadraba de menos. Por defecto
    // hoy; el cajón puede decir otro día. Si deja de estar devuelto, se borra.
    const estadoFinal = updates.status ?? payment.status;
    if (estadoFinal === "refunded" && (payment.status !== "refunded" || "refundedAt" in body)) {
      const f = body.refundedAt ? fechaDevolucion(body.refundedAt) : (payment.refundedAt ?? new Date());
      if (!f) return error("La fecha de la devolución debe ser 'AAAA-MM-DD'");
      updates.refundedAt = f;
    } else if (estadoFinal !== "refunded" && payment.refundedAt) {
      updates.refundedAt = null;
    }

    // Cambiar el importe de un cobro ya enganchado tampoco puede pasarse del
    // pendiente de su factura (revisión del 06/09/2026): 100 € → 150 € dejaba
    // `paidAmount` por encima del total y «Cobrado 150 €» en el PDF.
    if (updates.amount != null && !("invoiceId" in body) && payment.invoiceId) {
      const suya = await Invoice.findByPk(payment.invoiceId);
      if (suya) {
        const pendienteSinEste = Number(suya.total) - Number(suya.paidAmount) + Number(payment.amount);
        if (Number(updates.amount) > pendienteSinEste + 0.0049) {
          return error(`El importe (${Number(updates.amount)}) excede el pendiente de la factura (${pendienteSinEste.toFixed(2)})`, 400);
        }
      }
    }

    const antes = resumenImporte(payment);
    try {
      await payment.update(updates);
    } catch (e) {
      // El índice único de `migrate-payments-cuota-unica.js`: una cuota solo
      // puede tener UN cobro pendiente por mes. Mover un pendiente al mes en
      // el que ya hay otro no es un fallo del servidor, es un aviso.
      if (e?.name === "SequelizeUniqueConstraintError" || e?.original?.code === "23505") {
        return error("Esa cuota ya tiene un cobro pendiente en ese mes: cóbralo o revierte uno de los dos", 409);
      }
      throw e;
    }
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "payment.updated",
      entity: "Payment",
      entityId: payment.id,
      before: antes,
      after: resumenImporte(payment),
    });

    // Se recalculan las DOS facturas tocadas: a la que llega el cobro y de la
    // que se va (si cambió). Si no, la antigua se quedaría contando un dinero
    // que ya no es suyo.
    const tocadas = new Set([payment.invoiceId, facturaAnteriorId].filter(Boolean).map(String));
    for (const invId of tocadas) {
      const invoice = await Invoice.findByPk(invId);
      if (invoice) await updateInvoiceStatus(invoice, Payment);
    }

    return ok(payment);
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");

    const { Payment, Invoice } = tenantModels;
    const { id } = await params;
    const payment = await Payment.findByPk(id);
    if (!payment) return notFound("Cobro no encontrado");

    const invoiceId = payment.invoiceId;
    // Borrar un cobro cambia lo que el cliente debe: tiene que quedar rastro.
    const antesBorrar = resumenImporte(payment);
    const idPago = payment.id;
    await payment.destroy();
    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "payment.deleted",
      entity: "Payment",
      entityId: idPago,
      before: antesBorrar,
      after: null,
    });
    const invoice = await Invoice.findByPk(invoiceId);
    if (invoice) await updateInvoiceStatus(invoice, Payment);
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
