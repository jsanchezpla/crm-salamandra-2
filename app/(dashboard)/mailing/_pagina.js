import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { vocabularioCliente } from "../../../lib/clients/vocabulario.js";

/**
 * Lo que comparten las cinco páginas de /mailing: comprobar en el SERVIDOR que
 * el tenant tiene el módulo (para quien no lo tiene, la pantalla no existe:
 * `notFound()`, como Lista de espera o Fichas a completar) y resolver el
 * idioma del centro (`vocabularioCliente`), que la pantalla es de cliente y
 * no puede preguntar por los módulos sin exponérselos al navegador.
 *
 * Tres puertas, como manda la regla 6: menú (Sidebar), página (esto) y
 * endpoint (`exigirMailing` en cada ruta de /api/mailing).
 */
const modulosActivos = cache(async (slug) => {
  if (!slug) return new Set();
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = await Tenant.findOne({ where: { slug } });
    if (!tenant) return new Set();
    const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
    return new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));
  } catch {
    return new Set();
  }
});

export async function contextoMailing() {
  const headersList = await headers();
  const activos = await modulosActivos(headersList.get("x-tenant"));
  if (!activos.has("mailing")) notFound();
  const tieneModulo = (k) => activos.has(k);
  return {
    vocab: vocabularioCliente(tieneModulo),
    conClientes: activos.has("clients"),
    conCitas: activos.has("citas"),
  };
}
