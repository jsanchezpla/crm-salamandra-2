import bcrypt from "bcrypt";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../../lib/demo/isDemo.js";
import {
  normalizeUsername,
  generatePassword,
  getTenantModuleKeys,
  filterModules,
  syncMemberModules,
  loadManagedUser,
} from "../../../../../lib/team/access.js";
import { revisarContrasena } from "../../../../../lib/auth/contrasena.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Acceso al CRM de un miembro del equipo — el login de verdad.
 *
 * Lleva a la UI el patrón de las terapeutas de Aumenta
 * (scripts/seed-aumenta-equipo-real.js): User en master con username en el
 * campo email, rol `user`, y moduleAccess = módulos que el empleador marque.
 * El enforcement ya existe (hasModule cruza tenant ∩ moduleAccess, sin caché):
 * aquí SOLO se crean/editan filas de master.users.
 *
 *   GET    → estado: { hasUser, username, lastLoginAt, managedElsewhere, modules }
 *   POST   → crear usuario { username, modules, password? } → 201 { username, password, elegida }
 *            (`password` opcional: si no viene se genera y se devuelve UNA vez;
 *             si viene, se valida con lib/auth/contrasena.js y NO se devuelve)
 *   PATCH  → cambiar módulos { modules } ([] = bloquear sin borrar, consciente)
 *   DELETE → quitar el acceso (borra el User; el token vivo muere en la
 *            siguiente request porque el resolver falla en cerrado)
 *
 * Guardas comunes: solo admin (rol FRESCO de BD, no el header del JWT con TTL
 * 15 min — esto escribe en master); nunca sobre cuentas admin/superadmin ni
 * sobre uno mismo; y nunca desde la demo pública (da sesión admin a anónimos).
 */

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId, action, entity: "TeamMember", entityId, before, after, ip });
  } catch {
    /* auditoría best-effort */
  }
}

function gate(ctx) {
  if (!ctx.hasModule("team")) return forbidden("Módulo team no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede gestionar accesos");
  return null;
}

function gateWrite(ctx) {
  const blocked = gate(ctx);
  if (blocked) return blocked;
  if (isDemoTenant(ctx)) return forbidden("En la demo no se pueden crear ni cambiar usuarios: es de solo lectura.");
  return null;
}

const mergeModules = (keys, enabledList) => {
  const enabled = new Set(enabledList);
  return keys.map((moduleKey) => ({ moduleKey, enabled: enabled.has(moduleKey) }));
};

