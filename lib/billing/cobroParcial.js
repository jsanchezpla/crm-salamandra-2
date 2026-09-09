/**
 * lib/billing/cobroParcial.js — cobrar un mes A MEDIAS sin perder lo que falta
 * (07/09/2026, decisión de Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: es la decisión pura —qué se cobra y qué se
 * queda pendiente cuando la familia trae menos de lo que se le pidió—, y se
 * prueba sin base de datos en `scripts/_smoke-cobro-parcial.mjs`. El POST de
 * cobros la ejecuta.)
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Al registrar un cobro de un mes que tiene UN solo cobro pendiente, el POST
 * hacía `p.update({ status: "completed", amount: importe })` sobre esa fila,
 * sin comparar el importe con lo que se debía. La fila de 160 € se convertía en
 * una de 100 € cobrada y **los 60 € que faltaban no quedaban en ninguna parte**:
 * ni pendiente, ni deuda, ni rastro.
 *
 * Y no era un caso raro, era el camino normal: una familia con UNA cuota tiene
 * un solo pendiente al mes. Medido en `aumenta` en septiembre de 2026, de las
 * 273 familias con cuota viva y cobro generado, **266 tenían una sola fila** y
 * solo 7 tenían varias. O sea que el «mes pagado a medias» solo se podía ver en
 * las familias con dos hermanos, y por accidente.
 *
 * ── LA REGLA ───────────────────────────────────────────────────────────────
 * Si traen MENOS de lo pendiente, la fila se PARTE: lo que traen queda cobrado
 * y el resto sigue pendiente, del mismo mes y de la misma cuota. Si traen lo
 * mismo o más, se cobra la fila entera como hasta hoy (de más se absorbe en
 * ella: quien cobra sabrá por qué, y partir por arriba no significa nada).
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Un céntimo de margen, el mismo que usa el resto de la facturación. */
const MARGEN = 0.0049;

/**
 * Qué hacer con un cobro pendiente cuando llega un importe.
 *
 * @param {object} p
 * @param {number|string} p.pendiente lo que esa fila pedía (los DECIMAL llegan como texto)
 * @param {number|string} p.importe   lo que la familia trae
 *
 * @returns {{accion: "cobrar-entero"|"partir", cobrado: number, restoPendiente: number}}
 *   · `cobrar-entero` la fila pasa a cobrada con `cobrado` (lo tecleado).
 *   · `partir`        la fila pasa a cobrada con `cobrado` y nace otra pendiente
 *                     por `restoPendiente`, que es lo que sigue debiendo.
 */
export function decidirCobroDelPendiente({ pendiente, importe } = {}) {
  const debe = round2(pendiente);
  const trae = round2(importe);

  // Sin un pendiente que comparar, o sin dinero, no hay nada que partir: se
  // comporta como siempre.
  if (!Number.isFinite(debe) || debe <= 0 || !Number.isFinite(trae) || trae <= 0) {
    return { accion: "cobrar-entero", cobrado: trae > 0 ? trae : 0, restoPendiente: 0 };
  }

  // Traen lo mismo (o de más): la fila se cobra entera. De más se absorbe en
  // ella, como hasta hoy.
  if (trae + MARGEN >= debe) {
    return { accion: "cobrar-entero", cobrado: trae, restoPendiente: 0 };
  }

  return { accion: "partir", cobrado: trae, restoPendiente: round2(debe - trae) };
}

/**
 * ── CUÁL DE LOS PENDIENTES SE ESTÁ PAGANDO (09/09/2026, AV-0085 de Aumenta) ──
 *
 * Con VARIOS pendientes del mes, hasta hoy solo se saldaban si el importe era
 * exactamente su SUMA; con cualquier otra cifra se apuntaba un cobro nuevo y
 * los pendientes se quedaban donde estaban.
 *
 * En Aumenta eso dejó a una familia con 260 € cobrados y 375 € pendientes el
 * mismo mes: tenía dos pendientes (260 de logopedia y 115 de terapia
 * ocupacional), Rosa cobró los 260 de uno de ellos y el CRM, en vez de saldar
 * ese, creó una fila nueva. La familia consta a la vez como pagada y como
 * morosa, y el arqueo cuenta un dinero que ya estaba contado.
 *
 * La regla: si lo que traen COINCIDE con lo que pide uno de los pendientes, se
 * está pagando ESE. No hay que adivinar nada — el importe lo dice.
 *
 * Con dos pendientes del mismo importe la cifra no desempata, así que se coge
 * el más antiguo (el orden en que llegan) y quien cobra puede corregirlo desde
 * «Editar». Elegir el primero es lo mismo que ya hace el cobro de la suma.
 *
 * @param {Array} pendientes filas pendientes, en el orden en que se prefieren
 * @param {number|string} importe lo que la familia trae
 * @returns la fila que casa, o null si ninguna
 */
export function pendienteQueCasa(pendientes = [], importe) {
  const trae = round2(importe);
  if (!Number.isFinite(trae) || trae <= 0) return null;
  return (
    (Array.isArray(pendientes) ? pendientes : []).find(
      (p) => Math.abs(round2(p?.amount) - trae) < 0.005
    ) ?? null
  );
}
