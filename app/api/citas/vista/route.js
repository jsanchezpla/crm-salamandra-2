import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { vistaDe, aHoraFc } from "../../../../lib/citas/vistaAgenda.js";

/**
 * GET /api/citas/vista — cómo se pinta la agenda de ESTE centro (02/09/2026,
 * AV-0020 y AV-0012 de Aumenta): qué días esconde la semana (`hiddenDays`) y
 * entre qué horas va la rejilla (`slotMinTime` / `slotMaxTime`), sacadas de la
 * semana laboral del centro y de su horario de apertura (Citas →
 * Disponibilidad). La regla vive en lib/citas/vistaAgenda.js.
 *
 * Lo lee cualquiera con el módulo de citas: el calendario lo pregunta al
 * montarse. Si el horario no se puede leer, se contesta igual con la rejilla
 * de siempre: pintar la agenda no puede depender de esto.
 */
export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    const { Availability, Booking } = ctx.tenantModels;
    let franjas = [];
    try {
      // TODAS las franjas, las del centro y las de un tipo de cita: una franja
      // de un tipo abre horas que se pueden reservar, y la rejilla tiene que
      // poder pintarlas (revisión 02/09/2026: quedarse solo con las del centro
      // dejaba fuera la tarde de un tipo concreto).
      franjas = Availability ? await Availability.findAll({ attributes: ["startTime", "endTime"], raw: true }) : [];
    } catch {
      franjas = [];
    }
    return ok(vistaDe(ctx.tenant, franjas, { citas: await horasDeLasCitas(Booking) }));
  } catch (err) {
    return serverError(err);
  }
});

/**
 * La cita más temprana y la más tardía (fin incluido) de un año atrás a catorce
 * meses adelante, en hora de Madrid: `{ desde: "HH:MM", hasta: "HH:MM" }`, o
 * null si no hay citas. Una sola consulta agregada, sin traer filas. Las
 * canceladas no cuentan: no se ven en la rejilla. Best-effort, como el
 * horario: si falla, la rejilla se decide solo con Disponibilidad.
 */
async function horasDeLasCitas(Booking) {
  if (!Booking) return null;
  try {
    const { fn, literal, Op } = Booking.sequelize.Sequelize;
    const ahora = Date.now();
    // Todo en MINUTOS desde la medianoche del día de la cita, en hora de Madrid.
    // Con textos «HH:MI» un fin pasada la medianoche («00:30») sería el más
    // pequeño y no abriría la rejilla; en minutos vale 1.470 y sí.
    const inicioLocal = `("Booking"."scheduled_at" AT TIME ZONE 'Europe/Madrid')`;
    const finLocal = `(("Booking"."scheduled_at" + make_interval(mins => COALESCE("Booking"."duration", 0))) AT TIME ZONE 'Europe/Madrid')`;
    const fila = await Booking.findOne({
      attributes: [
        [fn("min", literal(`extract(hour from ${inicioLocal}) * 60 + extract(minute from ${inicioLocal})`)), "desde"],
        [fn("max", literal(`extract(epoch from (${finLocal} - date_trunc('day', ${inicioLocal}))) / 60`)), "hasta"],
        // ¿Hay alguna en sábado o domingo de las dos últimas semanas en adelante?
        // Entonces no se esconde el fin de semana. Solo lo reciente y lo que
        // viene: un taller de un sábado de hace diez meses no puede anular el
        // ajuste de lunes a viernes que el centro ha pedido.
        [literal(`bool_or(extract(dow from ${inicioLocal}) in (0, 6)) FILTER (WHERE "Booking"."scheduled_at" >= NOW() - INTERVAL '14 days')`), "finDeSemana"],
      ],
      where: {
        // Un año atrás y catorce meses adelante: la rejilla se decide una vez al
        // montar la agenda y tiene que valer para todo lo que se pueda navegar.
        scheduledAt: { [Op.between]: [new Date(ahora - 365 * 86400000), new Date(ahora + 425 * 86400000)] },
        status: { [Op.ne]: "cancelled" },
      },
      raw: true,
    });
    if (fila?.desde == null || fila?.hasta == null) return null;
    // Una cita tecleada a las 00:15 por error no convierte la agenda de todo
    // el centro en una rejilla de 24 horas: lo que cae fuera de 06:00–23:30 no
    // cuenta para el rango (sigue existiendo; simplemente no manda).
    const desde = Math.max(6 * 60, Math.round(Number(fila.desde)));
    const hasta = Math.min(23 * 60 + 30, Math.round(Number(fila.hasta)));
    if (!(hasta > desde)) return null;
    return { desde: aHoraFc(desde), hasta: aHoraFc(hasta), finDeSemana: fila.finDeSemana === true };
  } catch {
    return null;
  }
}
