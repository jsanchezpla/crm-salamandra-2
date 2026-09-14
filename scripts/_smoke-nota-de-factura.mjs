// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-nota-de-factura.mjs — el rastro de la migración no se imprime en la
 * factura del cliente (14/09/2026, Aumenta).
 *
 *   node scripts/_smoke-nota-de-factura.mjs
 *
 * Nace del PDF de la C2602282, que le decía a la familia «Importado de
 * Organízate el 2026-09-11. Cobrada: cobro del CRM del 2026-09-10 por
 * 78,75 €.». Las notas son LITERALES de producción. Fija
 * `lib/billing/notaDeFactura.js` y que `invoicePdf.js` la usa.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notaParaElCliente } from "../lib/billing/notaDeFactura.js";

describe("el rastro de la migración se queda fuera", () => {
  it("la de septiembre con cobro", () => {
    assert.equal(
      notaParaElCliente("Importado de Organízate el 2026-09-11. Cobrada: cobro del CRM del 2026-09-10 por 78,75 €."),
      null,
    );
  });
  it("la de septiembre sin cobro", () => {
    assert.equal(
      notaParaElCliente("Importado de Organízate el 2026-09-09. Sin cobro que la respalde en el CRM: queda emitida y pendiente."),
      null,
    );
  });
  it("la del volcado del 02/08, con y sin fecha", () => {
    assert.equal(notaParaElCliente("Importado de Organízate el 2026-08-02"), null);
    assert.equal(notaParaElCliente("Importado de Organízate"), null);
  });
  it("con los miles con punto en el importe", () => {
    assert.equal(notaParaElCliente("Cobrada: cobro del CRM del 2026-09-10 por 1.078,75 €."), null);
  });
});

describe("lo escrito a mano se sigue imprimiendo", () => {
  it("una nota normal, tal cual", () => {
    assert.equal(notaParaElCliente("Pago por transferencia antes del día 5."), "Pago por transferencia antes del día 5.");
  });
  it("lo añadido detrás del rastro sobrevive, sin espacios colgando", () => {
    assert.equal(
      notaParaElCliente("Importado de Organízate el 2026-08-02. Sesiones de julio de Hugo."),
      "Sesiones de julio de Hugo.",
    );
  });
  it("los saltos de línea de lo escrito se respetan", () => {
    assert.equal(
      notaParaElCliente("Primera línea\nImportado de Organízate el 2026-08-02\nSegunda línea"),
      "Primera línea\nSegunda línea",
    );
  });
  it("la anulación al partir SÍ se imprime: es información para el cliente", () => {
    assert.equal(notaParaElCliente("Anulación de C2602100 para partirla por paciente"), "Anulación de C2602100 para partirla por paciente");
  });
  it("vacío o nulo no imprime nada y no revienta", () => {
    assert.equal(notaParaElCliente(null), null);
    assert.equal(notaParaElCliente(undefined), null);
    assert.equal(notaParaElCliente("   "), null);
  });
});

describe("el PDF la usa", () => {
  it("invoicePdf.js imprime notaParaElCliente y no invoice.notes a pelo", () => {
    const src = readFileSync(new URL("../lib/billing/invoicePdf.js", import.meta.url), "utf8");
    assert.match(src, /notaParaElCliente\(invoice\.notes\)/);
    assert.doesNotMatch(src, /\.text\(invoice\.notes/);
  });
});
