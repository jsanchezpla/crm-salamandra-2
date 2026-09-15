// @prueba ligera
/**
 * _smoke-fecha-al-cobrar.mjs — cobrar un pendiente pone la fecha de hoy
 * (15/09/2026, AV-0148 y AV-0149 de Aumenta).
 *
 *   node scripts/_smoke-fecha-al-cobrar.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fechaAlCobrar } from "../lib/billing/fechaAlCobrar.js";

const hoy = "2026-09-15";
const base = { estadoOriginal: "pending", fechaOriginal: "2026-09-01", hoy };

test("un pendiente del día 1 que se marca cobrado pasa a hoy", () => {
  assert.equal(fechaAlCobrar({ ...base, estadoNuevo: "completed", fechaActual: "2026-09-01" }), hoy);
});

test("si ya se cambió la fecha a mano, manda la de la persona", () => {
  assert.equal(fechaAlCobrar({ ...base, estadoNuevo: "completed", fechaActual: "2026-09-12" }), "2026-09-12");
});

test("volver a pendiente sin haber tocado nada devuelve la fecha de la cuota", () => {
  assert.equal(fechaAlCobrar({ ...base, estadoNuevo: "pending", fechaActual: hoy }), "2026-09-01");
});

test("un cobro que ya estaba cobrado no cambia de fecha al cambiar de estado", () => {
  assert.equal(
    fechaAlCobrar({ estadoOriginal: "completed", estadoNuevo: "refunded", fechaOriginal: "2026-09-03", fechaActual: "2026-09-03", hoy }),
    "2026-09-03"
  );
});
