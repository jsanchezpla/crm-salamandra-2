import bcrypt from "bcrypt";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../../../lib/demo/isDemo.js";
import { loadManagedUser } from "../../../../../../lib/team/access.js";
import { revisarContrasena } from "../../../../../../lib/auth/contrasena.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * POST /api/team/[id]/access/password — restablecer la contraseña del usuario
 * de un miembro del equipo.
 *
 * La guarda con bcrypt 12 y sube tokenVersion para tumbar las sesiones vivas
 * (mismo patrón que scripts/reset-tenant-admin-password.js). Mismas guardas que
 * el resto del flujo de acceso: solo admin (rol fresco de BD), nunca cuentas
 * admin, nunca uno mismo, nunca desde la demo.
 *
 * ── LA CONTRASEÑA LA ESCRIBE QUIEN RESTABLECE, SIEMPRE (26/08/2026) ─────────
 *
 * Hasta hoy salía siempre una aleatoria de 12 caracteres. Sobre el papel es más
 * segura; en la práctica, en un centro de 16 personas donde la dirección
 * restablece contraseñas por teléfono, `k3Jq_8vTz2Lm` se dicta mal, se copia
 * peor y termina en un papel encima del monitor. Es el mismo razonamiento que
 * ya está escrito en lib/auth/contrasena.js para «cambiar mi contraseña»: lo
 * que hace fuerte a una contraseña es el LARGO, no que sea impronunciable.
 *
 * `password` es OBLIGATORIA y NO hay generación automática. Se probó primero
 * dejándola opcional —vacío = te genero una— y Jorge lo cerró el mismo día: una
 * opción que casi nadie va a querer sigue costando una decisión cada vez, y la
 * que se elige por inercia es justo la que se venía a quitar. Sin generador no
 * hay inercia posible.
 *
 * Se valida con `revisarContrasena`, LA MISMA función que usa
 * /api/auth/password, para que las reglas no se dupliquen ni se separen: diez
 * caracteres mínimo, tope de 72 bytes (el de bcrypt, que descarta el resto en
 * silencio), y fuera lo que se adivina en los primeros intentos —el nombre del
 * centro, el del usuario, teclas seguidas—. Ojo al detalle: se comprueba contra
 * el usuario de QUIEN RECIBE la contraseña, no contra el de quien la escribe.
 *
 * ⚠️ La contraseña NO se devuelve en la respuesta. Quien la ha escrito ya la
 * tiene delante; devolverla solo la pasearía otra vez por la red y por los
 * registros de quien esté en medio. Tampoco se escribe en la auditoría.
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

    // `.catch`: un cuerpo vacío o mal formado no revienta; cae en el aviso de
    // `revisarContrasena`, que es el que una persona entiende.
    const body = await request.json().catch(() => ({}));
    const password = typeof body?.password === "string" ? body.password : "";

    // Contra el usuario de QUIEN LA RECIBE, no el de quien la escribe.
    const mal = revisarContrasena(password, null, { email: managed.user.email, slug: ctx.slug });
    if (mal) return error(mal);
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

    // La contraseña NO vuelve: quien la escribió ya la tiene delante.
    return ok({ username: user.email });
  } catch (err) {
    return serverError(err);
  }
});
