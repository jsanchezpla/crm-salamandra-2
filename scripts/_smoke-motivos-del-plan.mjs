// @prueba ligera
// Motivo de consulta por terapia en el plan (15/09/2026, AV-0143 de Aumenta).
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizarMotivos, motivoDe, ponerMotivo, tieneMotivo } from "../lib/clinica/motivosDelPlan.js";
import { promptObjetivos } from "../lib/clinica/objetivosIa.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("uno por terapeuta, sin vacíos ni ids raros, y el último gana", () => {
  const r = normalizarMotivos([
    { terapeutaId: A, texto: " lectura " },
    { terapeutaId: B, texto: "   " },
    { terapeutaId: "no-uuid", texto: "x" },
    { terapeutaId: A, texto: "escritura" },
    "suelto",
  ]);
  assert.deepEqual(r, [{ terapeutaId: A, texto: "escritura" }]);
  assert.deepEqual(normalizarMotivos(null), []);
});

test("vaciar la caja quita el motivo de esa terapeuta", () => {
  let l = ponerMotivo([], A, "ansiedad");
  l = ponerMotivo(l, B, "lenguaje");
  assert.equal(motivoDe(l, B), "lenguaje");
  l = ponerMotivo(l, B, "");
  assert.deepEqual(normalizarMotivos(l), [{ terapeutaId: A, texto: "ansiedad" }]);
  assert.equal(motivoDe(l, null), "");
});

test("hay motivo si está el general o el de alguna terapia", () => {
  assert.equal(tieneMotivo({ consultationReasons: "x" }), true);
  assert.equal(tieneMotivo({ consultationReasons: " ", consultationReasonsByTherapist: [{ terapeutaId: A, texto: "y" }] }), true);
  assert.equal(tieneMotivo({}), false);
});

test("el informe recibe el plan por terapia, la de quien firma primero y sin nombres", async () => {
  const { planParaElInforme } = await import("../lib/clinica/motivosDelPlan.js");
  const { mensajeDeInforme } = await import("../lib/clinica/informeMaterial.js");
  const bloque = planParaElInforme({
    plan: {
      consultationReasons: "dificultades escolares",
      consultationReasonsByTherapist: [{ terapeutaId: A, texto: "ansiedad ante exámenes" }, { terapeutaId: B, texto: "lectura lenta" }],
      objectives: [{ texto: "leer 60 palabras/min", terapeutaId: B }, "objetivo viejo"],
    },
    terapeutas: [{ teamMemberId: A, specialty: "psicologia" }, { teamMemberId: B, specialty: "pedagogia" }],
    autorId: B,
    rotulos: { psicologia: "Psicología", pedagogia: "Pedagogía" },
  });
  assert.match(bloque, /Motivo de consulta general: dificultades escolares/);
  assert.ok(bloque.indexOf("Pedagogía (la de quien firma") < bloque.indexOf("Psicología"), "la del autor va primero");
  assert.match(bloque, /Motivo de consulta en esta terapia: lectura lenta/);
  assert.match(bloque, /Objetivo: leer 60 palabras\/min/);
  assert.match(bloque, /sin terapia asignada:\n  - objetivo viejo/);
  assert.match(mensajeDeInforme({ transcription: "notas", delPlan: bloque }), /DEL PLAN DE INTERVENCIÓN/);
  assert.equal(planParaElInforme({ plan: {} }), "");
  assert.doesNotMatch(mensajeDeInforme({ transcription: "notas" }), /DEL PLAN/);
});

test("la IA de objetivos recibe el motivo de la terapia de quien los pide", () => {
  const { user } = promptObjetivos({ ideas: "turnos", plan: {}, paciente: {}, motivoDeSuTerapia: "dificultad lectora" });
  assert.match(user, /terapia de esta profesional: dificultad lectora/);
  const sin = promptObjetivos({ ideas: "turnos", plan: {}, paciente: {} });
  assert.doesNotMatch(sin.user, /terapia de esta profesional/);
});
