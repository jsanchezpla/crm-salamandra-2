/**
 * lib/productos/ventas.js — qué cuenta como venta y cómo se agrupa. PURO:
 * sin base, sin Next, sin fecha de hoy (03/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint de estadísticas
 * —vía `estadisticas.js`, que le pone la base y la puerta— y la prueba
 * `scripts/_smoke-productos.mjs`, que lo carga sin levantar nada. Está aparte
 * de `estadisticas.js` porque aquel importa `apiResponse.js` → `next/server`,
 * y eso no se puede cargar desde `npm test`.)
 *
 * ── QUÉ SE CUENTA COMO VENTA ────────────────────────────────────────────────
 * Un pedido que ha pasado de borrador y no está cancelado: `confirmed`,
 * `preparing`, `shipped` o `completed`. El borrador NO cuenta a propósito: un
 * carrito de la tienda nace en `draft` y solo el webhook de Stripe lo confirma
 * (docs/modules/tienda.md); contar borradores sería contar carritos
 * abandonados como dinero. Los cancelados se cuentan aparte, para que se vea
 * cuántos se cayeron.
 *
 * El periodo se mira por la fecha del pedido (`createdAt`), no por la de
 * entrega: la pregunta de la pantalla es «¿qué se vendió este mes?», y lo que
 * se sirvió tarde se vendió cuando se pidió.
 *
 * ── EL MARGEN (03/09/2026) ──────────────────────────────────────────────────
 * «Cuánto he vendido» va seguido de «cuánto he ganado». El margen de una línea
 * es lo que se cobró por ella menos lo que costó lo que se entregó: `lineTotal`
 * menos `coste unitario × cantidad`. El coste unitario NO está en el pedido —la
 * línea guarda el precio de venta, no el de compra—, así que llega de fuera en
 * `costes` (producto → coste por unidad), que arma `costesUnitarios`:
 *
 *   · con Inventario, el coste MEDIO de las entradas de ese producto, ponderado
 *     por cantidad (`StockEntry.unitCost` es el precio real que se pagó);
 *   · si no hay entradas con coste, el precio de compra de la ficha
 *     (`Product.purchasePrice`), que es el POR DEFECTO y así se dice.
 *
 * Un producto sin coste conocido —ni entradas ni precio de compra— o una línea
 * de texto libre sin producto no tiene margen: sale `null`, NO cero. Cero sería
 * decir «no se gana nada con esto», y lo que pasa es que no se sabe. El total
 * dice sobre cuánto importe se ha calculado (`sobreImporte`) y cuántos
 * productos se han quedado fuera (`sinCoste`), para que un 40 % no se lea como
 * el margen de todo cuando es el de la mitad.
 */

import { fechaISO } from "../utils/fechaLocal.js";

/** Estados de pedido que cuentan como venta. */
export const ESTADOS_VENTA = ["confirmed", "preparing", "shipped", "completed"];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const redondea = (n) => Math.round(n * 100) / 100;

/** 'AAAA-MM' de una fecha, en local (misma razón que `fechaISO`). */
function mesDe(fecha) {
  return fechaISO(fecha).slice(0, 7);
}

/**
 * El coste por unidad de cada producto, y de dónde ha salido.
 *
 * `productos` son las fichas (`{ id, purchasePrice }`) y `entradas` las entradas
 * de almacén con coste (`{ productId, quantity, unitCost }`). Si un producto
 * tiene entradas con coste, manda su media ponderada; si no, la ficha. La
 * `fuente` que se devuelve es la que domina: «entradas» en cuanto alguna se ha
 * usado, «ficha» si todo ha salido de las fichas.
 */
export function costesUnitarios({ productos = [], entradas = [] } = {}) {
  const costes = {};
  for (const p of productos) {
    if (!p?.id) continue;
    const precio = Number(p.purchasePrice);
    if (p.purchasePrice !== null && p.purchasePrice !== undefined && Number.isFinite(precio)) costes[p.id] = precio;
  }

  const acumulado = new Map();
  for (const e of entradas) {
    const cantidad = num(e?.quantity);
    const coste = Number(e?.unitCost);
    if (!e?.productId || cantidad <= 0 || e.unitCost === null || e.unitCost === undefined || !Number.isFinite(coste)) continue;
    const a = acumulado.get(e.productId) ?? { cantidad: 0, total: 0 };
    a.cantidad += cantidad;
    a.total += cantidad * coste;
    acumulado.set(e.productId, a);
  }
  let usaEntradas = false;
  for (const [productId, a] of acumulado) {
    costes[productId] = Math.round((a.total / a.cantidad) * 10000) / 10000;
    usaEntradas = true;
  }

  return { costes, fuente: usaEntradas ? "entradas" : "ficha" };
}

