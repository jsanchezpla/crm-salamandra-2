/**
 * lib/productos/estadisticas.js — las ventas del catálogo en un periodo
 * (03/09/2026, módulo Productos avanzado): la puerta y la lectura de la base.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparte el endpoint con lo que venga
 * después —un Excel o un PDF, como en Clínica—. El CÁLCULO está en
 * `ventas.js`, puro y con su prueba; aquí solo se le da la base y la puerta.
 * Todo se CUENTA en lectura sobre los pedidos reales del periodo: no hay
 * contadores guardados que puedan quedarse desfasados.)
 */

import { Op } from "sequelize";
import { forbidden } from "../utils/apiResponse.js";
import { fechaISO } from "../utils/fechaLocal.js";
import { agregarVentas, costesUnitarios, ESTADOS_VENTA } from "./ventas.js";

export { agregarVentas, costesUnitarios, ESTADOS_VENTA };

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Portón del endpoint: Productos avanzado y rol de dirección. Son cifras de
 * dinero de TODO el centro, y el CRM ya distingue entre lo que ve cada
 * profesional y lo que ve quien dirige (mismo criterio que Clínica).
 */
export function gateEstadisticasProductos(ctx) {
  if (!ctx.hasModule("productos_avanzado")) return forbidden("Módulo Productos avanzado no activo");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección ve las estadísticas de venta");
  return null;
}

/** ¿El error es «esa tabla no existe» (42P01)? */
function tablaNoExiste(err) {
  return err?.original?.code === "42P01" || err?.parent?.code === "42P01";
}

/**
 * Las cifras del periodo, leídas de la base. Si el cliente tiene el avanzado
 * pero no Pedidos, sus tablas no existen: se devuelve `disponible: false` en
 * vez de un 500, y la pantalla lo explica.
 *
 * `conInventario` (03/09/2026, el margen): con el módulo, el coste de cada
 * producto es el medio de sus entradas de almacén; sin él —o sin entradas con
 * coste— el precio de compra de la ficha. Lo decide `costesUnitarios`; aquí
 * solo se leen las dos tablas. El precio de compra NO sale de aquí hacia
 * ningún sitio público: este endpoint es de dirección.
 */
export async function calcularEstadisticasProductos(tenantModels, rango, { conInventario = false } = {}) {
  const { Order, OrderLine, Product, StockEntry } = tenantModels;
  const periodo = { desde: fechaISO(rango.inicio), hasta: fechaISO(rango.fin) };

  let pedidos;
  try {
    pedidos = await Order.findAll({
      where: { createdAt: { [Op.between]: [rango.inicio, rango.fin] } },
      include: [{ model: OrderLine, as: "lines" }],
      order: [["createdAt", "ASC"]],
    });
  } catch (err) {
    if (tablaNoExiste(err)) return { disponible: false, motivo: "sin-pedidos", periodo };
    throw err;
  }

  // Todas las fichas, no solo las activas: un producto retirado que vendió en
  // el periodo sigue en el ranking y necesita su precio de compra.
  const productos = (await Product.findAll({ attributes: ["id", "name", "active", "purchasePrice"] })).map((p) => p.toJSON());
  const activos = productos.filter((p) => p.active).map(({ id, name }) => ({ id, name }));

  let entradas = [];
  if (conInventario && StockEntry) {
    try {
      entradas = await StockEntry.findAll({
        attributes: ["productId", "quantity", "unitCost"],
        where: { unitCost: { [Op.ne]: null } },
        raw: true,
      });
    } catch (err) {
      // Tiene el módulo pero no la tabla (schema a medias): se calcula con la
      // ficha y se dice, en vez de tumbar el bloque entero.
      if (!tablaNoExiste(err)) throw err;
    }
  }
  const { costes, fuente } = costesUnitarios({ productos, entradas });

  return {
    disponible: true,
    periodo,
    ...agregarVentas(pedidos.map((p) => p.toJSON()), { activos, costes, fuenteCoste: fuente }),
  };
}
