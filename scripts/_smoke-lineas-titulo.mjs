// @prueba ligera
// Fija los apartados con título (kind: "titulo") en lib/billing/calculateInvoice.js:
// un rótulo de sección se queda en su sitio, a cero, y no pisa sumas ni desglose.
import test from "node:test";
import assert from "node:assert/strict";
import { calculateInvoice } from "../lib/billing/calculateInvoice.js";

test("un título no suma ni aparece en el desglose de IVA", () => {
  const r = calculateInvoice({
    lines: [
      { kind: "titulo", description: "Septiembre" },
      { description: "Cuota mensual", quantity: 1, unitPrice: 100, vatRate: 21 },
    ],
  });
  assert.equal(r.taxBase, 100);
  assert.equal(r.vatAmount, 21);
  assert.equal(r.total, 121);
  // El desglose solo lleva el 21: sin la fila fantasma «IVA 0 %» del título.
  assert.deepEqual(Object.keys(r.vatBreakdown), ["21"]);
});

test("una línea de descuento fijo (precio negativo) resta del total sin trucos", () => {
  const r = calculateInvoice({
    lines: [
      { description: "Cuota septiembre", quantity: 1, unitPrice: 190, vatRate: 0 },
      { description: "Descuento reserva ya abonada", quantity: 1, unitPrice: -30, vatRate: 0 },
    ],
  });
  assert.equal(r.taxBase, 160);
  assert.equal(r.total, 160);
  assert.equal(r.lines[1].lineTotal, -30);
});

test("el título conserva su sitio y su texto, con todo a cero", () => {
  const r = calculateInvoice({
    lines: [
      { description: "A", quantity: 1, unitPrice: 10, vatRate: 0 },
      { kind: "titulo", description: "Material", quantity: 99, unitPrice: 500, vatRate: 21 },
      { description: "B", quantity: 1, unitPrice: 5, vatRate: 0 },
    ],
  });
  assert.equal(r.lines.length, 3);
  assert.equal(r.lines[1].kind, "titulo");
  assert.equal(r.lines[1].description, "Material");
  // Aunque alguien cuele números en un título, no cuentan: es un rótulo.
  assert.equal(r.lines[1].lineTotal, 0);
  assert.equal(r.total, 15);
});
