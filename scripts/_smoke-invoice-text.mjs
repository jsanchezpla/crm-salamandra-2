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

describe("traducirNota — de la nota solo salen los conceptos", () => {
  it("deja el mes, el rótulo y la trazabilidad fuera: solo el concepto", () => {
    assert.equal(
      traducirNota(
        "Cuota septiembre 2026 — Cuota Logopedia 60x1 — Reserva de plaza ya abonada: −30 € — " +
          "Pendiente según Organízate: 350.00 € (Organízate #20232); el CRM tenía 350.00 €",
        TEXTOS
      ),
      "Terapia 1 h semanal"
    );
  });

  it("varios conceptos van juntos, en su orden", () => {
    assert.equal(
      traducirNota("Cuota septiembre 2026 — Cuota Logopedia 45x1 + Cuota T.O. 45x1 — 3 de 4 sesiones", TEXTOS),
      "Terapia 45 min semanales + Terapia 45 min semanales"
    );
  });

  it("un nombre desconocido deja el cobro como estaba", () => {
    assert.equal(traducirNota("Cuota septiembre 2026 — Cuota Fisioterapia 30x1", TEXTOS), null);
    // Y basta con que UNO de los dos no se reconozca.
    assert.equal(traducirNota("Cuota septiembre 2026 — Cuota Logopedia 45x1 + Cuota Rara", TEXTOS), null);
  });

  it("una nota sin trozo de conceptos no se toca", () => {
    assert.equal(traducirNota("Cuota septiembre 2026", TEXTOS), null);
    assert.equal(traducirNota("Pagado en recepción", TEXTOS), null);
    assert.equal(traducirNota(null, TEXTOS), null);
  });

  it("un concepto sin «Texto en la factura» se imprime con su propio nombre", () => {
    assert.equal(traducirNota("Cuota septiembre 2026 — Informe extra", TEXTOS), "Informe extra");
  });
});
