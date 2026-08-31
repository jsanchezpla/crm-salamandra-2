// @prueba ligera
// Fija lib/billing/conceptosCatalogo.js: qué acepta el catálogo y qué línea
// de factura sale de elegir un concepto.
import test from "node:test";
import assert from "node:assert/strict";
import { limpiarConcepto, lineaDesdeConcepto } from "../lib/billing/conceptosCatalogo.js";

test("un alta buena entra saneada", () => {
  const { valores, problema } = limpiarConcepto({
    name: "  Cuota Logopedia 60x2 ",
    description: "Sesiones Logopedia 1 hora, 2 veces por semana",
    unitPrice: "370",
    vatRate: 0,
    category: "Cuotas mensuales",
    periodicity: "mensual",
  });
  assert.equal(problema, null);
  assert.equal(valores.name, "Cuota Logopedia 60x2");
  assert.equal(valores.unitPrice, 370);
  assert.equal(valores.vatRate, 0);
});

test("sin nombre no hay concepto; importes e IVA raros se rechazan con frase", () => {
  assert.match(limpiarConcepto({ name: "  " }).problema, /nombre/);
  assert.match(limpiarConcepto({ name: "X", unitPrice: -5 }).problema, /importe/);
  assert.match(limpiarConcepto({ name: "X", unitPrice: 10, vatRate: 130 }).problema, /IVA/);
});

test("la edición parcial solo toca lo que viaja", () => {
  const { valores, problema } = limpiarConcepto({ unitPrice: 380 }, { parcial: true });
  assert.equal(problema, null);
  assert.deepEqual(Object.keys(valores), ["unitPrice"]);
});

test("elegir un concepto rellena la línea: texto, cantidad 1, precio e IVA", () => {
  const linea = lineaDesdeConcepto({ name: "Entrevista Inicial", description: "", unitPrice: "50.00", vatRate: "0.00" });
  assert.deepEqual(linea, { description: "Entrevista Inicial", quantity: 1, unitPrice: 50, discountPct: 0, vatRate: 0 });
  const conTexto = lineaDesdeConcepto({ name: "Cuota", description: "Sesión semanal de 1 h", unitPrice: 190, vatRate: 0 });
  assert.equal(conTexto.description, "Sesión semanal de 1 h");
  assert.equal(lineaDesdeConcepto(null), null);
});
