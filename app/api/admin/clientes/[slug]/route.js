import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../../lib/demo/isDemo.js";
import { invalidateTenantCache } from "../../../../../lib/tenant/tenantResolver.js";
import { editarTenant } from "../../../../../lib/provisioning/cicloVida.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * PATCH /api/admin/clientes/[slug] — editar un cliente ya existente.
 *
 * Cubre lo que faltaba del alta: cambiar nombre, plan y marca, activar o quitar
 * módulos, y suspender o reactivar. Antes todo eso era SSH y scripts sueltos.
 *
 * Tres candados, los mismos que el alta: módulo `provisioning` (que solo tiene
 * nuestro tenant), rol admin leído FRESCO de la base de datos, y nunca desde la
 * demo pública. Estar en el subdominio interno no cuenta como autorización.
 *
 * SUSPENDER exige `confirmar: true` en el cuerpo. No es burocracia: el resolutor
 * de tenants solo carga los clientes 'active', así que suspender echa a sus
 * usuarios EN EL ACTO y tumba sus widgets públicos. Un clic de más antes de eso
 * está bien empleado.
 *
 * No existe DELETE. Borrar el schema de un cliente sigue siendo un script que se
 * corre a mano mirando lo que se va a destruir.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { slug } = await params;
    if (!slug || !/^[a-z0-9_]+$/.test(slug)) return notFound("Cliente no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    // Nadie se suspende a sí mismo por accidente: dejaría a Salamandra sin poder
    // entrar en su propio panel, y para arreglarlo haría falta SSH.
    if (body.estado === "suspended" && slug === ctx.slug) {
      return error("No puedes suspender el tenant desde el que estás trabajando", 409);
    }
    if (body.estado === "suspended" && body.confirmar !== true) {
      return error(
        "Suspender echa a sus usuarios de inmediato y tumba sus widgets públicos. Vuelve a enviarlo con confirmar: true.",
        428
      );
    }

    const res = await editarTenant(slug, body);
    if (res.error) return error(res.error, res.status ?? 400);

    // La caché del tenant EDITADO, no la del nuestro: si no, el cliente seguiría
    // viendo hasta un minuto sus módulos viejos.
    invalidateTenantCache(slug);

    // Se audita contra el tenant de Salamandra —que es quien hace la acción— y
    // se guarda a QUIÉN se le hizo. Solo el resumen de lo que cambió: aquí no
    // pasan credenciales.
    if (Object.keys(res.aplicado).length) {
      const { userId, ip } = datosPeticion(request);
      const { Tenant } = getMasterModels();
      const destino = await Tenant.findOne({ where: { slug }, attributes: ["id"] });
      await auditar({
        tenantId: ctx.tenant.id,
        userId,
        action: "provisioning.cliente_editado",
        entity: "Tenant",
        entityId: destino?.id ?? null,
        before: { slug },
        after: res.aplicado,
        ip,
      });
    }

    return ok({ slug, aplicado: res.aplicado, avisos: res.avisos });
  } catch (err) {
    return serverError(err);
  }
});