/**
 * Agrega una lista de pedidos (objetos planos, con sus `lines`) en las cifras
 * que pinta la pantalla.
 *
 * `activos` es la lista de productos vivos del catálogo, para poder decir
 * cuántos no han vendido nada en el periodo — que es lo primero que se mira
 * cuando se decide qué retirar.
 *
 * `costes` es producto → coste por unidad (ver `costesUnitarios`), y
 * `fuenteCoste` de dónde salió, que se devuelve tal cual para que la pantalla
 * lo diga. Sin `costes`, no hay margen: todo sale `null`.
 */
export function agregarVentas(pedidos = [], { activos = [], costes = null, fuenteCoste = "ficha" } = {}) {
  const ventas = pedidos.filter((p) => ESTADOS_VENTA.includes(p.status));
  const cancelados = pedidos.filter((p) => p.status === "cancelled").length;
  const borradores = pedidos.filter((p) => p.status === "draft").length;

  let importe = 0;
  let unidades = 0;
  let margenImporte = 0;
  let importeConCoste = 0;
  const porProducto = new Map();
  const porMes = new Map();
  const porOrigen = new Map();

  const costeDe = (productId) => {
    if (!costes || !productId) return null;
    const c = costes[productId];
    return c === null || c === undefined || !Number.isFinite(Number(c)) ? null : Number(c);
  };

  for (const p of ventas) {
    const total = num(p.total);
    importe += total;

    const mes = mesDe(p.createdAt);
    const m = porMes.get(mes) ?? { mes, pedidos: 0, importe: 0, unidades: 0 };
    m.pedidos += 1;
    m.importe += total;

    const origen = p.origin || "manual";
    const o = porOrigen.get(origen) ?? { origen, pedidos: 0, importe: 0 };
    o.pedidos += 1;
    o.importe += total;
    porOrigen.set(origen, o);

    for (const l of p.lines ?? []) {
      const cantidad = num(l.quantity);
      const lineTotal = num(l.lineTotal);
      unidades += cantidad;
      m.unidades += cantidad;
      // Una línea sin producto del catálogo (texto libre) se agrupa por su
      // nombre: sigue siendo algo que se vendió.
      const clave = l.productId || `nombre:${l.productName}`;
      const coste = costeDe(l.productId);
      const f = porProducto.get(clave) ?? {
        productId: l.productId || null,
        nombre: l.productName || "(sin nombre)",
        unidades: 0,
        importe: 0,
        pedidos: new Set(),
        coste,
        margen: null,
      };
      f.unidades += cantidad;
      f.importe += lineTotal;
      f.pedidos.add(p.id);
      if (coste !== null) {
        const margenLinea = lineTotal - coste * cantidad;
        f.margen = (f.margen ?? 0) + margenLinea;
        margenImporte += margenLinea;
        importeConCoste += lineTotal;
      }
      porProducto.set(clave, f);
    }
    porMes.set(mes, m);
  }

  const ranking = [...porProducto.values()]
    .map((f) => ({
      ...f,
      unidades: redondea(f.unidades),
      importe: redondea(f.importe),
      pedidos: f.pedidos.size,
      margen: f.margen === null ? null : redondea(f.margen),
    }))
    .sort((a, b) => b.importe - a.importe || b.unidades - a.unidades || a.nombre.localeCompare(b.nombre, "es"));

  const vendidos = new Set(ranking.map((f) => f.productId).filter(Boolean));
  const sinVentas = activos.filter((a) => !vendidos.has(a.id)).length;

  return {
    totales: {
      pedidos: ventas.length,
      importe: redondea(importe),
      unidades: redondea(unidades),
      ticketMedio: ventas.length ? redondea(importe / ventas.length) : 0,
      cancelados,
      borradores,
    },
    margen: {
      importe: redondea(margenImporte),
      // Sobre lo que SÍ tiene coste, no sobre todo lo vendido: si no, un
      // producto sin precio de compra bajaría el porcentaje sin ser peor.
      pct: importeConCoste > 0 ? redondea((margenImporte / importeConCoste) * 100) : null,
      sobreImporte: redondea(importeConCoste),
      sinCoste: ranking.filter((f) => f.margen === null).length,
      fuente: fuenteCoste,
    },
    porProducto: ranking,
    porMes: [...porMes.values()]
      .map((m) => ({ ...m, importe: redondea(m.importe), unidades: redondea(m.unidades) }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
    porOrigen: [...porOrigen.values()]
      .map((o) => ({ ...o, importe: redondea(o.importe) }))
      .sort((a, b) => b.importe - a.importe),
    sinVentas,
    productosActivos: activos.length,
  };
}
