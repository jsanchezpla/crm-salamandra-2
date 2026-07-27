import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { serializeIncentiveItem, resolveItemAmount } from "../../../../../lib/clinica/incentiveItems.js";
import { logClinicaAudit } from "../../../../../lib/clinica/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * PATCH /api/clinica/incentive-items/[id] — editar concepto/valor. SOLO DIRECCIÓN.
 * Body: { concept?, valueType?, value? }. El importe (foto) se RECALCULA con el
 * sueldo vigente de la terapeuta cuando cambia el tipo o el valor.
 */
export const PATCH = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // Pantalla de EQUIPO AVANZADO: se vende aparte del módulo Equipo
  // básico (que es solo plantilla, usuarios, roles y accesos).
  if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección gestiona los incentivos");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const { IncentiveItem, TeamMember } = ctx.tenantModels;
  const item = await IncentiveItem.findByPk(id);
  if (!item) return notFound("Incentivo no encontrado");

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }

  const changes = {};
  if (body.concept !== undefined) {
    // `?? ""`: con concept null, String(null) daría el literal "null" y se
    // guardaría como concepto. Igualado a la validación del POST.
    const c = String(body.concept ?? "").trim();
    if (!c) return error("El concepto no puede quedar vacío");
    changes.concept = c.slice(0, 200);
  }

  const nextType = body.valueType !== undefined ? (body.valueType === "percent" ? "percent" : "fixed") : item.valueType;
  const nextValue = body.value !== undefined ? Number(body.value) : Number(item.value);
  if (body.valueType !== undefined || body.value !== undefined) {
    if (!Number.isFinite(nextValue) || nextValue < 0) return error("Valor inválido");
    if (nextType === "percent" && nextValue > 100) return error("El porcentaje no puede superar 100");
    const therapist = await TeamMember.findByPk(item.therapistId);
    const salaryBase = nextType === "percent" ? (therapist?.monthlySalary != null ? Number(therapist.monthlySalary) : null) : null;
    const resolvedAmount = resolveItemAmount(nextType, nextValue, salaryBase);
    if (nextType === "percent" && resolvedAmount == null) {
      return error(
        `${therapist?.displayName ?? "Esa persona"} no tiene sueldo mensual en su ficha de Equipo; ponlo primero o usa € fijos.`,
        422
      );
    }
    changes.valueType = nextType;
    changes.value = nextValue;
    changes.salaryBase = salaryBase;
    changes.resolvedAmount = resolvedAmount;
  }

  if (Object.keys(changes).length === 0) return error("Nada que cambiar", 422);

  const before = item.toJSON();
  await item.update(changes);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.performance.incentive_item.update",
    entity: "IncentiveItem",
    entityId: id,
    before,
    after: item.toJSON(),
    ip: request.headers.get("x-forwarded-for"),
  });

  const full = await IncentiveItem.findByPk(id, {
    include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName", "avatarColor"], required: false }],
  });
  return ok(serializeIncentiveItem(full));
});

// DELETE — quitar un incentivo escrito. SOLO DIRECCIÓN.
export const DELETE = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección gestiona los incentivos");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const item = await ctx.tenantModels.IncentiveItem.findByPk(id);
  if (!item) return notFound("Incentivo no encontrado");

  const before = item.toJSON();
  await item.destroy();
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.performance.incentive_item.delete",
    entity: "IncentiveItem",
    entityId: id,
    before,
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok({ deleted: id });
});
