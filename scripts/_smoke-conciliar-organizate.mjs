// @prueba ligera
/**
 * _smoke-conciliar-organizate.mjs — el reparto de
 * `scripts/conciliar-facturas-organizate.js` (18/09/2026, AV-0176).
 *
 * Es dinero de un cliente real: lo que se prueba es lo que DEVUELVE la
 * función, caso a caso. Si sale un céntimo de más o de menos, el arqueo de
 * Aumenta deja de cuadrar.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { repartir } from "./conciliar-facturas-organizate.js";

const suma = (asignaciones) =>
  Math.round(asignaciones.reduce((s, a) => s + a.trozos.reduce((n, t) => n + t.importe, 0), 0) * 100) / 100;

test("un cobro por factura: cada uno entero y sin cortes", () => {
  const r = repartir(
    [{ id: "f1", total: 160 }, { id: "f2", total: 115 }],
    [{ id: "c1", amount: 160 }, { id: "c2", amount: 115 }]
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.asignaciones, [
    { facturaId: "f1", trozos: [{ cobroId: "c1", importe: 160, parte: "entero" }] },
    { facturaId: "f2", trozos: [{ cobroId: "c2", importe: 115, parte: "entero" }] },
  ]);
});

test("un cobro que cubre dos facturas se parte en dos trozos (el caso de Sara Isabel)", () => {
  const r = repartir(
    [{ id: "f1", total: 160 }, { id: "f2", total: 115 }],
    [{ id: "c1", amount: 275 }]
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.asignaciones, [
    { facturaId: "f1", trozos: [{ cobroId: "c1", importe: 160, parte: "corte" }] },
    { facturaId: "f2", trozos: [{ cobroId: "c1", importe: 115, parte: "corte" }] },
  ]);
  assert.equal(suma(r.asignaciones), 275);
});

test("dos cobros para una factura: la factura lleva dos trozos y no se parte nada", () => {
  const r = repartir([{ id: "f1", total: 380 }], [{ id: "c1", amount: 190 }, { id: "c2", amount: 190 }]);
  assert.equal(r.ok, true);
  assert.equal(r.asignaciones.length, 1);
  assert.deepEqual(r.asignaciones[0].trozos.map((t) => t.parte), ["entero", "entero"]);
  assert.equal(suma(r.asignaciones), 380);
});

test("céntimos: 33,33 + 33,33 + 33,34 contra un cobro de 100", () => {
  const r = repartir(
    [{ id: "f1", total: 33.33 }, { id: "f2", total: 33.33 }, { id: "f3", total: 33.34 }],
    [{ id: "c1", amount: 100 }]
  );
  assert.equal(r.ok, true);
  assert.equal(suma(r.asignaciones), 100);
  assert.deepEqual(r.asignaciones.map((a) => a.trozos[0].importe), [33.33, 33.33, 33.34]);
});

test("si no cuadra al céntimo, no reparte nada", () => {
  const r = repartir([{ id: "f1", total: 145 }], [{ id: "c1", amount: 115 }]);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /145 € y los cobros 115 €/);
  assert.deepEqual(r.asignaciones, []);
});

test("sin facturas o sin cobros, tampoco", () => {
  assert.equal(repartir([], [{ id: "c1", amount: 10 }]).ok, false);
  assert.equal(repartir([{ id: "f1", total: 10 }], []).ok, false);
});

test("un importe negativo o a cero no se reparte", () => {
  assert.equal(repartir([{ id: "f1", total: 0 }], [{ id: "c1", amount: 0 }]).ok, false);
  assert.equal(repartir([{ id: "f1", total: -10 }], [{ id: "c1", amount: -10 }]).ok, false);
});

test("los importes valen como cadena, que es como los da Sequelize", () => {
  const r = repartir([{ id: "f1", total: "190.00" }, { id: "f2", total: "380.00" }], [{ id: "c1", amount: "570.00" }]);
  assert.equal(r.ok, true);
  assert.equal(suma(r.asignaciones), 570);
});
