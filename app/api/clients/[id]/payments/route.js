import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { billingHasPatients } from "../../../../../lib/billing/patientLink.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tope duro: una familia con años de cuotas ronda los 100-150 cobros. */
const TOPE = 1000;

/**
 * GET /api/clients/[id]/payments
 *
 * El histórico de COBROS de una ficha (15/09/2026, Rodrigo): «igual que se
 * puede ver el histórico de facturación, el de cobros en otra pestaña». Una
 * factura es lo que se le emitió; un cobro, lo que pagó — y en Aumenta la
 * mayoría de cobros no tiene factura detrás, así que la pestaña de Facturación
 * no los enseñaba.
 *
 * Son suyos por los DOS caminos, como en la lista de Cobros: el enlace directo
 * del cobro (`client_id`) y el de su factura. Mismo gate que el resumen de
 * facturación: sin `billing`, 403 y la pestaña se esconde sola.
 */
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound("Cliente no encontrado");

    const { Payment, Invoice, Patient } = tenantModels;
    const include = [
      { model: Invoice, as: "invoice", attributes: ["id", "number", "clientId"], required: false },
    ];
    const conPaciente = Boolean(Patient) && billingHasPatients(hasModule);
    if (conPaciente) {
      include.push({ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false });
    }

    const rows = await Payment.findAll({
      where: { [Op.or]: [{ clientId: id }, { "$invoice.client_id$": id }] },
      include,
      order: [["paidAt", "DESC"]],
      limit: TOPE + 1,
      subQuery: false,
    });

    const truncados = rows.length > TOPE;
    const payments = rows.slice(0, TOPE).map((p) => {
      const f = p.toJSON();
      return {
        id: f.id,
        paidAt: f.paidAt,
        refundedAt: f.refundedAt,
        periodMonth: f.periodMonth,
        amount: f.amount,
        method: f.method,
        status: f.status,
        notes: f.notes,
        invoiceNumber: f.invoice?.number ?? null,
        patientName: f.patient
          ? [f.patient.firstName, f.patient.lastName].filter(Boolean).join(" ") || null
          : null,
      };
    });

    return ok({ payments, truncados });
  } catch (err) {
    return serverError(err);
  }
});
