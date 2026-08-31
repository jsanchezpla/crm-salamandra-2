// @prueba ligera
// Fija lib/billing/empleadosSugeridos.js: los terapeutas del paciente arriba,
// el resto detrás, y nada se pierde ni se duplica.
import test from "node:test";
import assert from "node:assert/strict";
import { ordenarConSugeridos } from "../lib/billing/empleadosSugeridos.js";

const EQUIPO = [
  { id: "a", displayName: "Ana" },
  { id: "b", displayName: "Bea" },
  { id: "c", displayName: "Carla" },
];

test("los sugeridos suben en su orden (la referencia primero) y se marcan", () => {
  const r = ordenarConSugeridos(EQUIPO, ["c", "a"]);
  assert.deepEqual(r.map((e) => e.id), ["c", "a", "b"]);
  assert.deepEqual(r.map((e) => e.sugerido), [true, true, false]);
});

test("sin sugeridos, la lista queda igual y sin marcas", () => {
  const r = ordenarConSugeridos(EQUIPO, []);
  assert.deepEqual(r.map((e) => e.id), ["a", "b", "c"]);
  assert.equal(r.some((e) => e.sugerido), false);
});

test("un sugerido que ya no está en la plantilla no revienta ni se inventa", () => {
  const r = ordenarConSugeridos(EQUIPO, ["zz", "b"]);
  assert.deepEqual(r.map((e) => e.id), ["b", "a", "c"]);
  assert.equal(r.length, 3);
});

test("entradas raras: listas nulas devuelven lo que se pueda, sin tirar", () => {
  assert.deepEqual(ordenarConSugeridos(null, ["a"]), []);
  assert.deepEqual(ordenarConSugeridos(EQUIPO, null).map((e) => e.id), ["a", "b", "c"]);
});
