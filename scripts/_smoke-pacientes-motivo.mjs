// @prueba ligera
/**
 * AV-0135 (Aumenta, 15/09/2026): el motivo de consulta de cada paciente llega a
 * la ficha y a la lista de espera, y SOLO cuando se pide (`conMotivo`), para que
 * Citas y Facturación no reciban texto clínico.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pacientesPorFamilia } from "../lib/clients/pacientesDeLaFamilia.js";

const FILAS = [
  { id: "p1", clientId: "c1", firstName: "Hugo", lastName: "Castro", status: "active", referralReason: " Lectoescritura " },
  { id: "p2", clientId: "c1", firstName: "Marta", lastName: "Castro", status: "active", referralReason: "" },
];

function PatientFalso() {
  const pedidos = [];
  return {
    pedidos,
    async findAll({ attributes }) {
      pedidos.push(attributes);
      return FILAS.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => attributes.includes(k))));
    },
  };
}

test("sin conMotivo no pide ni devuelve el motivo", async () => {
  const Patient = PatientFalso();
  const mapa = await pacientesPorFamilia({ clientIds: ["c1"], Patient, hasModule: () => true });
  assert.ok(!Patient.pedidos[0].includes("referralReason"));
  assert.deepEqual(mapa.get("c1")[0], { id: "p1", nombre: "Hugo Castro", estado: "active" });
});

test("con conMotivo trae el motivo recortado y null si está vacío", async () => {
  const mapa = await pacientesPorFamilia({ clientIds: ["c1"], Patient: PatientFalso(), hasModule: () => true, conMotivo: true });
  const [hugo, marta] = mapa.get("c1");
  assert.equal(hugo.motivo, "Lectoescritura");
  assert.equal(marta.motivo, null);
});
