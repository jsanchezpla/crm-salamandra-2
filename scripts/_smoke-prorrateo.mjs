// @prueba ligera
// Fija lib/billing/prorrateo.js: la parte proporcional de una cuota cuando la
// familia empieza a mitad de mes.
import test from "node:test";
import assert from "node:assert/strict";
import { prorrateoDeCuota } from "../lib/billing/prorrateo.js";

test("empezar el 15 de septiembre cobra 16 de 30 días", () => {
  const r = prorrateoDeCuota(190, "2026-09-15");
  assert.equal(r.diasCobrados, 16);
  assert.equal(r.diasDelMes, 30);
  assert.equal(r.importe, 101.33);
});

test("el día 1 es la cuota entera; el último día, un solo día", () => {
  assert.equal(prorrateoDeCuota(190, "2026-09-01").importe, 190);
  const ultimo = prorrateoDeCuota(310, "2026-10-31");
  assert.equal(ultimo.diasCobrados, 1);
  assert.equal(ultimo.diasDelMes, 31);
  assert.equal(ultimo.importe, 10);
});

test("febrero bisiesto cuenta 29 días", () => {
  const r = prorrateoDeCuota(290, "2028-02-15");
  assert.equal(r.diasDelMes, 29);
  assert.equal(r.diasCobrados, 15);
  assert.equal(r.importe, 150);
});

test("un descuento (negativo) también se prorratea", () => {
  assert.equal(prorrateoDeCuota(-30, "2026-09-16").importe, -15);
});

test("una fecha ilegible o imposible devuelve null, no un importe inventado", () => {
  assert.equal(prorrateoDeCuota(190, "no sé"), null);
  assert.equal(prorrateoDeCuota(190, "2026-02-31"), null);
  assert.equal(prorrateoDeCuota(190, ""), null);
});
