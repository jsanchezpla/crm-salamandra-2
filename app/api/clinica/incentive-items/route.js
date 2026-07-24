import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { serializeIncentiveItem, resolveItemAmount } from "../../../../lib/clinica/incentiveItems.js";
import { logClinicaAudit } from "../../../../lib/clinica/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

function parsePeriod(raw) {
  const now = new Date();
  if (!raw) return { year: now.getFullYear(), month: now.getMonth() + 1 };
  const [year, month] = String(raw).split("-").map(Number);
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * GET /api/clinica/incentive-items?period=YYYY-MM — incentivos escritos del mes
 * (por defecto, el actual). SOLO DIRECCIÓN. Incluye la lista de terapeutas
 * activos (con sueldo sí/no) para el formulario de alta.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección gestiona los incentivos");
  const { IncentiveItem, TeamMember } = ctx.tenantModels;

  const period = parsePeriod(new URL(request.url).searchParams.get("period"));
  if (!period) return error("Periodo inválido (usa YYYY-MM)");

  const rows = await IncentiveItem.findAll({
    where: { periodYear: period.year, periodMonth: period.month },
    include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName", "avatarColor"], required: false }],
    order: [["createdAt", "DESC"]],
    limit: 500,
  });

  const therapists = (
    await TeamMember.findAll({
      where: { status: "active" },
      attributes: ["id", "displayName", "monthlySalary"],
      order: [["displayName", "ASC"]],
    })
  ).map((t) => ({ id: t.id, name: t.displayName, hasSalary: t.monthlySalary != null && Number(t.monthlySalary) > 0 }));

  const items = rows.map(serializeIncentiveItem);
  const total = Math.round(items.reduce((s, i) => s + (i.resolvedAmount ?? 0), 0) * 100) / 100;

  return ok({
    period: { ...period, value: `${period.year}-${String(period.month).padStart(2, "0")}` },
    items,
    total,
    therapists,
  });
});

/**
 * POST /api/clinica/incentive-items — escribir un incentivo. SOLO DIRECCIÓN.
 * Body: { therapistId, period: "YYYY-MM", concept, valueType: "fixed"|"percent", value }
 *
 * Para 'percent' hace falta que la terapeuta tenga sueldo mensual en su ficha
 * de Equipo (si no, 422 con aviso claro). El importe se congela (foto).
 * Además garantiza la fila de PerformanceMetric del periodo, para que la
 * persona aparezca en la propuesta de incentivos aunque aún no esté evaluada.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección gestiona los incentivos");
  const { IncentiveItem, TeamMember, PerformanceMetric } = ctx.tenantModels;

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }

  if (!UUID_RE.test(body.therapistId ?? "")) return error("therapistId inválido");
  const period = parsePeriod(body.period);
  if (!period) return error("Periodo inválido (usa YYYY-MM)");
  const concept = String(body.concept ?? "").trim();
  if (!concept) return error("El concepto es obligatorio (p. ej. «Cambiar la bombilla del centro»)");
  const valueType = body.valueType === "percent" ? "percent" : "fixed";
  const value = Number(body.value);
  if (!Number.isFinite(value) || value < 0) return error("Valor inválido");
  if (valueType === "percent" && value > 100) return error("El porcentaje no puede superar 100");

  const therapist = await TeamMember.findByPk(body.therapistId);
  if (!therapist) return error("Terapeuta no encontrada", 404);

  const salaryBase = valueType === "percent" ? (therapist.monthlySalary != null ? Number(therapist.monthlySalary) : null) : null;
  const resolvedAmount = resolveItemAmount(valueType, value, salaryBase);
  if (valueType === "percent" && resolvedAmount == null) {
    return error(
      `${therapist.displayName} no tiene sueldo mensual en su ficha de Equipo; ponlo primero (Equipo → ficha → retribución) o usa € fijos.`,
      422
    );
  }

  const createdById = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
  const item = await IncentiveItem.create({
    therapistId: therapist.id,
    periodYear: period.year,
    periodMonth: period.month,
    concept: concept.slice(0, 200),
    valueType,
    value,
    resolvedAmount,
    salaryBase,
    createdById: createdById || null,
  });

  // Garantizar la fila de desempeño del periodo (para que salga en la propuesta).
  await PerformanceMetric.findOrCreate({
    where: { therapistId: therapist.id, periodYear: period.year, periodMonth: period.month },
    defaults: { therapistId: therapist.id, periodYear: period.year, periodMonth: period.month },
  });

  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.performance.incentive_item.create",
    entity: "IncentiveItem",
    entityId: item.id,
    after: item.toJSON(),
    ip: request.headers.get("x-forwarded-for"),
  });

  const full = await IncentiveItem.findByPk(item.id, {
    include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName", "avatarColor"], required: false }],
  });
  return ok(serializeIncentiveItem(full));
});
