/**
 * lib/billing/pendienteDeLaCuota.js — qué hacer con el cobro de un mes cuando
 * cambia el importe de la cuota y la familia YA ha pagado una parte
 * (10/09/2026, Rodrigo).
 *
 * El encargo, con su ejemplo: «debe 80 y le cobro 30, se queda pendiente a
 * deber 50. Si entre medias, antes de que pague, subo la cuota a 100, debe
 * automáticamente 70. IMPORTANTE: si un paciente ha pagado la cuota completa y
 * ha completado su cobro ANTES de subir la cuota, no le salta de pronto un
 * cobro pendiente de 20 euros».
 *
 * Las dos mitades son la misma regla: **lo ya cobrado no se toca, y lo único
 * que se mueve es el resto.** Subir la cuota a 100 con 30 dentro deja 70
 * pendientes; subirla a 100 con los 80 ya cobrados y nada pendiente no crea
 * nada, porque ese mes se cerró por 80 y reabrirlo sería pasarle a una familia
 * una decisión posterior a su pago.
 *
 * ── POR QUÉ NO BASTABA CON LO QUE HABÍA ────────────────────────────────────
 *
 * `sincronizarCobroDelMes` buscaba el cobro del mes con un `findOne` por
 * (cuota, mes) sin mirar el estado. Desde que un pago parcial PARTE la fila
 * (07/09/2026, `cobroParcial.js`) hay dos filas con esa misma pareja —la
 * cobrada y la que sigue pendiente— y cuál devolvía Postgres era cosa suya:
 *
 *   · si salía la cobrada, se daba por intocable y la pendiente se quedaba con
 *     el importe viejo, así que la subida de cuota no llegaba a ninguna parte;
 *   · si salía la pendiente, se le escribía encima la cuota ENTERA y la
 *     familia acababa debiendo 100 después de haber pagado 30.
 *
 * El índice único de `migrate-payments-cuota-unica` solo cubre los PENDIENTES,
 * a propósito: por eso lo que hay siempre es «como mucho un pendiente, y
 * detrás las filas que ya son dinero o papel».
 *
 * Puro y sin base de datos (regla #2 de /lib): quien llama trae las filas del
 * mes y ejecuta lo que aquí se decide. Su prueba, en
 * `scripts/_smoke-pendiente-de-la-cuota.mjs`.
 */

import { cobroSePuedeRehacer } from "./cuotas.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Un céntimo de margen, el mismo que usa el resto de la facturación. */
const MARGEN = 0.0049;

/**
 * Un cobro DEVUELTO o FALLIDO no es dinero que haya entrado.
 *
 * Cuenta como fila del mes —y por eso frena que nazca otra— pero su importe no
 * se le resta a nadie: quien devolvió 30 € vuelve a deberlos. Sin esta línea,
 * una devolución dejaría la cuota cobrada a ojos del CRM y el pendiente se
 * retiraría solo.
 */
const esDineroDeVerdad = (p) => p?.status !== "refunded" && p?.status !== "failed";

/**
 * Las filas del mes de una cuota, separadas en las dos cosas que son.
 *
 * @param {Array} filas cobros de esa cuota y ese mes (pendientes y cobrados)
 * @returns {{ pendiente: object|null, cerradas: Array, yaCerrado: number }}
 *   · `pendiente` la única que todavía se puede rehacer (pendiente, sin
 *     factura, sin Stripe, sin banco). Si por lo que fuera hubiera varias, la
 *     primera: el orden lo pone quien llama.
 *   · `cerradas`  las que ya no se reescriben —cobradas, facturadas, y también
 *     las devueltas y las fallidas—.
 *   · `yaCerrado` cuánto suman las que además son DINERO: eso es lo que este
 *     mes ya tiene resuelto, y lo que se le descuenta al pendiente.
 */
export function repartoDelMes(filas = []) {
  const pendientes = [];
  const cerradas = [];
  for (const p of Array.isArray(filas) ? filas : []) {
    if (cobroSePuedeRehacer(p).ok) pendientes.push(p);
    else cerradas.push(p);
  }
  return {
    pendiente: pendientes[0] ?? null,
    cerradas,
    yaCerrado: round2(
      cerradas.filter(esDineroDeVerdad).reduce((s, p) => s + (Number(p?.amount) || 0), 0)
    ),
  };
}

/**
 * Qué hacer con el cobro del mes cuando la cuota pasa a valer `esperado`.
 *
 * @param {object} p
 * @param {number|string} p.esperado lo que vale ese mes AHORA (ya prorrateado)
 * @param {Array} p.filas            los cobros de esa cuota y ese mes
 *
 * @returns {{accion: string, importe: number|null, yaCerrado: number, pendiente: object|null, cerradas: Array, motivo: string|null}}
 *   · `crear`      no hay nada de ese mes: nace el pendiente por `importe`.
 *   · `actualizar` el pendiente pasa a valer `importe` (lo nuevo menos lo ya cobrado).
 *   · `retirar`    lo ya cobrado cubre el mes entero: el pendiente sobra.
 *   · `sin-tocar`  el mes ya está cerrado y no queda pendiente: no se crea nada.
 */
export function ajusteDelPendiente({ esperado, filas = [] } = {}) {
  const { pendiente, cerradas, yaCerrado } = repartoDelMes(filas);
  const base = { yaCerrado, pendiente, cerradas, motivo: null };
  const total = round2(esperado);
  const resto = round2(total - yaCerrado);

  if (!pendiente) {
    /*
     * ESTO ES EL «IMPORTANTE» DEL ENCARGO. Con el mes ya cobrado y nada
     * pendiente, una subida de cuota NO abre un cobro nuevo: la familia pagó lo
     * que se le pidió y no puede aparecerle una deuda de 20 € por un cambio de
     * tarifa hecho después. Si de verdad hay que cobrarle esa diferencia,
     * alguien la registra a mano y sabe lo que está haciendo.
     */
    if (cerradas.length) {
      return {
        ...base,
        accion: "sin-tocar",
        importe: null,
        // Con una devolución detrás el mes NO está cobrado, pero tampoco se le
        // abre un cobro nuevo por detrás: quien devolvió decide qué hacer.
        motivo: yaCerrado > 0 ? "ese mes ya está cobrado" : "ese mes ya tiene su cobro, devuelto o fallido",
      };
    }
    return { ...base, accion: "crear", importe: total };
  }

  // Bajar la cuota por debajo de lo ya cobrado no deja «resto negativo»: el mes
  // está cubierto y el pendiente sobra. Es la misma puerta por la que ya salía
  // una cuota que deja de tocar ese mes.
  if (resto <= MARGEN) {
    return { ...base, accion: "retirar", importe: null, motivo: "lo ya cobrado cubre el mes" };
  }

  return { ...base, accion: "actualizar", importe: resto };
}
