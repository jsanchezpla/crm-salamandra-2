// @prueba ligera
/**
 * _smoke-nombre-en-la-agenda.mjs — en la rejilla manda el paciente
 * (08/09/2026, AV-0088 de Aumenta).
 *
 * Laura: «al generar nuevas citas nos sale en horario el nombre de la madre en
 * lugar del nombre del paciente». La agenda pintaba el titular de la ficha, que
 * en un centro clínico es quien paga.
 *
 * Lo que fija esta prueba, sobre todo, es que el arreglo NO rompa las citas que
 * no tienen paciente: un taller, una consulta de adulto o un centro sin el
 * módulo de pacientes tienen que seguir enseñando el nombre de siempre.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { nombreDeLaCita } from "../lib/citas/nombreEnLaAgenda.js";

test("con paciente, manda el paciente", () => {
  assert.equal(
    nombreDeLaCita({ patient: { firstName: "Mateo", lastName: "Ruiz Gil" }, clientName: "Ana Gil Roca" }),
    "Mateo Ruiz Gil",
  );
});

test("sin paciente, se queda el nombre de siempre", () => {
  // Una consulta de adulto, un taller, o un centro sin módulo de pacientes:
  // ahí `patient` ni se carga y la caja no puede quedarse en blanco.
  assert.equal(nombreDeLaCita({ patient: null, clientName: "Ana Gil Roca" }), "Ana Gil Roca");
  assert.equal(nombreDeLaCita({ clientName: "Ana Gil Roca" }), "Ana Gil Roca");
});

test("un paciente a medio rellenar no deja la caja vacía", () => {
  // Si solo hay apellidos, se pinta lo que haya; si no hay nada de nada, se
  // cae al titular en vez de dejar la cita sin rótulo.
  assert.equal(nombreDeLaCita({ patient: { lastName: "Ruiz Gil" }, clientName: "Ana" }), "Ruiz Gil");
  assert.equal(nombreDeLaCita({ patient: { firstName: "Mateo" }, clientName: "Ana" }), "Mateo");
  assert.equal(nombreDeLaCita({ patient: { firstName: "  ", lastName: "" }, clientName: "Ana Gil" }), "Ana Gil");
});

test("los espacios de más no se cuelan en la rejilla", () => {
  assert.equal(nombreDeLaCita({ patient: { firstName: "  Mateo ", lastName: " Ruiz  Gil " } }), "Mateo Ruiz Gil");
  assert.equal(nombreDeLaCita({ clientName: "  Ana Gil  " }), "Ana Gil");
});

test("sin nada que pintar devuelve cadena vacía, no «undefined»", () => {
  // Que la caja salga sin texto es feo; que ponga «undefined» es un fallo que
  // el centro ve y reporta.
  assert.equal(nombreDeLaCita({}), "");
  assert.equal(nombreDeLaCita(null), "");
  assert.equal(nombreDeLaCita(), "");
  assert.equal(nombreDeLaCita({ clientName: null }), "");
});
