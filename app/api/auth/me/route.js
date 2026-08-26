import { NextResponse } from "next/server";
import { correoDeCuenta } from "../../../../lib/auth/correoCuenta.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { veTodaLaAgenda } from "../../../../lib/citas/visibilidad.js";

/**
 * GET /api/auth/me
 *
 * Devuelve datos del usuario autenticado actual + tenant + módulos habilitados.
 * Lee userId/role/tenantSlug de los headers que inyecta el middleware.
 *
 * Respuesta:
 *   { id, email, role, tenantId, tenantSlug, tenantName, enabledModules: [...] }
 *
 * Nunca expone passwordHash ni moduleAccess raw.
 * Cache-Control: no-store para que el cliente no cachee roles obsoletos.
 */
export async function GET(request) {
  const userId = request.headers.get("x-user-id");
  const tenantSlug = request.headers.get("x-tenant");

  if (!userId || !tenantSlug) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { User, Tenant, TenantModule } = getMasterModels();

  const [user, tenant] = await Promise.all([
    User.findByPk(userId, { attributes: ["id", "email", "role", "tenantId", "moduleAccess", "emailContacto"] }),
    // `settings` entra para poder contestar `veTodaLaAgenda` (abajo). NO se
    // devuelve NUNCA: lleva las credenciales de integraciones del cliente.
    Tenant.findOne({ where: { slug: tenantSlug }, attributes: ["id", "slug", "name", "status", "settings"] }),
  ]);

  if (!user || !tenant || tenant.status !== "active") {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Resolver módulos habilitados intersectando: módulos activados en el tenant
  // ∩ módulos a los que el User tiene acceso (User.moduleAccess en master).
  const tenantModules = await TenantModule.findAll({
    where: { tenantId: tenant.id, enabled: true },
    attributes: ["moduleKey"],
  });
  const tenantEnabled = new Set(tenantModules.map((m) => m.moduleKey));
  const userAccess = Array.isArray(user.moduleAccess) ? user.moduleAccess : [];

  // Wildcard explícito: superadmin O moduleAccess incluye "all". Un array vacío
  // significa LITERALMENTE "sin acceso" (caso del usuario portal).
  const isWildcard = user.role === "superadmin" || userAccess.includes("all");
  const enabledModules = isWildcard
    ? Array.from(tenantEnabled).sort()
    : userAccess.filter((k) => tenantEnabled.has(k)).sort();

  return NextResponse.json(
    {
      ok: true,
      data: {
        id: user.id,
        email: user.email,
        // A dónde se le escribe a esta cuenta, o null si no hay a dónde.
        // Lo pinta Configuración; `email` de aquí arriba es el identificador.
        correo: correoDeCuenta(user),
        role: user.role,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        enabledModules,
        /*
         * ¿Ve la agenda de todo el centro? (26/08/2026)
         *
         * La pantalla de Citas decidía esto por ROL, y por eso el filtro por
         * profesional era solo de dirección. En un centro con la agenda
         * compartida —Aumenta la tiene desde el 28/07 y es el único— eso deja a
         * las quince terapeutas con las citas de las dieciocho personas
         * mezcladas y sin nada con que separarlas, bajo una etiqueta que además
         * ponía «solo tus citas», que era falsa.
         *
         * Se contesta con la MISMA función que usa el servidor para filtrar
         * (lib/citas/visibilidad.js), para que pantalla y servidor no puedan
         * decir cosas distintas. Es un booleano derivado: `settings` no sale de
         * aquí.
         */
        veTodaLaAgenda: veTodaLaAgenda({ tenant, role: user.role }),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
