// @prueba ligera
// De cuándo arrastra el efectivo el cierre de caja (16/09/2026, AV-0157 de Aumenta).
import { test } from "node:test";
import assert from "node:assert/strict";

import { tramoDeArrastre, esperadoAlCerrar } from "../lib/billing/caja.js";

test("con arqueo anterior, se arrastra desde el día siguiente a ese arqueo", () => {
  assert.deepEqual(tramoDeArrastre({ fondo: { importe: 100, fecha: "2026-09-10" }, fecha: "2026-09-15" }), {
    desde: "2026-09-11",
    hasta: "2026-09-14",
  });
});

test("SIN arqueo anterior se arrastra desde el primer día con dinero", () => {
  assert.deepEqual(tramoDeArrastre({ fondo: null, fecha: "2026-09-15", primerDia: "2026-07-24" }), {
    desde: "2026-07-24",
    hasta: "2026-09-14",
  });
});

test("no hay nada que arrastrar si el arqueo es de ayer, si es del mismo día, o si la caja está estrenada", () => {
  assert.equal(tramoDeArrastre({ fondo: { importe: 10, fecha: "2026-09-14" }, fecha: "2026-09-15" }), null);
  assert.equal(tramoDeArrastre({ fondo: { importe: 10, fecha: "2026-09-15" }, fecha: "2026-09-15" }), null);
  assert.equal(tramoDeArrastre({ fondo: null, fecha: "2026-09-15", primerDia: null }), null);
  assert.equal(tramoDeArrastre({ fondo: null, fecha: "2026-09-15", primerDia: "2026-09-15" }), null);
  assert.equal(tramoDeArrastre({ fecha: "15/09/2026" }), null);
});

test("el caso de Rosa: con el arrastre, el cierre deja de proponer un cajón en negativo", () => {
  // Producción, 15/09/2026: 354,50 cobrados, 500 de salidas, y 307,92 de antes.
  const sinArrastre = esperadoAlCerrar({ fondo: 0, arrastre: 0, efectivo: 354.5, salidas: 500 });
  const conArrastre = esperadoAlCerrar({ fondo: 0, arrastre: 307.92, efectivo: 354.5, salidas: 500 });
  assert.equal(sinArrastre, -145.5);
  assert.equal(conArrastre, 162.42);
});
