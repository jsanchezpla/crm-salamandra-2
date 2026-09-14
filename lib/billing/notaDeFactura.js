/**
 * lib/billing/notaDeFactura.js — qué parte de las notas de una factura se
 * imprime en el PDF que recibe el cliente (14/09/2026, Aumenta).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Rodrigo: «que funcione montar una factura y esté con el logo de Aumenta y
 * todo bonito». Abriendo el PDF de la C2602282 (10/09/2026), debajo del sello
 * salía impreso, para la familia:
 *
 *   NOTAS
 *   Importado de Organízate el 2026-09-11. Cobrada: cobro del CRM del
 *   2026-09-10 por 78,75 €.
 *
 * Es rastro NUESTRO de la migración, no algo que se le diga a un cliente. Lo
 * llevan las ~14.450 facturas de Aumenta: el volcado del 02/08
 * (`_hechos/import-aumenta-contabilidad.js`, «Importado de Organízate el
 * AAAA-MM-DD») y las que trae `traer-facturas-de-organizate.js` (esa frase +
 * «Cobrada: cobro del CRM…» o «Sin cobro que la respalde en el CRM…»).
 *
 * ── POR QUÉ AL IMPRIMIR Y NO BORRANDO LA NOTA ──────────────────────────────
 * En la pantalla la nota sigue sirviendo —dice de dónde vino la factura y con
 * qué cobro se casó—, y reescribir 14.450 filas del histórico fiscal por un
 * papel sobra. Se quitan SOLO esas frases, con su forma exacta: lo que alguien
 * escriba a mano detrás o delante se sigue imprimiendo.
 *
 * Puro. Prueba en `scripts/_smoke-nota-de-factura.mjs`.
 */

const RASTRO = [
  // «Importado de Organízate el 2026-09-11.» — con o sin fecha, con o sin punto.
  /Importado de Organ[ií]zate(?: el \d{4}-\d{2}-\d{2})?\.?/giu,
  // «Cobrada: cobro del CRM del 2026-09-10 por 78,75 €.»
  /Cobrada: cobro del CRM del \d{4}-\d{2}-\d{2} por [\d.,]+ €\.?/gu,
  // «Sin cobro que la respalde en el CRM: queda emitida y pendiente.»
  /Sin cobro que la respalde en el CRM: queda emitida y pendiente\.?/gu,
];

/** Las notas que se imprimen; `null` si no queda nada que decirle al cliente. */
export function notaParaElCliente(notas) {
  if (notas == null) return null;
  let texto = String(notas);
  for (const re of RASTRO) texto = texto.replace(re, "");
  texto = texto
    .split("\n")
    .map((l) => l.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return texto || null;
}
