import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { vistaDe } from "../../../../lib/citas/vistaAgenda.js";

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
    const { Availability } = ctx.tenantModels;
    let franjas = [];
    try {
      franjas = Availability ? await Availability.findAll({ attributes: ["startTime", "endTime"], raw: true }) : [];
    } catch {
      franjas = [];
    }
    return ok(vistaDe(ctx.tenant, franjas));
  } catch (err) {
    return serverError(err);
  }
});
