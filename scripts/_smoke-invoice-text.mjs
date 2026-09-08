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

// ── El ensayo del 09/09/2026: las notas del volcado llevan trazabilidad nuestra
describe("traducirNota — la trazabilidad interna no se imprime", () => {
  it("quita los trozos que hablan del Organízate y deja los que explican el importe", () => {
    assert.equal(
      traducirNota(
        "Cuota septiembre 2026 — Cuota Logopedia 60x1 — Reserva de plaza ya abonada: −30 € — " +
          "Pendiente según Organízate: 350.00 € (Organízate #20232); el CRM tenía 350.00 €",
        TEXTOS
      ),
      "Cuota septiembre 2026 — Terapia 1 h semanal — Reserva de plaza ya abonada: −30 €"
    );
  });

  it("también cuando lo único que sobra es de dónde se cobró", () => {
    assert.equal(
      traducirNota(
        "Cuota septiembre 2026 — Cuota Logopedia 45x1 — Cobrado en Organízate el 02/09/2026 (pago 16539, tarjeta)",
        TEXTOS
      ),
      "Cuota septiembre 2026 — Terapia 45 min semanales"
    );
  });

  it("y una nota que solo era traza se queda en el mes y el concepto", () => {
    assert.equal(
      traducirNota("Cuota septiembre 2026 — Informe extra — Cobrado en Organízate el 02/09/2026", TEXTOS),
      "Cuota septiembre 2026 — Informe extra"
    );
  });
});
