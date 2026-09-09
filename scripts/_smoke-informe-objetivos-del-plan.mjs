// @prueba ligera
/**
 * _smoke-informe-objetivos-del-plan.mjs — los objetivos de un informe salen del
 * PLAN del paciente, no de cada sesión (09/09/2026, AV-0099).
 *
 * Laura Garrido: «los objetivos, la idea no es que se haga un resumen de los
 * objetivos de cada una de las sesiones, sino que se vuelquen los que están
 * escritos en el PLAN del paciente, que son más generales y no son solo los
 * trabajados en las sesiones registradas». Preguntada si valía para todos los
 * tipos de informe o solo para evolución y alta, contestó que para todos.
 *
 * Se ve en los números por qué tenía razón: los objetivos de una sesión son
 * etiquetas de dos a seis palabras («Soplo sostenido»), y de veinte sesiones
 * salen cuarenta repetidas que no dicen qué se perseguía.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { redactarDesdeSesiones } from "../lib/clinica/redactarInforme.js";

const SESIONES = [
  { id: "s1", sessionDate: "2026-09-01", objectives: ["Soplo sostenido", "Praxias linguales"], performance: "Sostiene tres segundos." },
  { id: "s2", sessionDate: "2026-09-08", objectives: ["Soplo sostenido"], performance: "Mejor que la semana pasada." },
];

test("con plan, los objetivos son los del plan y no las etiquetas de sesión", () => {
  const r = redactarDesdeSesiones({}, SESIONES, {
    objetivosDelPlan: ["Mejorar la inteligibilidad del habla en contextos cotidianos"],
  });
  assert.deepEqual(r.objectives, ["Mejorar la inteligibilidad del habla en contextos cotidianos"]);
  assert.ok(!r.objectives.includes("Soplo sostenido"));
});

test("la evolución sigue saliendo de las sesiones: eso no cambia", () => {
  const r = redactarDesdeSesiones({}, SESIONES, { objetivosDelPlan: ["Del plan"] });
  assert.ok(r.evolution.some((l) => /Sostiene tres segundos/.test(l)));
  assert.ok(r.evolution.some((l) => /Mejor que la semana pasada/.test(l)));
});

test("sin plan se cae a las sesiones: peor un apartado en blanco que uno con etiquetas", () => {
  for (const opciones of [undefined, {}, { objetivosDelPlan: null }, { objetivosDelPlan: [] }]) {
    const r = redactarDesdeSesiones({}, SESIONES, opciones);
    assert.ok(r.objectives.includes("Soplo sostenido"), `debería caer a las sesiones con ${JSON.stringify(opciones)}`);
  }
});

test("los objetivos del plan pueden venir como texto o como objeto", () => {
  const comoObjetos = redactarDesdeSesiones({}, SESIONES, {
    objetivosDelPlan: [{ texto: "Uno", terapeutaId: "t1" }, { text: "Dos" }, { texto: "   " }, null],
  });
  assert.deepEqual(comoObjetos.objectives, ["Uno", "Dos"]);
});

test("lo que la profesional escribió a mano no se pisa", () => {
  const r = redactarDesdeSesiones({ objectives: ["Lo que escribí yo"] }, SESIONES, { objetivosDelPlan: ["Del plan"] });
  assert.equal(r.objectives[0], "Lo que escribí yo");
  assert.ok(r.objectives.includes("Del plan"));
});

test("y no se duplica lo que ya estaba", () => {
  const r = redactarDesdeSesiones({ objectives: ["Del plan"] }, SESIONES, { objetivosDelPlan: ["Del plan"] });
  assert.deepEqual(r.objectives, ["Del plan"]);
});
