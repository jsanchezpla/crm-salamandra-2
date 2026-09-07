// @prueba ligera
/**
 * _smoke-bono-del-paciente.mjs — de quién es el bono dentro de la familia
 * (08/09/2026, AV-0055 de Aumenta).
 *
 * Lo que fija: un bono sin paciente sigue siendo de todos (los que ya están
 * dados no cambian de dueño), un bono con paciente no se le gasta a un
 * hermano, y cuando los dos valen se gasta antes el del niño.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { packValeParaPaciente, packsParaPaciente } from "../lib/citas/bonoDelPaciente.js";

const DE_LA_FAMILIA = { id: "b-familia", patientId: null };
const DE_ANA = { id: "b-ana", patientId: "pac-ana" };
const DE_LUIS = { id: "b-luis", patientId: "pac-luis" };

test("un bono sin paciente vale para cualquiera de la familia", () => {
  assert.equal(packValeParaPaciente(DE_LA_FAMILIA, "pac-ana"), true);
  assert.equal(packValeParaPaciente(DE_LA_FAMILIA, "pac-luis"), true);
  assert.equal(packValeParaPaciente(DE_LA_FAMILIA, null), true);
});

test("un bono de un hermano NO se le gasta al otro", () => {
  assert.equal(packValeParaPaciente(DE_ANA, "pac-ana"), true);
  assert.equal(packValeParaPaciente(DE_ANA, "pac-luis"), false);
});

test("sin saber de qué paciente es la cita, no se niega nada", () => {
  // El área privada reserva a nombre de la familia: ahí no hay con qué decidir,
  // y negarlo dejaría a una familia sin poder usar un bono que ha pagado.
  assert.equal(packValeParaPaciente(DE_ANA, null), true);
  assert.equal(packValeParaPaciente(DE_ANA, ""), true);
});

test("un bono roto o ausente no rompe la comprobación", () => {
  assert.equal(packValeParaPaciente(null, "pac-ana"), true);
  assert.equal(packValeParaPaciente({}, "pac-ana"), true);
});

test("los del niño primero, los de la familia después, el del hermano fuera", () => {
  const orden = packsParaPaciente([DE_LA_FAMILIA, DE_LUIS, DE_ANA], "pac-ana");
  assert.deepEqual(orden.map((p) => p.id), ["b-ana", "b-familia"]);
});

test("sin paciente salen todos y en el orden que venían", () => {
  const orden = packsParaPaciente([DE_LA_FAMILIA, DE_LUIS, DE_ANA], null);
  assert.deepEqual(orden.map((p) => p.id), ["b-familia", "b-luis", "b-ana"]);
});

test("dentro de cada grupo se respeta el orden de entrada", () => {
  // La regla de siempre es «se gasta el más antiguo primero», y quien llama ya
  // los trae ordenados por fecha de compra: aquí no se reordena por dentro.
  const a1 = { id: "ana-vieja", patientId: "pac-ana" };
  const a2 = { id: "ana-nueva", patientId: "pac-ana" };
  const f1 = { id: "fam-vieja", patientId: null };
  const orden = packsParaPaciente([a1, f1, a2], "pac-ana");
  assert.deepEqual(orden.map((p) => p.id), ["ana-vieja", "ana-nueva", "fam-vieja"]);
});

test("una familia sin ningún bono suyo se queda a cero", () => {
  assert.deepEqual(packsParaPaciente([DE_LUIS], "pac-ana"), []);
});

test("lo que no es una lista no revienta", () => {
  assert.deepEqual(packsParaPaciente(null, "pac-ana"), []);
  assert.deepEqual(packsParaPaciente(undefined, null), []);
});
