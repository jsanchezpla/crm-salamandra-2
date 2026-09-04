import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { puedeVerDinero } from "../../../../lib/citas/dinero.js";
import { loQueSeCobraDe } from "../../../../lib/citas/dineroDeLaCita.js";

/**
 * GET /api/citas/cobro-del-mes?clientId=…&mes=AAAA-MM[&patientId=…]
 *
 * Qué hay que cobrarle a una familia ese mes, sacado de SUS CITAS.
 *
 * ── POR QUÉ EXISTE (04/09/2026, Aumenta por Rodrigo) ────────────────────────
 * Es la segunda mitad de «que se pueda cobrar con comodidad». Desde que cada
 * cita nace atada a un dinero (`lib/citas/dineroDeLaCita.js`), el cobro del mes
 * ya no hay que reconstruirlo mirando la agenda: se pregunta aquí.
 *
 * Devuelve `{ cuotas, sueltos, total, citas }`. La aritmética —y sobre todo por
 * qué una cuota NO se multiplica por el número de citas— está explicada en
 * `loQueSeCobraDe`, que es quien la hace y quien tiene la prueba.
 *
 * ── QUÉ CITAS CUENTAN ───────────────────────────────────────────────────────
 * Las del mes que no están canceladas. Una FALTA sí cuenta: en Aumenta una
 * falta injustificada se cobra igual —de eso va la incidencia que abre— y una
 * justificada se recupera, así que la cuota del mes no se toca. Lo que no
 * cuenta es lo que nunca llegó a ser una cita: las canceladas.
 *
 * El mes se interpreta en la hora del CENTRO. El contenedor corre en
 * `Europe/Madrid` desde el 19/08/2026 precisamente para que «septiembre» sea
 * septiembre aquí y no un mes que empieza a las 22:00 del 31 de agosto.
 */
export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    // Es dinero de una familia: lo pide la pantalla de Cobros, que es de
    // Facturación. Y solo dirección, como el resto de los importes de la agenda
    // (`lib/citas/dinero.js`).
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    if (!puedeVerDinero(request.headers.get("x-user-role"))) {
      return forbidden("Solo dirección ve los importes");
    }

    const { Booking } = tenantModels;
    if (!Booking) return ok({ cuotas: [], sueltos: [], total: 0, citas: 0 });

    const sp = new URL(request.url).searchParams;
    const clientId = (sp.get("clientId") ?? "").trim();
    const patientId = (sp.get("patientId") ?? "").trim();
    const mes = (sp.get("mes") ?? "").trim();

    if (!clientId) return error("clientId es obligatorio");
    if (!/^\d{4}-\d{2}$/.test(mes)) return error("mes tiene que ser AAAA-MM");

    const [anio, m] = mes.split("-").map(Number);
    if (m < 1 || m > 12) return error("mes tiene que ser AAAA-MM");
    const desde = new Date(anio, m - 1, 1, 0, 0, 0, 0);
    const hasta = new Date(anio, m, 1, 0, 0, 0, 0); // fin EXCLUSIVO

    const where = {
      clientId,
      scheduledAt: { [Op.gte]: desde, [Op.lt]: hasta },
      status: { [Op.ne]: "cancelled" },
      cobroModo: { [Op.ne]: null },
    };
    // De un hijo concreto, o de toda la familia. Es la misma pregunta que hace
    // el cobro por paciente (01/09/2026) y se contesta igual.
    if (patientId) where.patientId = patientId;

    const citas = await Booking.findAll({
      where,
      attributes: ["id", "cobroModo", "cobroConceptId", "cobroTexto", "cobroImporte"],
      order: [["scheduledAt", "ASC"]],
    });

    return ok({ ...loQueSeCobraDe(citas), citas: citas.length });
  } catch (err) {
    return serverError(err);
  }
});
