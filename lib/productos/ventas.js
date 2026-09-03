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
 * Agrega una lista de pedidos (objetos planos, con sus `lines`) en las cifras
 * que pinta la pantalla.
 *
 * `activos` es la lista de productos vivos del catálogo, para poder decir
 * cuántos no han vendido nada en el periodo — que es lo primero que se mira
 * cuando se decide qué retirar.
 */
export function agregarVentas(pedidos = [], { activos = [] } = {}) {
  const ventas = pedidos.filter((p) => ESTADOS_VENTA.includes(p.status));
  const cancelados = pedidos.filter((p) => p.status === "cancelled").length;
  const borradores = pedidos.filter((p) => p.status === "draft").length;

  let importe = 0;
  let unidades = 0;
  const porProducto = new Map();
  const porMes = new Map();
  const porOrigen = new Map();

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
      unidades += cantidad;
      m.unidades += cantidad;
      // Una línea sin producto del catálogo (texto libre) se agrupa por su
      // nombre: sigue siendo algo que se vendió.
      const clave = l.productId || `nombre:${l.productName}`;
      const f = porProducto.get(clave) ?? {
        productId: l.productId || null,
        nombre: l.productName || "(sin nombre)",
        unidades: 0,
        importe: 0,
        pedidos: new Set(),
      };
      f.unidades += cantidad;
      f.importe += num(l.lineTotal);
      f.pedidos.add(p.id);
      porProducto.set(clave, f);
    }
    porMes.set(mes, m);
  }

  const ranking = [...porProducto.values()]
    .map((f) => ({ ...f, unidades: redondea(f.unidades), importe: redondea(f.importe), pedidos: f.pedidos.size }))
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