// ─────────────────────────────────────────────────────────────────────────────
// GET — estado del acceso del miembro
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, { params }, ctx) => {
  try {
    const blocked = gate(ctx);
    if (blocked) return blocked;

    const { id } = await params;
    const { TeamMember, TeamMemberModule } = ctx.tenantModels;
    const member = await TeamMember.findByPk(id, { attributes: ["id", "userId"] });
    if (!member) return notFound("Miembro no encontrado");

    const keys = await getTenantModuleKeys(ctx.tenant.id);

    if (!member.userId) {
      // Sin login todavía. Los checkboxes informativos que hubiera marcados
      // sirven de PROPUESTA inicial para cuando se cree el usuario.
      let propuesta = [];
      try {
        const rows = await TeamMemberModule.findAll({
          where: { teamMemberId: id, enabled: true },
          attributes: ["moduleKey"],
        });
        propuesta = rows.map((r) => r.moduleKey);
      } catch { /* tabla sin migrar en algún tenant viejo: propuesta vacía */ }
      return ok({ hasUser: false, username: null, lastLoginAt: null, managedElsewhere: false, modules: mergeModules(keys, propuesta) });
    }

    const { User } = getMasterModels();
    const user = await User.findByPk(member.userId);
    if (!user || user.tenantId !== ctx.tenant.id) {
      // Enlace roto (usuario borrado a mano): se enseña como "sin usuario".
      return ok({ hasUser: false, username: null, lastLoginAt: null, managedElsewhere: false, modules: mergeModules(keys, []) });
    }

    const managedElsewhere = user.role === "admin" || user.role === "superadmin";
    const access = Array.isArray(user.moduleAccess) ? user.moduleAccess : [];
    return ok({
      hasUser: true,
      username: user.email,
      lastLoginAt: user.lastLoginAt,
      managedElsewhere,
      modules: mergeModules(keys, access.includes("all") ? keys : access),
    });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST — crear el usuario de login para un miembro
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    const blocked = gateWrite(ctx);
    if (blocked) return blocked;

    const { id } = await params;
    const { TeamMember } = ctx.tenantModels;
    const member = await TeamMember.findByPk(id);
    if (!member) return notFound("Miembro no encontrado");
    if (member.status === "inactive") return error("El empleado está desactivado: reactívalo antes de darle acceso", 422);
    if (member.userId) return error("Este empleado ya tiene usuario. Gestiona su acceso desde su ficha.", 409);

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const norm = normalizeUsername(body.username, ctx.slug);
    if (norm.error) return error(norm.error, 422);
    const username = norm.username;

    const keys = await getTenantModuleKeys(ctx.tenant.id);
    const modules = filterModules(body.modules, keys);
    if (modules.length === 0) {
      // moduleAccess [] = entra y no ve NADA. En el alta eso siempre es un
      // error de manejo, no una intención.
      return error("Marca al menos un módulo al que pueda acceder", 422);
    }

    const { User } = getMasterModels();
    const yaExiste = await User.findOne({ where: { email: username }, attributes: ["id"] });
    if (yaExiste) return error(`El usuario «${username}» ya existe. Elige otro.`, 409);

    /*
     * La contraseña la puede ELEGIR quien da el acceso (26/08/2026, Lau).
     * Si no viene en el cuerpo, se genera como siempre. El porqué y las
     * reglas —las mismas que «cambiar mi contraseña»— en la cabecera de
     * access/password/route.js y en lib/auth/contrasena.js.
     */
    const escrita = typeof body.password === "string" ? body.password : "";
    const elegida = escrita !== "";
    if (elegida) {
      const mal = revisarContrasena(escrita, null, { email: username, slug: ctx.slug });
      if (mal) return error(mal, 422);
    }

    const password = elegida ? escrita : generatePassword();
    const passwordHash = await bcrypt.hash(password, 12);

    // validate:false A PROPÓSITO: el modelo valida isEmail y los usernames sin
    // @ son decisión de producto (mismo patrón que el seed de Aumenta).
    const user = await User.create(
      { email: username, passwordHash, role: "user", tenantId: ctx.tenant.id, moduleAccess: modules },
      { validate: false }
    );

    try {
      await member.update({ userId: user.id });
    } catch (linkErr) {
      // Sin transacción posible entre master y el schema del tenant:
      // compensación best-effort para no dejar un login huérfano.
      try { await user.destroy(); } catch { /* ya avisará el 500 */ }
      throw linkErr;
    }

    await syncMemberModules({
      tenantModels: ctx.tenantModels,
      tenantSequelize: ctx.tenantSequelize,
      memberId: member.id,
      enabledKeys: modules,
      allKeys: keys,
    });

    await logAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "team.user_created",
      entityId: member.id,
      before: null,
      after: { username, moduleAccess: modules, elegida }, // JAMÁS la contraseña
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    // Única vez que la GENERADA viaja: no se guarda en claro, no se loguea, no
    // se puede volver a consultar (solo restablecer). La elegida NO vuelve:
    // quien la escribió ya la tiene delante.
    return created({ username, password: elegida ? null : password, elegida, modules });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — cambiar los módulos permitidos
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    const blocked = gateWrite(ctx);
    if (blocked) return blocked;

    const { id } = await params;
    const { TeamMember } = ctx.tenantModels;
    const member = await TeamMember.findByPk(id, { attributes: ["id", "userId"] });
    if (!member) return notFound("Miembro no encontrado");
    if (!member.userId) return notFound("Este empleado no tiene usuario del CRM");

    const managed = await loadManagedUser({
      userId: member.userId,
      tenantId: ctx.tenant.id,
      requesterUserId: request.headers.get("x-user-id"),
    });
    if (managed.error) return error(managed.error, managed.status);
    const { user } = managed;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    if (!Array.isArray(body.modules)) return error("Se requiere modules: [moduleKey...]");

    const keys = await getTenantModuleKeys(ctx.tenant.id);
    const modules = filterModules(body.modules, keys);
    // [] SÍ se permite aquí: es "bloquear el acceso sin borrar la cuenta",
    // una decisión consciente que la UI avisa.

    const before = { moduleAccess: user.moduleAccess };
    await user.update({ moduleAccess: modules });

    await syncMemberModules({
      tenantModels: ctx.tenantModels,
      tenantSequelize: ctx.tenantSequelize,
      memberId: member.id,
      enabledKeys: modules,
      allKeys: keys,
    });

    await logAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "team.access_changed",
      entityId: member.id,
      before,
      after: { moduleAccess: modules },
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    return ok({ username: user.email, modules: keys.map((k) => ({ moduleKey: k, enabled: modules.includes(k) })) });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — quitar el acceso (borra el login, la ficha del empleado se queda)
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    const blocked = gateWrite(ctx);
    if (blocked) return blocked;

    const { id } = await params;
    const { TeamMember } = ctx.tenantModels;
    const member = await TeamMember.findByPk(id);
    if (!member) return notFound("Miembro no encontrado");
    if (!member.userId) return notFound("Este empleado no tiene usuario del CRM");

    const managed = await loadManagedUser({
      userId: member.userId,
      tenantId: ctx.tenant.id,
      requesterUserId: request.headers.get("x-user-id"),
    });
    if (managed.error) return error(managed.error, managed.status);
    const { user } = managed;

    const before = { username: user.email, moduleAccess: user.moduleAccess };
    // Primero se suelta el enlace (schema del tenant), luego se borra el login
    // (master): si lo segundo fallara, queda un User suelto pero la ficha ya no
    // apunta a él — el GET lo enseña como "sin usuario" y se puede repetir.
    await member.update({ userId: null });
    await user.destroy();
    // El token vivo muere solo: el resolver carga el usuario en cada request y
    // falla en cerrado si ya no existe (401 inmediato).

    await logAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "team.user_removed",
      entityId: member.id,
      before,
      after: null,
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    return ok({ removed: true });
  } catch (err) {
    return serverError(err);
  }
});
