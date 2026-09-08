/**
 * _smoke-invoice-text.mjs — la traducción de la nota de un cobro ya generado a
 * su línea de factura (09/09/2026).
 *
 * Fija lo que el backfill NO debe hacer, que es lo que importa: si un nombre de
 * concepto no se reconoce, el cobro se queda como estaba en vez de imprimir
 * media frase; y el mes y el rótulo del prorrateo no se tocan nunca.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { traducirNota } from "./backfill-payments-invoice-text.js";

const TEXTOS = new Map([
  ["Cuota Logopedia 45x1", "Terapia 45 min semanales"],
  ["Cuota T.O. 45x1", "Terapia 45 min semanales"],
  ["Cuota Logopedia 60x1", "Terapia 1 h semanal"],
  ["Descuento reserva ya abonada", "Descuento por reserva de plaza ya abonada"],
  // Un concepto sin «Texto en la factura»: el backfill le pasa su propio nombre.
  ["Informe extra", "Informe extra"],
]);

describe("traducirNota — solo el trozo de los conceptos", () => {
  it("traduce los conceptos y deja el mes y el rótulo intactos", () => {
    assert.equal(
      traducirNota("Cuota septiembre 2026 — Cuota Logopedia 45x1 + Cuota T.O. 45x1 — 3 de 4 sesiones", TEXTOS),
      "Cuota septiembre 2026 — Terapia 45 min semanales + Terapia 45 min semanales — 3 de 4 sesiones"
    );
  });

  it("sin rótulo funciona igual", () => {
    assert.equal(
      traducirNota("Cuota septiembre 2026 — Cuota Logopedia 60x1", TEXTOS),
      "Cuota septiembre 2026 — Terapia 1 h semanal"
    );
  });

  it("un nombre desconocido deja el cobro como estaba", () => {
    assert.equal(traducirNota("Cuota septiembre 2026 — Cuota Fisioterapia 30x1", TEXTOS), null);
    // Y basta con que UNO de los dos no se reconozca.
    assert.equal(traducirNota("Cuota septiembre 2026 — Cuota Logopedia 45x1 + Cuota Rara", TEXTOS), null);
  });

  it("una nota sin conceptos (o escrita a mano) no se toca", () => {
    assert.equal(traducirNota("Cuota septiembre 2026", TEXTOS), null);
    assert.equal(traducirNota("Pagado en recepción", TEXTOS), null);
    assert.equal(traducirNota(null, TEXTOS), null);
  });

  it("si el texto de factura es el propio nombre, no hay nada que cambiar", () => {
    assert.equal(traducirNota("Cuota septiembre 2026 — Informe extra", TEXTOS), null);
  });

  it("y es idempotente: la frase ya traducida no vuelve a traducirse", () => {
    const traducida = "Cuota septiembre 2026 — Terapia 45 min semanales";
    assert.equal(traducirNota(traducida, TEXTOS), null);
  });
});
