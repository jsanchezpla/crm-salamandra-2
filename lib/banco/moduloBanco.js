import { getMasterModels } from "../db/masterDb.js";

/**
 * ¿Tiene este tenant el módulo `banco`? Para las piezas de SERVIDOR que no
 * pasan por withTenant (el layout de Facturación y la página de Banco, que
 * gatean pestaña y pantalla — las otras dos puertas ya las pone hasModule en
 * los endpoints).
 *
 * Si la consulta falla devuelve `false`, que aquí significa «no se enseña»:
 * mejor una pestaña que tarda un refresco en salir que una que lleva a un 403.
 */
export async function tieneModuloBanco(tenantSlug) {
  if (!tenantSlug) return false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { slug: tenantSlug } });
    if (!tenant) return false;
    const fila = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey: "banco" } });
    return !!fila?.enabled;
  } catch {
    return false;
  }
}
