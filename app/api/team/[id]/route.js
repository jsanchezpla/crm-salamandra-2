import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { serializeTeamMember } from "../../../../lib/team/serializeTeamMember.js";
import { normalizeSpecialties } from "../../../../lib/clinica/specialties.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const VALID_STATUS = new Set(["active", "inactive", "on_leave"]);
const VALID_PERIODS = new Set([12, 14]);

function normalizeEmail(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed.toLowerCase();
}
function normalizeString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}
function normalizeAmount(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

async function userBelongsToTenant(userId, tenantId) {
  if (!userId) return true;
  const { User } = getMasterModels();
  const user = await User.findByPk(userId, { attributes: ["id", "tenantId"] });
  return !!user && user.tenantId === tenantId;
}
async function userAlreadyLinked(TeamMember, userId, excludeId) {
  if (!userId) return false;
  const where = { userId, id: { [Op.ne]: excludeId } };
  const existing = await TeamMember.findOne({ where, attributes: ["id"] });
  return !!existing;
}
async function emailAlreadyUsed(TeamMember, email, excludeId) {
  if (!email) return false;
  const where = { email, id: { [Op.ne]: excludeId } };
  const existing = await TeamMember.findOne({ where, attributes: ["id"] });
  return !!existing;
}

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId, userId, action, entity: "TeamMember", entityId, before, after, ip,
    });
  } catch {}
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/team/[id]
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("team")) return forbidden("Módulo team no activo");
    const { id } = await params;
    const { TeamMember } = tenantModels;
    const member = await TeamMember.findByPk(id);
    if (!member) return notFound("Miembro no encontrado");

    const userRole = request.headers.get("x-user-role") ?? "user";
    const isAdmin = ADMIN_ROLES.has(userRole);
    return ok(serializeTeamMember(member, { isAdmin }));
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// PATCH /api/team/[id]
// ───────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("team")) return forbidden("Módulo team no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede editar miembros");

    const { id } = await params;
    const { TeamMember } = tenantModels;
    const member = await TeamMember.findByPk(id);
    if (!member) return notFound("Miembro no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const updates = {};
    const beforeSnapshot = {
      displayName: member.displayName,
      email: member.email,
      role: member.position,
      department: member.department,
      hourlyCost: member.hourlyCost,
      hourlyRate: member.hourlyRate,
      annualGross: member.annualGross,
      paymentPeriods: member.paymentPeriods,
      monthlySalary: member.monthlySalary,
      status: member.status,
      userId: member.userId,
    };

    if ("displayName" in body) {
      const v = normalizeString(body.displayName);
      if (!v) return error("displayName no puede ser vacío");
      updates.displayName = v;
    }
    if ("email" in body) {
      const v = normalizeEmail(body.email);
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return error("email inválido");
      if (v && (await emailAlreadyUsed(TeamMember, v, member.id))) {
        return error("Ya existe un miembro con ese email", 409);
      }
      updates.email = v;
    }
    if ("role" in body) updates.position = normalizeString(body.role);
    if ("specialties" in body) updates.specialties = normalizeSpecialties(body.specialties);
    if ("department" in body) updates.department = normalizeString(body.department);
    if ("phone" in body) updates.phone = normalizeString(body.phone);
    if ("avatarUrl" in body) updates.avatarUrl = normalizeString(body.avatarUrl);
    if ("notes" in body) updates.notes = body.notes != null ? String(body.notes) : null;
    if ("startDate" in body) updates.hiredAt = normalizeString(body.startDate);
    if ("currency" in body) {
      const c = normalizeString(body.currency);
      updates.currency = (c ?? "EUR").toUpperCase().slice(0, 3);
    }
    if ("hourlyCost" in body) {
      const v = normalizeAmount(body.hourlyCost);
      if (v === undefined) return error("hourlyCost inválido");
      updates.hourlyCost = v;
    }
    if ("hourlyRate" in body) {
      const v = normalizeAmount(body.hourlyRate);
      if (v === undefined) return error("hourlyRate inválido");
      updates.hourlyRate = v;
    }
    // Retribución: annualGross + paymentPeriods → monthlySalary CALCULADO en
    // backend (single source of truth). monthlySalary NO se acepta directo.
    const retribTouched = "annualGross" in body || "paymentPeriods" in body;
    if ("paymentPeriods" in body) {
      const p = Number(body.paymentPeriods);
      if (!VALID_PERIODS.has(p)) return error("paymentPeriods debe ser 12 o 14");
      updates.paymentPeriods = p;
    }
    if ("annualGross" in body) {
      const v = normalizeAmount(body.annualGross);
      if (v === undefined) return error("annualGross inválido");
      updates.annualGross = v;
    }
    if (retribTouched) {
      const ag = "annualGross" in updates ? updates.annualGross : member.annualGross;
      const pp = "paymentPeriods" in updates ? updates.paymentPeriods : (member.paymentPeriods || 12);
      if (ag != null) {
        updates.monthlySalary = Math.round((Number(ag) / pp) * 100) / 100;
      } else if (member.annualGross != null) {
        // Se ha borrado un bruto anual que SÍ existía → el mensual derivado
        // pierde su origen y se anula.
        updates.monthlySalary = null;
      }
      // Si el miembro nunca tuvo annualGross (legacy solo-mensual de seeds/antes
      // del backfill), NO se toca monthlySalary: preservamos el salario que ya
      // alimenta la analítica (la UI manda annualGross:null en cada edición).
    }
    if ("status" in body) {
      if (!VALID_STATUS.has(body.status)) return error("status inválido");
      updates.status = body.status;
    }
    if ("userId" in body) {
      const linkedUserId = body.userId || null;
      if (linkedUserId) {
        if (!(await userBelongsToTenant(linkedUserId, tenant.id))) {
          return error("userId no pertenece al tenant", 400);
        }
        if (await userAlreadyLinked(TeamMember, linkedUserId, member.id)) {
          return error("Ese userId ya está vinculado a otro miembro", 409);
        }
      }
      updates.userId = linkedUserId;
    }

    await member.update(updates);
    await member.reload();

    // Auditoría granular
    const afterSnapshot = {
      displayName: member.displayName,
      email: member.email,
      role: member.position,
      department: member.department,
      hourlyCost: member.hourlyCost,
      hourlyRate: member.hourlyRate,
      annualGross: member.annualGross,
      paymentPeriods: member.paymentPeriods,
      monthlySalary: member.monthlySalary,
      status: member.status,
      userId: member.userId,
    };

    const auditCommon = {
      tenantId: tenant.id, userId, entityId: member.id, ip,
      before: beforeSnapshot, after: afterSnapshot,
    };
    if (beforeSnapshot.role !== afterSnapshot.role) {
      await logAudit({ ...auditCommon, action: "team.role_changed" });
    }
    if (String(beforeSnapshot.hourlyCost) !== String(afterSnapshot.hourlyCost)) {
      await logAudit({ ...auditCommon, action: "team.cost_changed" });
    }
    if (String(beforeSnapshot.hourlyRate) !== String(afterSnapshot.hourlyRate)) {
      await logAudit({ ...auditCommon, action: "team.rate_changed" });
    }
    if (
      String(beforeSnapshot.monthlySalary) !== String(afterSnapshot.monthlySalary) ||
      String(beforeSnapshot.annualGross) !== String(afterSnapshot.annualGross) ||
      String(beforeSnapshot.paymentPeriods) !== String(afterSnapshot.paymentPeriods)
    ) {
      await logAudit({ ...auditCommon, action: "team.salary_changed" });
    }
    if (beforeSnapshot.status !== afterSnapshot.status) {
      await logAudit({ ...auditCommon, action: "team.status_changed" });
    }

    return ok(serializeTeamMember(member, { isAdmin: true }));
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/team/[id] — soft delete (status = 'inactive')
// ───────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("team")) return forbidden("Módulo team no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede desactivar miembros");

    const { id } = await params;
    const { TeamMember } = tenantModels;
    const member = await TeamMember.findByPk(id);
    if (!member) return notFound("Miembro no encontrado");
    if (member.status === "inactive") return noContent();

    const before = { status: member.status };
    await member.update({ status: "inactive" });
    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "team.deactivated",
      entityId: member.id,
      before,
      after: { status: "inactive" },
      ip,
    });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
