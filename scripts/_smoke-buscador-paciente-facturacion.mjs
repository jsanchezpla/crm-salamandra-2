// @prueba ligera
// Fija lib/clients/familiasPorPaciente.js (buscar facturas/presupuestos por el
// nombre del niño) y que los dos endpoints de Facturación lo usan de verdad.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { idsDeFamiliaPorPaciente } from "../lib/clients/familiasPorPaciente.js";

const conModulos = (...tiene) => (k) => tiene.includes(k);

function pacienteFalso(filas) {
  return {
    sequelize: {}, // hasUnaccentSupport falla y cae a «sin tildes»: el lado seguro
    findAll: async () => filas,
  };
}

test("devuelve las familias de los pacientes que casan, sin duplicados", async () => {
  const Patient = pacienteFalso([
    { clientId: 7 },
    { clientId: 7 },
    { clientId: 12 },
    { clientId: null },
  ]);
  const ids = await idsDeFamiliaPorPaciente({ q: "hugo", Patient, hasModule: conModulos("pacientes") });
  assert.deepEqual(ids.sort(), [7, 12].sort());
});

test("sin texto, sin modelo o sin módulo asistencial: lista vacía y nadie consulta", async () => {
  let consultado = false;
  const Patient = { sequelize: {}, findAll: async () => { consultado = true; return []; } };
  assert.deepEqual(await idsDeFamiliaPorPaciente({ q: "", Patient, hasModule: conModulos("pacientes") }), []);
  assert.deepEqual(await idsDeFamiliaPorPaciente({ q: "hugo", Patient: null, hasModule: conModulos("pacientes") }), []);
  assert.deepEqual(await idsDeFamiliaPorPaciente({ q: "hugo", Patient, hasModule: conModulos("billing") }), []);
  assert.equal(consultado, false);
});

test("la tabla sin migrar (42P01) no tumba el buscador: lista vacía", async () => {
  const Patient = {
    sequelize: {},
    findAll: async () => { const e = new Error("no existe"); e.parent = { code: "42P01" }; throw e; },
  };
  assert.deepEqual(await idsDeFamiliaPorPaciente({ q: "hugo", Patient, hasModule: conModulos("clinica") }), []);
});

test("otro error de base NO se esconde", async () => {
  const Patient = {
    sequelize: {},
    findAll: async () => { const e = new Error("se cayó"); e.parent = { code: "57P01" }; throw e; },
  };
  await assert.rejects(() => idsDeFamiliaPorPaciente({ q: "hugo", Patient, hasModule: conModulos("clinica") }));
});

test("facturas y presupuestos importan el helper (nadie copia el bloque)", () => {
  for (const ruta of ["../app/api/billing/invoices/route.js", "../app/api/billing/quotes/route.js"]) {
    const codigo = readFileSync(new URL(ruta, import.meta.url), "utf8");
    assert.match(codigo, /familiasPorPaciente\.js/, `${ruta} no usa el helper`);
    assert.match(codigo, /idsDeFamiliaPorPaciente\(/, `${ruta} no llama al helper`);
  }
});
