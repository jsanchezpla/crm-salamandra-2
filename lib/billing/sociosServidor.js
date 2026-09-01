/**
 * La mitad de SERVIDOR de lib/billing/socios.js: para las piezas que no pasan
 * por withTenant (el layout de Facturación, que gatea la pestaña «Por socio»).
 * Va en fichero aparte para que la regla pura pueda importarse desde
 * componentes de cliente sin arrastrar Sequelize al bundle.
 *
 * Si la consulta falla devuelve `false`: mejor una pestaña que tarda un
 * refresco en salir que una que lleva a una tabla vacía.
 */
import { getTenantDb } from "../db/tenantDb.js";
import { haySocios } from "./socios.js";

export async function centroConSocios(tenantSlug) {
  if (!tenantSlug) return false;
  try {
    const { models } = getTenantDb(tenantSlug);
    const settings = await models.TenantBillingSettings.findOne();
    return haySocios(settings);
  } catch {
    return false;
  }
}
