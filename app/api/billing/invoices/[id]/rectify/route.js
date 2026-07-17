import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { calculateInvoice } from "../../../../../../lib/billing/calculateInvoice.js";
import { assignInvoiceNumber } from "../../../../../../lib/billing/generateInvoiceNumber.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { withEffectiveStatus } from "../../../../../../lib/billing/invoiceStatus.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Conflicto detectado DENTRO de la transacción (bajo lock). Se mapea a 409.
class RectifyConflict extends Error {}

/**
 * POST /api/billing/invoices/[id]/rectify
 *
 * Emite una factura rectificativa (serie R) sobre la original, recogiendo la
 * DIFERENCIA proporcional respecto a un "importe correcto" (base imponible).
 *
 * Body:
 *   {
 *     correctBase: number,   // base imponible CORRECTA (sin IVA). Opcional:
 *                            // si se omite → anulación total (correctBase = 0).
 *     reason?: string,       // motivo (error importe, error IVA, ...)
 *     notes?: string,
 *     issueDate?: 'YYYY-MM-DD',
 *   }
 *
 * Cálculo (factor k = correctBase / baseOriginal):
 *   cada línea de la original → base_línea × (k − 1), conservando su tipo de
 *   IVA; el IRPF se recalcula proporcional sobre la base resultante.
 *
 * Casos:
 *   • correctBase === 0 → ANULACIÓN TOTAL: rectificativa = −original; la
 *     original pasa a `rectified` y hereda paidAmount negativo (KPI Cobrado).
 *   • correctBase  >  0 → RECTIFICATIVA POR DIFERENCIAS: la original QUEDA
 *     ACTIVA (sigue contando en KPIs) y la rectificativa recoge solo el ajuste.
 *     Juntas suman el importe corregido.
 */
