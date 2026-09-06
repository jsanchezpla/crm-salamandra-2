import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { esMes } from "../../../../../lib/citas/cobrarMes.js";

/**
 * GET /api/billing/payments/mes?clientId=<uuid>&mes=AAAA-MM — los cobros
 * COMPLETADOS de una familia con `periodMonth` de ese mes (03/09/2026).
 *
 * Es lo que apaga el botón «Cobrar mes» de la ficha de una cita
 * (`lib/citas/cobrarMes.js`): en cuanto la familia tiene un cobro de ese mes
 * —desde la cita o a mano desde Cobros, da igual— el botón deja de salir.
 * Solo cobros: la factura no cuenta (Aumenta cobra primero y factura al
 * cierre del mes).
 *
 * Devuelve la lista y no un booleano porque de QUIÉN es cada cobro (toda la
 * familia o un hijo) lo decide la regla pura con el paciente de la cita, y
 * eso se prueba sin base de datos.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mesSiguiente(mes) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Payment } = tenantModels;
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId") || "";
    const mes = searchParams.get("mes") || "";
    if (!UUID_RE.test(clientId)) return error("Falta el cliente (clientId)", 422);
    if (!esMes(mes)) return error("El mes debe ser 'AAAA-MM'", 422);

    const filas = await Payment.findAll({
      where: {
        clientId,
        status: "completed",
        periodMonth: { [Op.gte]: `${mes}-01`, [Op.lt]: `${mesSiguiente(mes)}-01` },
      },
      attributes: ["id", "patientId", "amount", "paidAt", "method"],
      order: [["paidAt", "DESC"]],
    });

    // Y los pendientes de cuota del mes (06/09/2026): quien cobra tiene que
    // saber que el cobro ya existe y que registrar el pago lo marca cobrado.
    const pendientes = await Payment.findAll({
      where: {
        clientId,
        status: "pending",
        cuotaId: { [Op.ne]: null },
        invoiceId: null,
        periodMonth: { [Op.gte]: `${mes}-01`, [Op.lt]: `${mesSiguiente(mes)}-01` },
      },
      attributes: ["id", "patientId", "amount"],
      order: [["createdAt", "ASC"]],
    });

    return ok({
      mes,
      pendientes: pendientes.map((p) => ({ id: p.id, patientId: p.patientId ?? null, amount: Number(p.amount) })),
      cobros: filas.map((p) => ({
        id: p.id,
        patientId: p.patientId ?? null,
        amount: Number(p.amount),
        paidAt: p.paidAt,
        method: p.method,
      })),
    });
  } catch (e) {
    return serverError(e);
  }
});
