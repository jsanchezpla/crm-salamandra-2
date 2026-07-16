import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Módulos asignados a un miembro del equipo (config, SIN gate real — ver
 * TeamMemberModule.model.js). Distinto de master.users.moduleAccess (login).
 *
 * GET  /api/team/[id]/modules  → lista TODOS los módulos activos del tenant con
 *   el flag enabled del miembro (merge; sin fila → enabled:false).
 * PATCH /api/team/[id]/modules → body { modules: [{ moduleKey, enabled }] }.
 *   Upsert en transacción. Ignora keys que no sean módulos activos del tenant.
 */

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId, action, entity: "TeamMember", entityId, before, after, ip });
  } catch {
    /* auditoría best-effort */
  }
}

// Módulos activos del tenant (master.tenant_modules).
async function tenantModuleKeys(tenantId) {
  const { TenantModule } = getMasterModels();
  const rows = await TenantModule.findAll({
    where: { tenantId, enabled: true },
    attributes: ["moduleKey"],
    order: [["moduleKey", "ASC"]],
  });
  return rows.map((r) => r.moduleKey);
}

function mergeModules(keys, memberRows) {
  const enabledMap = new Map(memberRows.map((r) => [r.moduleKey, r.enabled]));
  return keys.map((moduleKey) => ({ moduleKey, enabled: enabledMap.get(moduleKey) ?? false }));
}

export const GET = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("team")) return forbidden("Módulo team no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin");

    const { id } = await params;
    const { TeamMember, TeamMemberModule } = tenantModels;
    const member = await TeamMember.findByPk(id, { attributes: ["id"] });
    if (!member) return notFound("Miembro no encontrado");

    const keys = await tenantModuleKeys(tenant.id);
    const rows = await TeamMemberModule.findAll({
      where: { teamMemberId: id },
      attributes: ["moduleKey", "enabled"],
    });
    return ok({ modules: mergeModules(keys, rows) });
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("team")) return forbidden("Módulo team no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede editar módulos");

    const { id } = await params;
    const { TeamMember, TeamMemberModule } = tenantModels;
    const member = await TeamMember.findByPk(id, { attributes: ["id"] });
    if (!member) return notFound("Miembro no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    if (!Array.isArray(body.modules)) return error("Se requiere modules: [{ moduleKey, enabled }]");

    const keys = await tenantModuleKeys(tenant.id);
    const validKeys = new Set(keys);

    // Solo módulos válidos del tenant; deduplica por moduleKey (último gana).
    const itemsMap = new Map();
    for (const m of body.modules) {
      const key = typeof m?.moduleKey === "string" ? m.moduleKey.trim() : "";
      if (!key || !validKeys.has(key)) continue;
      itemsMap.set(key, Boolean(m.enabled));
    }

    const beforeRows = await TeamMemberModule.findAll({ where: { teamMemberId: id }, attributes: ["moduleKey", "enabled"] });

    const sequelize = member.sequelize;
    await sequelize.transaction(async (t) => {
      for (const [moduleKey, enabled] of itemsMap.entries()) {
        const [row, created] = await TeamMemberModule.findOrCreate({
          where: { teamMemberId: id, moduleKey },
          defaults: { teamMemberId: id, moduleKey, enabled },
          transaction: t,
        });
        if (!created && row.enabled !== enabled) {
          await row.update({ enabled }, { transaction: t });
        }
      }
    });

    const afterRows = await TeamMemberModule.findAll({ where: { teamMemberId: id }, attributes: ["moduleKey", "enabled"] });

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "team.modules_changed",
      entityId: id,
      before: beforeRows.map((r) => ({ moduleKey: r.moduleKey, enabled: r.enabled })),
      after: afterRows.map((r) => ({ moduleKey: r.moduleKey, enabled: r.enabled })),
      ip,
    });

    return ok({ modules: mergeModules(keys, afterRows) });
  } catch (err) {
    return serverError(err);
  }
});
