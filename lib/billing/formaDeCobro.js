/**
 * lib/billing/formaDeCobro.js — cómo se rotula por dónde entró el dinero
 * (18/09/2026, AV-0188 de Aumenta; decidido por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: el mapa de rótulos estaba copiado en cinco
 * pantallas —Cobros, el cajón, la ficha del cliente, la del paciente y el
 * resumen de caja— y la regla nueva tiene que valer en todas a la vez. Copiada
 * cinco veces se separa a la primera.)
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * Rosa mandó una captura de Cobros con una fila que decía «Transferencia ·
 * Pendiente». Eso se lee como dinero que ya entró por el banco, y no había
 * entrado nada: hasta el 10/09/2026 la columna `method` era obligatoria y el
 * generador de cuotas la rellenaba con `transfer` para tapar el hueco. En
 * Aumenta quedan 125 cobros pendientes arrastrando una forma de pago que nadie
 * eligió (124 «Transferencia» y 1 «Tarjeta»).
 *
 * Rodrigo: «si están pendientes los cobros pon que todavía no hay método de
 * pago».
 *
 * ── LA REGLA ───────────────────────────────────────────────────────────────
 * **Un cobro PENDIENTE no tiene forma de pago, diga lo que diga la columna.**
 * Mientras nadie ha pagado no se sabe por dónde va a entrar el dinero, así que
 * se rotula «Ninguno». En cuanto se cobra, manda la columna.
 *
 * Se arregla en la LECTURA y no reescribiendo las 125 filas: el dato viejo no
 * estorba a nadie más —el arqueo y la caja solo miran lo cobrado— y tocar filas
 * de un centro en uso para arreglar un rótulo es cambiar el precio por el
 * escaparate. Si algún día se limpian, esta función sigue dando lo mismo.
 */

/** El rótulo de cada forma de pago, tal cual se enseña. */
export const FORMAS_DE_COBRO = {
  card: "Tarjeta",
  transfer: "Transferencia",
  cash: "Efectivo",
  direct_debit: "Domiciliación",
};

/** Lo que se enseña cuando todavía no hay forma de pago. */
export const SIN_FORMA = "Ninguno";

/** Las opciones del desplegable, en el orden de siempre. */
export const OPCIONES_DE_COBRO = Object.entries(FORMAS_DE_COBRO).map(([value, label]) => ({ value, label }));

/**
 * Cómo se rotula la forma de pago de un cobro. Pura.
 *
 * @param {{ status?: string, method?: string|null }|null} cobro
 */
export function formaDeCobro(cobro) {
  if (!cobro) return SIN_FORMA;
  // Pendiente: no hay dinero, así que no hay forma — aunque la columna diga otra cosa.
  if (String(cobro.status ?? "") === "pending") return SIN_FORMA;
  return FORMAS_DE_COBRO[cobro.method] ?? (cobro.method ? String(cobro.method) : SIN_FORMA);
}

/**
 * ¿Ese rótulo es el de «todavía no se sabe»? Lo usa la pantalla para pintarlo
 * en gris en vez de como un dato más.
 */
export function esSinForma(etiqueta) {
  return etiqueta === SIN_FORMA;
}
