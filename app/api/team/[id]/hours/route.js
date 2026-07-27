import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Acceso al horario de un miembro: el CENTRO (admin) puede ver/editar cualquiera;
// un profesional solo el SUYO (su TeamMember = el usuario logueado).
async function canAccess(request, tenantModels, memberId) {
  const role = request.headers.get("x-user-role") ?? "user";
  if (ADMIN_ROLES.has(role)) return true;
  const mine = await resolveCurrentTeamMemberId(request, tenantModels);
  return !!mine && mine === memberId;
}

export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    // Gate a nivel de TENANT (team o clinica): las terapeutas no tienen `team`
    // en su moduleAccess de usuario pero SÍ gestionan su propio horario (el
    // acceso individual lo controla canAccess). Antes esto daba 403 y rompía
    // "Mi horario" para ellas (bug 2026-07-27).
    const tHas = ctx.tenantHasModule ? ctx.tenantHasModule.bind(ctx) : ctx.hasModule.bind(ctx);
    if (!tHas("team") && !tHas("clinica")) return forbidden("Módulo equipo no activo");
    const { id } = await params;
    const { TeamMember, TeamMemberHours } = ctx.tenantModels;
    const member = await TeamMember.findByPk(id, { attributes: ["id"] });
    if (!member) return notFound("Miembro no encontrado");
    if (!(await canAccess(request, ctx.tenantModels, id))) return forbidden("Sin acceso a este horario");

    const rows = await TeamMemberHours.findAll({
      where: { teamMemberId: id },
      attributes: ["id", "dayOfWeek", "startTime", "endTime"],
      order: [["dayOfWeek", "ASC"], ["startTime", "ASC"]],
    });
    return ok({ hours: rows });
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, { params }, ctx) => {
  try {
    // Gate a nivel de TENANT (team o clinica): las terapeutas no tienen `team`
    // en su moduleAccess de usuario pero SÍ gestionan su propio horario (el
    // acceso individual lo controla canAccess). Antes esto daba 403 y rompía
    // "Mi horario" para ellas (bug 2026-07-27).
    const tHas = ctx.tenantHasModule ? ctx.tenantHasModule.bind(ctx) : ctx.hasModule.bind(ctx);
    if (!tHas("team") && !tHas("clinica")) return forbidden("Módulo equipo no activo");
    const { id } = await params;
    const { TeamMember, TeamMemberHours } = ctx.tenantModels;
    const member = await TeamMember.findByPk(id, { attributes: ["id"] });
    if (!member) return notFound("Miembro no encontrado");
    if (!(await canAccess(request, ctx.tenantModels, id))) return forbidden("Sin acceso a este horario");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const rawHours = Array.isArray(body?.hours) ? body.hours : null;
    if (!rawHours) return error("hours debe ser un array de franjas");

    // Valida y normaliza cada franja {dayOfWeek 0-6, startTime, endTime}.
    const clean = [];
    for (const h of rawHours) {
      const day = Number(h?.dayOfWeek);
      const st = String(h?.startTime ?? "").slice(0, 8);
      const en = String(h?.endTime ?? "").slice(0, 8);
      if (!Number.isInteger(day) || day < 0 || day > 6) return error("dayOfWeek inválido (0-6)");
      if (!TIME_RE.test(st) || !TIME_RE.test(en)) return error("Horas en formato HH:MM");
      if (en <= st) return error("La hora de fin debe ser posterior a la de inicio");
      clean.push({ teamMemberId: id, dayOfWeek: day, startTime: st, endTime: en });
    }

    // Reemplazo atómico del horario del miembro.
    const sequelize = TeamMemberHours.sequelize;
    await sequelize.transaction(async (t) => {
      await TeamMemberHours.destroy({ where: { teamMemberId: id }, transaction: t });
      if (clean.length) await TeamMemberHours.bulkCreate(clean, { transaction: t });
    });

    const rows = await TeamMemberHours.findAll({
      where: { teamMemberId: id },
      attributes: ["id", "dayOfWeek", "startTime", "endTime"],
      order: [["dayOfWeek", "ASC"], ["startTime", "ASC"]],
    });
    return ok({ hours: rows });
  } catch (err) {
    return serverError(err);
  }
});
