// @prueba ligera
// Fija lib/billing/ivaPorDefecto.js: la regla del IVA de una línea nueva,
// compartida por facturas y presupuestos (servidor y formularios).
import test from "node:test";
import assert from "node:assert/strict";
import { ivaPorDefecto } from "../lib/billing/ivaPorDefecto.js";

test("sin configuración, el 21 general", () => {
  assert.equal(ivaPorDefecto(null), 21);
  assert.equal(ivaPorDefecto(undefined), 21);
});

test("el emisor exento manda: cero, aunque tenga otro tipo por defecto", () => {
  assert.equal(ivaPorDefecto({ vatExempt: true, defaultVatRate: 21 }), 0);
  assert.equal(ivaPorDefecto({ vatExempt: true }), 0);
});

test("sin exención, el tipo por defecto del emisor", () => {
  assert.equal(ivaPorDefecto({ vatExempt: false, defaultVatRate: 10 }), 10);
  // los DECIMAL de Sequelize llegan como texto
  assert.equal(ivaPorDefecto({ vatExempt: false, defaultVatRate: "21.00" }), 21);
  // el 0 explícito es un tipo válido, no una ausencia
  assert.equal(ivaPorDefecto({ vatExempt: false, defaultVatRate: 0 }), 0);
});

test("un tipo ilegible no se cuela valiendo cero: cae al 21", () => {
  assert.equal(ivaPorDefecto({ vatExempt: false, defaultVatRate: null }), 21);
  assert.equal(ivaPorDefecto({ vatExempt: false, defaultVatRate: "no sé" }), 21);
});
