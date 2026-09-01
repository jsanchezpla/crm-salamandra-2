import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { aggregateTeamProductivity } from "../../../../lib/clinica/productivityQuery.js";
import { madridYearMonth } from "../../../../lib/utils/madridDate.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * GET /api/clinica/productividad?period=YYYY-MM
 * Productividad del equipo en el mes: horas directas (suma de la duración de las
 * citas atendidas por cada profesional), horas disponibles (objetivo semanal
 * prorrateado a los laborables del mes) y su %. SOLO DIRECCIÓN (es una vista de
 * gestión: enseña las horas de TODO el equipo y alimenta los incentivos).
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // Pantalla de EQUIPO AVANZADO: se vende aparte del módulo Equipo
  // básico (que es solo plantilla, usuarios, roles y accesos).
  if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede ver la productividad");
  const { Booking, TeamMember, EventType, TeamBlock, PatientTherapist } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;

  // Mes por defecto: el actual en hora española (el servidor corre en UTC).
  let { year, month } = madridYearMonth();
  const period = sp.get("period");
  if (period) {
    [year, month] = period.split("-").map(Number);
    if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return error("Periodo inválido (usa YYYY-MM)");
    }
  }

  // Con EventType/TeamBlock/PatientTherapist la agregación separa además el
  // trabajo interno y el desglose bono/taller/normal (31/08/2026).
  const { rows, totals } = await aggregateTeamProductivity({ Booking, TeamMember, EventType, TeamBlock, PatientTherapist, year, month });

  return ok({
    period: { year, month, value: `${year}-${String(month).padStart(2, "0")}` },
    rows,
    totals,
  });
});
