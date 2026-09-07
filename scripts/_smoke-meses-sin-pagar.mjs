// @prueba ligera
// Fija lib/billing/mesesSinPagar.js: la morosidad no acusa de meses en los que
// el centro aún no cobraba por el CRM.
import test from "node:test";
import assert from "node:assert/strict";
import { mesesSeguidosSinPagar, loQueFaltaDelMes } from "../lib/billing/mesesSinPagar.js";

const MESES = ["2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04"];

test("un mes pagado corta la cuenta", () => {
  assert.equal(mesesSeguidosSinPagar({ meses: MESES, pagados: new Set(["2026-07"]), primerMes: "2026-01" }), 2);
  assert.equal(mesesSeguidosSinPagar({ meses: MESES, pagados: new Set(["2026-09"]), primerMes: "2026-01" }), 0);
});

test("el arranque de la caja corta la cuenta: nadie debe meses de antes del primer cobro del centro", () => {
  // El centro empezó a cobrar por el CRM en septiembre: una familia sin pagar
  // septiembre debe UN mes, no seis.
  assert.equal(mesesSeguidosSinPagar({ meses: MESES, pagados: new Set(), primerMes: "2026-09" }), 1);
  // Empezó en julio: como mucho tres (sep, ago, jul).
  assert.equal(mesesSeguidosSinPagar({ meses: MESES, pagados: new Set(), primerMes: "2026-07" }), 3);
});

test("sin tope (centro veterano), la ventana entera cuenta", () => {
  assert.equal(mesesSeguidosSinPagar({ meses: MESES, pagados: new Set(), primerMes: "2020-01" }), 6);
  assert.equal(mesesSeguidosSinPagar({ meses: MESES, pagados: new Set(), primerMes: null }), 6);
});

test("un mes pagado a medias (07/09/2026): con cuota de 160 y 100 cobrados, debe 60", () => {
  assert.deepEqual(loQueFaltaDelMes({ pagado: 100, esperado: 160 }), { debe: 60, pagado: 100, esperado: 160 });
});

test("un mes cubierto, o sin cuota con que comparar, no falta nada", () => {
  assert.equal(loQueFaltaDelMes({ pagado: 160, esperado: 160 }), null);
  assert.equal(loQueFaltaDelMes({ pagado: 159.995, esperado: 160 }), null);
  assert.equal(loQueFaltaDelMes({ pagado: 0, esperado: null }), null);
  assert.equal(loQueFaltaDelMes({ pagado: 50, esperado: 0 }), null);
});
