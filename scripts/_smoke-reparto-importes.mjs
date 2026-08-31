// @prueba ligera
// Fija lib/billing/repartoImportes.js: partir un importe entre pagadores sin
// perder ni inventar un céntimo, barrido céntimo a céntimo.
import test from "node:test";
import assert from "node:assert/strict";
import { repartoIgual, repartoPorPorcentajes, porcentajesCuadran } from "../lib/billing/repartoImportes.js";

const suma = (xs) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

test("50/50 exacto y con céntimo impar", () => {
  assert.deepEqual(repartoIgual(120, 2), [60, 60]);
  assert.deepEqual(repartoIgual(120.01, 2), [60, 60.01]);
  assert.deepEqual(repartoIgual(100, 3), [33.33, 33.33, 33.34]);
});

test("porcentajes: la última parte cierra la diferencia", () => {
  assert.deepEqual(repartoPorPorcentajes(190, [70, 30]), [133, 57]);
  assert.deepEqual(repartoPorPorcentajes(100, [33.33, 33.33, 33.34]), [33.33, 33.33, 33.34]);
});

test("barrido: mil totales al azar fijo, siempre cuadra al céntimo", () => {
  for (let c = 1; c <= 1000; c++) {
    const total = Math.round((c * 37.77) % 100000) / 100 + 0.01;
    for (const partes of [2, 3, 5]) {
      const r = repartoIgual(total, partes);
      assert.equal(suma(r), Math.round(total * 100) / 100, `igual ${total}/${partes}`);
    }
    const p = repartoPorPorcentajes(total, [12.5, 37.5, 50]);
    assert.equal(suma(p), Math.round(total * 100) / 100, `pct ${total}`);
  }
});

test("porcentajesCuadran tolera el redondeo del teclado y nada más", () => {
  assert.equal(porcentajesCuadran([50, 50]), true);
  assert.equal(porcentajesCuadran([33.33, 33.33, 33.34]), true);
  assert.equal(porcentajesCuadran([60, 30]), false);
});

test("entradas raras no revientan: total 0 o lista vacía devuelven ceros", () => {
  assert.deepEqual(repartoIgual(0, 2), [0, 0]);
  assert.deepEqual(repartoPorPorcentajes(0, [50, 50]), [0, 0]);
  assert.deepEqual(repartoPorPorcentajes(100, []), []);
});
