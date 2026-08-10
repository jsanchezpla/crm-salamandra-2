import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { CATALOGO, RECOMENDADOS, PAQUETES } from "../../../../lib/provisioning/catalogo.js";
import { altaTenant, slugDesdeNombre } from "../../../../lib/provisioning/altaTenant.js";
import { whereClientesVisibles, pideSuspendidos } from "../../../../lib/provisioning/clientesVisibles.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Alta de clientes — el panel de Salamandra Solutions.
 *
 * ⚠️ ENDPOINT MÁS PODEROSO DEL CRM: crea tenants, schemas y administradores.
 * Por eso lleva TRES candados encadenados:
 *   1. El módulo `provisioning`, que solo tiene nuestro propio tenant.
 *   2. Rol admin leído FRESCO de la base de datos (no del token).
 *   3. Nunca desde la demo pública (que da sesión admin a cualquiera).
 *
 * GET  → catálogo de módulos + lista de clientes existentes.
 * POST → crea el cliente completo y devuelve sus credenciales UNA vez.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { Tenant, TenantModule } = getMasterModels();

    // ESTA es la única pantalla que sabe reactivar un cliente, así que es la
    // única que puede pedir los suspendidos — y solo si se lo piden a propósito
    // (`?incluirSuspendidos=1`, detrás de un interruptor que viene apagado).
    // Si se escondieran también aquí, no quedaría ninguna forma de reactivar a
    // nadie sin entrar a la base de datos a mano.
    const conSuspendidos = pideSuspendidos(request);

    const tenants = await Tenant.findAll({
      where: whereClientesVisibles(conSuspendidos),
      attributes: ["id", "name", "slug", "plan", "status", "createdAt"],
      order: [["createdAt", "DESC"]],
    });

    // Cuántos quedan fuera, para poder ofrecer el interruptor sin mentir («ver
    // los 2 suspendidos») y para no ofrecerlo cuando no hay ninguno.
    const suspendidos = conSuspendidos
      ? tenants.filter((t) => t.status !== "active").length
      : await Tenant.count({ where: { status: "suspended" } });
    const modulos = await TenantModule.findAll({
      where: { enabled: true },
      attributes: ["tenantId", "moduleKey"],
    });
    const porTenant = new Map();
    for (const m of modulos) {
      if (!porTenant.has(m.tenantId)) porTenant.set(m.tenantId, []);
      porTenant.get(m.tenantId).push(m.moduleKey);
    }

    return ok({
      catalogo: CATALOGO,
      recomendados: RECOMENDADOS,
      paquetes: PAQUETES,
      clientes: tenants.map((t) => ({
        id: t.id,
        nombre: t.name,
        slug: t.slug,
        plan: t.plan,
        estado: t.status,
        alta: t.createdAt,
        modulos: (porTenant.get(t.id) || []).sort(),
      })),
      suspendidos,
      incluyeSuspendidos: conSuspendidos,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const res = await altaTenant({
      nombre: body.nombre,
      slug: body.slug || slugDesdeNombre(body.nombre),
      modulos: body.modulos,
      adminEmail: body.adminEmail,
      brand: body.brand || {},
      fiscal: body.fiscal || {},
      plan: body.plan || "starter",
    });

    if (res.error) return error(res.error, res.status || 400);

    // Rastro en auditoría: quién dio de alta a quién. La contraseña NUNCA.
    try {
      const { AuditLog } = getMasterModels();
      await AuditLog.create({
        tenantId: ctx.tenant.id,
        userId: ctx.user?.id ?? request.headers.get("x-user-id"),
        action: "provisioning.cliente_creado",
        entity: "Tenant",
        entityId: res.tenantId,
        before: null,
        after: { slug: res.slug, nombre: body.nombre, modulos: res.modulos },
        ip: request.headers.get("x-forwarded-for") ?? null,
      });
    } catch { /* auditoría best-effort */ }

    return created(res);
  } catch (err) {
    return serverError(err);
  }
});
