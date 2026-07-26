import { Op } from "sequelize";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { serializeTeamMember } from "../../../lib/team/serializeTeamMember.js";
import { normalizeSpecialties } from "../../../lib/clinica/specialties.js";

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
  if (!Number.isFinite(n) || n < 0) return undefined; // sentinel: inválido
  return Math.round(n * 100) / 100;
}

async function userBelongsToTenant(userId, tenantId) {
  if (!userId) return true;
  const { User } = getMasterModels();
  const user = await User.findByPk(userId, { attributes: ["id", "tenantId"] });
  return !!user && user.tenantId === tenantId;
}

async function userAlreadyLinked(TeamMember, userId, excludeMemberId = null) {
  if (!userId) return false;
  const where = { userId };
  if (excludeMemberId) where.id = { [Op.ne]: excludeMemberId };
  const existing = await TeamMember.findOne({ where, attributes: ["id"] });
  return !!existing;
}

async function emailAlreadyUsed(TeamMember, email, excludeMemberId = null) {
  if (!email) return false;
  const where = { email };
  if (excludeMemberId) where.id = { [Op.ne]: excludeMemberId };
  const existing = await TeamMember.findOne({ where, attributes: ["id"] });
  return !!existing;
}

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId, userId, action, entity: "TeamMember", entityId, before, after, ip,
    });
  } catch {
    // no romper la respuesta principal por un fallo de auditoría
  }
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/team
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("team")) return forbidden("Módulo team no activo");

    const { TeamMember } = tenantModels;
    const userRole = request.headers.get("x-user-role") ?? "user";
    const isAdmin = ADMIN_ROLES.has(userRole);

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status") ?? "default";
    const role = searchParams.get("role");
    const q = (searchParams.get("q") ?? "").trim();
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));

    const where = {};
    if (statusParam === "all") {
      // sin filtro
    } else if (statusParam === "default") {
      where.status = { [Op.in]: ["active", "on_leave"] };
    } else if (VALID_STATUS.has(statusParam)) {
      where.status = statusParam;
    } else {
      return error("status inválido");
    }

    if (role) where.position = role;

    if (q) {
      where[Op.and] = [
        {
          [Op.or]: [
            { displayName: { [Op.iLike]: `%${q}%` } },
            { email: { [Op.iLike]: `%${q}%` } },
          ],
        },
      ];
    }

    const { count, rows } = await TeamMember.findAndCountAll({
      where,
      order: [["displayName", "ASC"]],
      limit,
      offset,
    });

    // Lista de roles únicos presentes en el tenant (para selector dinámico)
    const roleRows = await TeamMember.findAll({
      attributes: ["position"],
      where: { position: { [Op.ne]: null } },
      group: ["position"],
      raw: true,
    });
    const availableRoles = roleRows
      .map((r) => r.position)
      .filter(Boolean)
      .sort();

    return ok({
      members: rows.map((m) => serializeTeamMember(m, { isAdmin })),
      total: count,
      limit,
      offset,
      availableRoles,
      viewerIsAdmin: isAdmin,
    });
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/team
// ───────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("team")) return forbidden("Módulo team no activo");

    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede crear miembros");

    const { TeamMember } = tenantModels;
    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const displayName = normalizeString(body.displayName);
    if (!displayName) return error("displayName es obligatorio");

    const email = normalizeEmail(body.email);
    const role = normalizeString(body.role);
    const department = normalizeString(body.department);
    const phone = normalizeString(body.phone);
    const avatarUrl = normalizeString(body.avatarUrl);
    const notes = body.notes != null ? String(body.notes) : null;
    const status = body.status ?? "active";
    const linkedUserId = body.userId || null;
    const startDate = normalizeString(body.startDate);
    const currency = (normalizeString(body.currency) ?? "EUR").toUpperCase().slice(0, 3);

    const hourlyCost = normalizeAmount(body.hourlyCost);
    const hourlyRate = normalizeAmount(body.hourlyRate);
    if (hourlyCost === undefined) return error("hourlyCost inválido");
    if (hourlyRate === undefined) return error("hourlyRate inválido");

    // Retribución: bruto anual + pagas → mensual CALCULADO (single source).
    const annualGross = normalizeAmount(body.annualGross);
    if (annualGross === undefined) return error("annualGross inválido");
    let paymentPeriods = 12;
    if (body.paymentPeriods != null && body.paymentPeriods !== "") {
      paymentPeriods = Number(body.paymentPeriods);
      if (!VALID_PERIODS.has(paymentPeriods)) return error("paymentPeriods debe ser 12 o 14");
    }
    const monthlySalary = annualGross != null ? Math.round((annualGross / paymentPeriods) * 100) / 100 : null;

    if (!VALID_STATUS.has(status)) return error("status inválido");

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error("email inválido");
    if (await emailAlreadyUsed(TeamMember, email)) {
      return error("Ya existe un miembro con ese email", 409);
    }

    if (linkedUserId) {
      if (!(await userBelongsToTenant(linkedUserId, tenant.id))) {
        return error("userId no pertenece al tenant", 400);
      }
      if (await userAlreadyLinked(TeamMember, linkedUserId)) {
        return error("Ese userId ya está vinculado a otro miembro", 409);
      }
    }

    const member = await TeamMember.create({
      userId: linkedUserId,
      displayName,
      email,
      position: role,
      department,
      phone,
      avatarUrl,
      hourlyCost,
      hourlyRate,
      annualGross,
      paymentPeriods,
      monthlySalary,
      currency,
      status,
      hiredAt: startDate,
      notes,
      specialties: normalizeSpecialties(body.specialties),
      customFields: {},
    });

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "team.created",
      entityId: member.id,
      before: null,
      after: { displayName, email, role, status, hourlyCost, hourlyRate },
      ip,
    });

    return created(serializeTeamMember(member, { isAdmin: true }));
  } catch (err) {
    return serverError(err);
  }
});
