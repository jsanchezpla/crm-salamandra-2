import { NextResponse } from "next/server";
import { getMasterModels } from "../../../../lib/db/masterDb.js";

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
    User.findByPk(userId, { attributes: ["id", "email", "role", "tenantId", "moduleAccess"] }),
    Tenant.findOne({ where: { slug: tenantSlug }, attributes: ["id", "slug", "name", "status"] }),
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

  // Si moduleAccess está vacío o el usuario es superadmin, le damos todos los activos del tenant
  const enabledModules =
    user.role === "superadmin" || userAccess.length === 0
      ? Array.from(tenantEnabled).sort()
      : userAccess.filter((k) => tenantEnabled.has(k)).sort();

  return NextResponse.json(
    {
      ok: true,
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        enabledModules,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
