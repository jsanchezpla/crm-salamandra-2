// @prueba ligera
// Los pagos de la ficha del paciente traen también los de su familia sin hijo concreto
// (15/09/2026, AV-0129 de Aumenta), con la misma regla que las facturas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Op } from "sequelize";

import { whereFacturasDelPaciente, esDeLaFamilia } from "../lib/billing/facturasDelPaciente.js";

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("la regla trae los suyos y los de la familia sin paciente, nunca los del hermano", () => {
  const w = whereFacturasDelPaciente({ patientId: "P", clientId: "F", conLasDeLaFamilia: true, Op });
  assert.deepEqual(w[Op.or], [{ patientId: "P" }, { clientId: "F", patientId: null }]);
  assert.equal(esDeLaFamilia({ patientId: null }), true);
  assert.equal(esDeLaFamilia({ patientId: "P" }), false);
});

test("sin familia conocida, solo los suyos", () => {
  assert.deepEqual(whereFacturasDelPaciente({ patientId: "P", clientId: null, conLasDeLaFamilia: false, Op }), { patientId: "P" });
});

test("la API de cobros la usa en Op.and (no pisa el Op.or de la búsqueda)", () => {
  const ruta = leer("app/api/billing/payments/route.js");
  assert.match(ruta, /conLasDeLaFamilia"\) === "1"/);
  assert.match(ruta, /where\[Op\.and\] = \[whereFacturasDelPaciente\(/);
});

test("la ficha los pide y los marca «de la familia»", () => {
  const ficha = leer("components/billing/PatientBillingSection.jsx");
  assert.match(ficha, /payments\?patientId=\$\{patientId\}&conLasDeLaFamilia=1/);
  assert.match(ficha, /esDeLaFamilia\(p\)/);
});
