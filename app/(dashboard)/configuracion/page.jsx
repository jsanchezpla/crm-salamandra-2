import { headers } from "next/headers";

import ConfigModule from "../../../modules/config/ConfigModule.jsx";
import { getMasterModels } from "../../../lib/db/masterDb.js";

export const metadata = { title: "Configuración" };

/**
 * Qué módulos tiene el tenant, resuelto AQUÍ y no dentro del componente.
 *
 * `ConfigModule` es un "use client": no puede preguntar por los módulos. Los
 * necesita para atenuar las tarjetas cuyo módulo no está contratado y decir de
 * cuál dependen (`lib/configuracion/pestanas.js`). Mismo patrón que la ficha de
 * cliente, que resuelve sus piezas en servidor con `fichaSegunModulos`.
 *
 * Si la consulta falla se devuelve `null`, y eso significa «no lo sé»: entonces
 * NO se avisa de nada. Un aviso falso —«necesita Citas» a quien tiene Citas—
 * manda a la persona a pedir algo que ya tiene, y eso es peor que no avisar.
 */
async function modulosDelTenant(tenantSlug) {
  if (!tenantSlug) return null;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { slug: tenantSlug } });
    if (!tenant) return null;
    const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
    return filas.filter((f) => f.enabled).map((f) => f.moduleKey);
  } catch {
    return null;
  }
}

export default async function ConfiguracionPage() {
  const headersList = await headers();
  const modulos = await modulosDelTenant(headersList.get("x-tenant"));
  return <ConfigModule modulos={modulos} />;
}
