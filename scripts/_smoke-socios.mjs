// @prueba ligera
// Fija lib/billing/socios.js: la vara única que decide si se enseña lo de
// socios (pestaña «Por socio», campo Socio en factura y gasto, Cliente del
// gasto).
import test from "node:test";
import assert from "node:assert/strict";
import { haySocios } from "../lib/billing/socios.js";

test("con socios configurados, se enseña", () => {
  assert.equal(haySocios({ partners: [{ id: "a", name: "Ana" }] }), true);
});

test("sin socios, sin lista, sin settings o con basura: escondido", () => {
  assert.equal(haySocios({ partners: [] }), false);
  assert.equal(haySocios({}), false);
  assert.equal(haySocios(null), false);
  assert.equal(haySocios({ partners: "jorge" }), false);
});
