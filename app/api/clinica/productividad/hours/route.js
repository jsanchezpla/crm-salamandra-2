import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../../lib/utils/apiResponse.js";
import { logClinicaAudit } from "../../../../../lib/clinica/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * PUT /api/clinica/productividad/hours — fijar las horas de intervención directa
 * objetivo por semana de cada profesional (denominador de la productividad).
 * Solo dirección.
 *
 * Body: { hours: { "<teamMemberId>": 35, "<otro>": 30, "<otro>": null } }
 *   número 0..80 → se fija · null/"" → se borra (vuelve a N/D).
 */
export const PUT = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede fijar las horas");

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  const hours = body.hours;
  if (!hours || typeof hours !== "object") return error("Falta 'hours' (mapa terapeuta → horas)");

  const { TeamMember } = ctx.tenantModels;
  const updated = [];

  for (const [id, raw] of Object.entries(hours)) {
    if (!UUID_RE.test(id)) return error(`id de terapeuta inválido: ${id}`);
    let value;
    if (raw === null || raw === "") value = null;
    else {
      value = Math.round(Number(raw));
      if (!Number.isFinite(value) || value < 0 || value > 80) return error("Las horas deben ir entre 0 y 80");
    }
    const m = await TeamMember.findByPk(id);
    if (!m) continue;
    if ((m.weeklyDirectHours ?? null) !== value) {
      await m.update({ weeklyDirectHours: value });
      updated.push({ id, weeklyDirectHours: value });
    }
  }

  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.productividad.hours",
    entity: "TeamMember",
    entityId: null,
    after: { updated },
    ip: request.headers.get("x-forwarded-for"),
  });

  return ok({ updated });
});
