import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ProductosModule from "../../../modules/productos/ProductosModule.jsx";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { MODULE_KEYS } from "../../../lib/tenant/moduleKeys.js";

export const metadata = { title: "Productos" };

/**
 * Productos tiene DOS niveles, como Documentos (03/09/2026, Rodrigo):
 *   - `productos`           → básico: el catálogo y su valor.
 *   - `productos_avanzado`  → estadísticas de venta encima, y de él cuelgan
 *                             Inventario, Pedidos y Tienda.
 *
 * Quién tiene cuál se resuelve aquí, en el servidor: el módulo es un componente
 * de cliente y no puede preguntarlo por su cuenta sin exponer la lista de
 * módulos del tenant al navegador. La página también mira si el cliente tiene
 * Inventario y Tienda, porque la lista enseña el stock y el «a la venta» solo
 * donde significan algo.
 *
 * `notFound()` sin el básico, como en «Fichas a completar»: para quien no lo
 * tiene, la pantalla no existe.
 */
export default async function ProductosPage() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");

  let activo = false;
  let avanzado = false;
  let conInventario = false;
  let conPedidos = false;
  let conTienda = false;
  try {
    const { Tenant, TenantModule } = getMasterModels();
    const tenant = slug ? await Tenant.findOne({ where: { slug } }) : null;
    if (tenant) {
      const filas = await TenantModule.findAll({
        where: { tenantId: tenant.id },
        attributes: ["moduleKey", "enabled"],
      });
      const encendidos = new Set(filas.filter((f) => f.enabled).map((f) => f.moduleKey));
      activo = encendidos.has(MODULE_KEYS.PRODUCTOS);
      avanzado = encendidos.has(MODULE_KEYS.PRODUCTOS_AVANZADO);
      // Los tres solo cuentan con el avanzado: sin él no salen en el menú y la
      // API de cada uno sigue siendo la puerta.
      conInventario = avanzado && encendidos.has(MODULE_KEYS.INVENTORY);
      conPedidos = avanzado && encendidos.has(MODULE_KEYS.ORDERS);
      conTienda = avanzado && encendidos.has(MODULE_KEYS.TIENDA);
    }
  } catch {
    // Ante la duda, cerrado: la API gatea igual, así que enseñar la pantalla
    // solo serviría para que diera 403 al cargar.
    activo = false;
  }

  if (!activo) notFound();
  return (
    <ProductosModule
      avanzado={avanzado}
      conInventario={conInventario}
      conPedidos={conPedidos}
      conTienda={conTienda}
    />
  );
}
