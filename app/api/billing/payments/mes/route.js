import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { esMes } from "../../../../../lib/citas/cobrarMes.js";
import { citasDelMesParaCuotas, claveDeCitas } from "../../../../../lib/billing/citasParaProrrateo.js";
import { dondeEstaElCobroDe } from "../../../../../lib/billing/cobroDeCuota.js";

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
    // De quién es la cuota, si se ha elegido: decide QUÉ citas cuentan, igual
    // que en la generación (07/09/2026, AV-0068).
    const patientIdPedido = searchParams.get("patientId") || "";
    const patientId = UUID_RE.test(patientIdPedido) ? patientIdPedido : null;
    if (!UUID_RE.test(clientId)) return error("Falta el cliente (clientId)", 422);
    if (!esMes(mes)) return error("El mes debe ser 'AAAA-MM'", 422);

    // Con pagador, el cobro del mes está a nombre de quien paga y no de la
    // familia: se busca por los dos caminos (07/09/2026).
    const deLaFamilia = await dondeEstaElCobroDe({ tenantModels, clientId });

    const filas = await Payment.findAll({
      where: {
        ...deLaFamilia,
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
        ...deLaFamilia,
        status: "pending",
        cuotaId: { [Op.ne]: null },
        invoiceId: null,
        periodMonth: { [Op.gte]: `${mes}-01`, [Op.lt]: `${mesSiguiente(mes)}-01` },
      },
      attributes: ["id", "patientId", "amount"],
      order: [["createdAt", "ASC"]],
    });

    /*
     * ── Y LAS CITAS DEL MES (07/09/2026, AV-0068 de Aumenta) ───────────────
     *
     * El cajón de «Nuevo cobro» prorrateaba el mes de alta por DÍAS mientras
     * la generación ya lo hacía por SESIONES: la misma cuota daba dos importes
     * según quién la calculara. La regla (`tramoDelMes`) corre igual en el
     * navegador, así que lo único que al cajón le faltaba eran las citas.
     *
     * Van solo las FECHAS, que es lo único que mira `sesionesDelTramo`: ni
     * paciente, ni terapeuta, ni motivo. Y se piden con la MISMA pieza que usa
     * la generación, para que el conjunto de citas sea el mismo y no dos
     * parecidos.
     */
    const citasPorClave = await citasDelMesParaCuotas({
      tenantModels,
      mes,
      cuotas: [{ patientId, clientId }],
    });
    const citas = (citasPorClave[claveDeCitas({ patientId, clientId })] ?? [])
      .map((c) => ({ scheduledAt: c.scheduledAt }));

    return ok({
      mes,
      citas,
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