export const POST = withTenant(async (request, { params }, { tenantModels, hasModule, tenant }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const role = request.headers.get("x-user-role");
    const userId = request.headers.get("x-user-id");
    if (!ADMIN_ROLES.has(role)) return forbidden("Solo admin");

    const { id } = await params;
    const { Invoice, InvoiceSeries } = tenantModels;

    const original = await Invoice.findByPk(id);
    if (!original) return notFound("Factura no encontrada");
    if (!["issued", "sent", "paid", "partially_paid", "overdue"].includes(original.status)) {
      return error(`No se puede rectificar una factura en estado '${original.status}'`, 409);
    }
    if (original.rectifiedByInvoiceId) {
      return error("Esta factura ya está rectificada", 409);
    }
    // Blindaje: no se puede rectificar una rectificativa (evita cadenas R-de-R
    // sin sentido fiscal). Una factura es rectificativa si apunta a otra.
    if (original.rectifiesInvoiceId) {
      return error("No se puede rectificar una factura rectificativa", 409);
    }

    const body = await request.json().catch(() => ({}));

    // Fecha de la rectificativa: validada (formato + no anterior a la original,
    // para no backdatear el abono a un periodo/año fiscal previo).
    let issueDate = new Date().toISOString().slice(0, 10);
    if (body.issueDate !== undefined && body.issueDate !== null && body.issueDate !== "") {
      if (typeof body.issueDate !== "string" || !DATE_RE.test(body.issueDate) || Number.isNaN(Date.parse(body.issueDate))) {
        return error("issueDate debe tener formato YYYY-MM-DD válido", 400);
      }
      if (body.issueDate < String(original.issueDate).slice(0, 10)) {
        return error("La rectificativa no puede tener fecha anterior a la factura original", 400);
      }
      issueDate = body.issueDate;
    }

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 255)
        : null;

    const baseOriginal = round2(original.taxBase ?? 0);
    if (baseOriginal === 0) {
      return error("La factura original no tiene base imponible; no se puede rectificar por diferencias", 409);
    }

    // correctBase = base imponible correcta. Si no viene → anulación total (0).
    const hasCorrectBase =
      body.correctBase !== undefined && body.correctBase !== null && body.correctBase !== "";
    const correctBase = hasCorrectBase ? round2(body.correctBase) : 0;
    if (!Number.isFinite(correctBase) || correctBase < 0) {
      return error("El importe correcto debe ser un número mayor o igual que 0", 400);
    }
    if (correctBase === baseOriginal) {
      return error("El importe correcto coincide con la base actual: no hay nada que rectificar", 400);
    }

    const isFullAnnul = correctBase === 0;
    const factor = correctBase / baseOriginal; // k

    // Líneas delta proporcionales: una por línea original, con el mismo tipo de
    // IVA y base = base_línea × (k − 1). Redondeo por línea (convención house).
    const origLines = Array.isArray(original.lines) ? original.lines : [];
    const deltaLines = origLines.map((l) => ({
      description: `${isFullAnnul ? "Anulación" : "Rectificación"}: ${l.description ?? ""}`.trim(),
      quantity: 1,
      unitPrice: round2(Number(l.lineBase ?? 0) * (factor - 1)),
      discountPct: 0,
      vatRate: Number(l.vatRate ?? 0),
    }));

    // Propaga el IRPF de la original → la rectificativa lo refleja en negativo.
    const calc = calculateInvoice({ lines: deltaLines, irpfRate: Number(original.irpfRate ?? 0) });

    // La diferencia por línea redondea a 2 decimales; una corrección diminuta
    // sobre muchas líneas puede quedar en 0 y emitiría una rectificativa vacía.
    if (round2(calc.taxBase) === 0) {
      return error("La diferencia es demasiado pequeña (se redondea a 0). Ajusta el importe correcto.", 400);
    }

    // Serie rectificativa (kind=rectificative; fallback a code 'R').
    const rectiSeries =
      (await InvoiceSeries.findOne({ where: { kind: "rectificative" } })) ||
      (await InvoiceSeries.findOne({ where: { code: "R" } }));
    if (!rectiSeries) {
      return error(
        "No hay serie rectificativa configurada. Crea una serie de tipo 'rectificative' en Configuración.",
        409
      );
    }
    const seriesCode = rectiSeries.code;

    const notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim()
        : `${isFullAnnul ? "Anulación" : "Rectificación"} de ${original.number}`;

    const sequelize = original.sequelize;
    const result = await sequelize.transaction(async (t) => {
      // Re-lee la original CON LOCK dentro de la transacción y re-verifica los
      // guards. Evita que un doble-submit / dos pestañas emitan dos
      // rectificativas para la misma factura (mismo patrón que issue/route.js).
      const locked = await Invoice.findByPk(original.id, { lock: t.LOCK.UPDATE, transaction: t });
      if (!locked) throw new RectifyConflict("Factura no encontrada");
      if (locked.rectifiedByInvoiceId) throw new RectifyConflict("Esta factura ya está rectificada");
      if (!["issued", "sent", "paid", "partially_paid", "overdue"].includes(locked.status)) {
        throw new RectifyConflict(`No se puede rectificar una factura en estado '${locked.status}'`);
      }

      const number = await assignInvoiceNumber({
        sequelize,
        models: tenantModels,
        seriesCode,
        date: issueDate,
        t,
      });

      // Anulación total: hereda el paidAmount real en negativo para que el KPI
      // "Cobrado" (billingSummary) compense lo que el filtro `status NOT IN
      // (..., rectified)` excluye de la original. En una rectificativa parcial
      // la original SIGUE contando, así que la rectificativa nace sin cobros.
      const inheritedPaidAmount = isFullAnnul ? -Number(locked.paidAmount ?? 0) : 0;

      const rect = await Invoice.create(
        {
          clientId: locked.clientId,
          patientId: locked.patientId, // conserva el enlace factura↔paciente
          employeeId: locked.employeeId,
          partnerId: locked.partnerId, // conserva atribución por socio en KPIs
          projectId: locked.projectId,
          issueDate,
          dueDate: null,
          lines: calc.lines,
          taxBase: calc.taxBase,
          vatAmount: calc.vatAmount,
          irpfRate: calc.irpfRate,
          irpfAmount: calc.irpfAmount,
          total: calc.total,
          paidAmount: inheritedPaidAmount,
          series: seriesCode,
          number,
          status: "issued",
          notes,
          correctionReason: reason,
          customFields: {},
          subtotal: calc.taxBase,
          vatRate: 0,
          rectifiesInvoiceId: locked.id,
        },
        { transaction: t }
      );

      // Enlaza la original en AMBOS modos (parcial y total): fija
      // rectifiedByInvoiceId para bloquear una segunda rectificación (que
      // recalcularía el delta sobre la base original y sobre-corregiría) y para
      // mostrar el badge "Rectificada por". La anulación TOTAL además marca la
      // original como `rectified` (la excluye de KPIs).
      const originalUpdate = { rectifiedByInvoiceId: rect.id };
      if (isFullAnnul) originalUpdate.status = "rectified";
      await locked.update(originalUpdate, { transaction: t });

      return rect;
    });

    await auditLog({
      tenantId: tenant.id,
      userId,
      action: "invoice.rectified",
      entity: "Invoice",
      entityId: original.id,
      before: {
        status: original.status,
        taxBase: Number(original.taxBase),
        total: Number(original.total),
      },
      after: {
        mode: isFullAnnul ? "annul" : "partial",
        correctBase,
        reason,
        rectifyingNumber: result.number,
        rectifyingId: result.id,
        rectifiedTaxBase: Number(result.taxBase),
        rectifiedTotal: Number(result.total),
        rectifiedByInvoiceId: result.id,
        ...(isFullAnnul ? { status: "rectified" } : {}),
      },
      ip: request.headers.get("x-forwarded-for"),
    });

    await result.reload();
    return ok(withEffectiveStatus(result));
  } catch (err) {
    if (err instanceof RectifyConflict) return error(err.message, 409);
    return serverError(err);
  }
});

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {}
}
