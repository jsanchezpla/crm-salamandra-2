import bcrypt from "bcrypt";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../../../lib/demo/isDemo.js";
import { generatePassword, loadManagedUser } from "../../../../../../lib/team/access.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * POST /api/team/[id]/access/password — restablecer la contraseña del usuario
 * de un miembro del equipo.
 *
 * Genera una nueva aleatoria, la guarda con bcrypt 12 y sube tokenVersion para
 * tumbar las sesiones vivas (mismo patrón que scripts/reset-tenant-admin-
 * password.js). La contraseña se devuelve UNA única vez y no se registra en
 * ningún log. Mismas guardas que el resto del flujo de acceso: solo admin (rol
 * fresco de BD), nunca cuentas admin, nunca uno mismo, nunca desde la demo.
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("team")) return forbidden("Módulo team no activo");
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede restablecer contraseñas");
    if (isDemoTenant(ctx)) return forbidden("En la demo no se pueden cambiar contraseñas: es de solo lectura.");

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

    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 12);

    // Scope withPassword: el defaultScope excluye passwordHash y sin él el
    // update del hash no es fiable (los scripts de reset hacen lo mismo).
    const { User } = getMasterModels();
    const user = await User.scope("withPassword").findByPk(member.userId);
    if (!user) return notFound("El usuario enlazado ya no existe");
    await user.update({ passwordHash, tokenVersion: (user.tokenVersion ?? 0) + 1 });

    try {
      const { AuditLog } = getMasterModels();
      await AuditLog.create({
        tenantId: ctx.tenant.id,
        userId: request.headers.get("x-user-id"),
        action: "team.password_reset",
        entity: "TeamMember",
        entityId: member.id,
        before: null,
        after: { username: user.email }, // jamás la contraseña
        ip: request.headers.get("x-forwarded-for") ?? null,
      });
    } catch { /* auditoría best-effort */ }

    return ok({ username: user.email, password });
  } catch (err) {
    return serverError(err);
  }
});
