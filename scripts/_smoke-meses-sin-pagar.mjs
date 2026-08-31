// @prueba ligera
// Fija lib/billing/mesesSinPagar.js: la morosidad no acusa de meses en los que
// el centro aún no cobraba por el CRM.
import test from "node:test";
import assert from "node:assert/strict";
import { mesesSeguidosSinPagar } from "../lib/billing/mesesSinPagar.js";

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
