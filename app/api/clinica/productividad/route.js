import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { aggregateTeamProductivity } from "../../../../lib/clinica/productivityQuery.js";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * GET /api/clinica/productividad?period=YYYY-MM
 * Productividad del equipo en el mes: horas directas (suma de la duración de las
 * citas atendidas por cada profesional), horas disponibles (objetivo semanal
 * prorrateado a los laborables del mes) y su %.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { Booking, TeamMember } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  const period = sp.get("period");
  if (period) {
    [year, month] = period.split("-").map(Number);
    if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return error("Periodo inválido (usa YYYY-MM)");
    }
  }

  const { rows, totals } = await aggregateTeamProductivity({ Booking, TeamMember, year, month });

  return ok({
    period: { year, month, value: `${year}-${String(month).padStart(2, "0")}` },
    rows,
    totals,
  });
});
