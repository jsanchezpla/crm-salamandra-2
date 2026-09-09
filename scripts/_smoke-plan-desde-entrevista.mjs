// @prueba ligera
/**
 * _smoke-plan-desde-entrevista.mjs — el Plan se rellena con lo que ya está
 * escrito en la entrevista inicial (09/09/2026, AV-0103).
 *
 * LO QUE ESTA PRUEBA DEFIENDE:
 *
 *   · **Que el diagnóstico NO se rellena.** La entrevista tiene «impresión
 *     clínica inicial», que es una hipótesis; volcarla en un campo llamado
 *     «Diagnóstico» la convertiría en un diagnóstico por el camino. Es lo mismo
 *     que se le prohibió a la IA el 09/09 y no se abre por la puerta de atrás.
 *   · **Que no se pisa lo escrito.** Un botón que borra lo tuyo se pulsa una
 *     vez y no se vuelve a pulsar nunca.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { APARTADOS_ENTREVISTA_BASE } from "../lib/clinica/plantillas.js";
import { CAMPOS, DE_DONDE, loQueRellena, resumenDelVolcado, volcadoDeEntrevista } from "../lib/clinica/planDesdeEntrevista.js";

const ENTREVISTA = {
  identificacion: "Nombre, 7 años",
  motivoConsulta: "La familia consulta por dificultades de atención en el aula.",
  antecedentesPersonales: "Embarazo y parto sin incidencias.",
  antecedentesFamiliares: "Vive con sus padres y una hermana.",
  escolarLaboral: "2.º de Primaria, con apoyo de PT.",
  intervencionesPrevias: "Logopedia durante un curso.",
  impresionClinica: "Se plantea como hipótesis un trastorno de la atención.",
  observacionClinica: "Colabora bien.",
};

test("EL DIAGNÓSTICO NO SE RELLENA, y la impresión clínica no se cuela", () => {
  assert.ok(!CAMPOS.includes("diagnosis"), "el diagnóstico no puede estar entre los campos que se rellenan");
  assert.ok(!("diagnosis" in DE_DONDE));
  const v = volcadoDeEntrevista(ENTREVISTA, APARTADOS_ENTREVISTA_BASE);
  assert.ok(!("diagnosis" in v));
  // Y su texto no aparece en ningún otro campo por la puerta de atrás.
  for (const t of Object.values(v)) assert.ok(!/hipótesis un trastorno/.test(t), "la impresión clínica se ha colado");
});

test("el motivo de consulta viene tal cual, sin rótulo de más", () => {
  const v = volcadoDeEntrevista(ENTREVISTA, APARTADOS_ENTREVISTA_BASE);
  assert.equal(v.consultationReasons, "La familia consulta por dificultades de atención en el aula.");
});

test("la información previa junta los cuatro, cada uno con su nombre", () => {
  const v = volcadoDeEntrevista(ENTREVISTA, APARTADOS_ENTREVISTA_BASE);
  assert.match(v.previousInfo, /Antecedentes personales: Embarazo y parto/);
  assert.match(v.previousInfo, /Antecedentes familiares: Vive con sus padres/);
  assert.match(v.previousInfo, /Escolar \/ laboral: 2\.º de Primaria/);
  assert.match(v.previousInfo, /Intervenciones previas: Logopedia/);
  // Sin el número del apartado, que aquí no dice nada.
  assert.ok(!/^3\./m.test(v.previousInfo));
  // Y no arrastra lo que no le toca.
  assert.ok(!/Colabora bien/.test(v.previousInfo));
});

test("un apartado vacío no deja su rótulo suelto", () => {
  const v = volcadoDeEntrevista({ antecedentesPersonales: "Solo esto.", antecedentesFamiliares: "   " }, APARTADOS_ENTREVISTA_BASE);
  assert.equal(v.previousInfo, "Antecedentes personales: Solo esto.");
  assert.ok(!("consultationReasons" in v), "sin motivo no se inventa un campo vacío");
});

test("los apartados de lista se juntan por líneas", () => {
  const v = volcadoDeEntrevista({ intervencionesPrevias: ["Logopedia", "Psicomotricidad", "  "] }, APARTADOS_ENTREVISTA_BASE);
  assert.match(v.previousInfo, /Logopedia\nPsicomotricidad/);
});

test("NO se pisa lo que ya está escrito en el plan", () => {
  const volcado = volcadoDeEntrevista(ENTREVISTA, APARTADOS_ENTREVISTA_BASE);
  const cambios = loQueRellena({ consultationReasons: "Lo que escribí yo", previousInfo: "" }, volcado);
  assert.ok(!("consultationReasons" in cambios), "iba a pisar el motivo escrito a mano");
  assert.ok(cambios.previousInfo.includes("Antecedentes personales"));
});

test("con el plan entero escrito no cambia nada", () => {
  const volcado = volcadoDeEntrevista(ENTREVISTA, APARTADOS_ENTREVISTA_BASE);
  const cambios = loQueRellena({ consultationReasons: "Ya", previousInfo: "Ya" }, volcado);
  assert.deepEqual(cambios, {});
});

test("el resumen dice qué se rellenó, qué ya estaba y lo del diagnóstico", () => {
  const volcado = volcadoDeEntrevista(ENTREVISTA, APARTADOS_ENTREVISTA_BASE);
  const plan = { consultationReasons: "Ya lo tenía" };
  const r = resumenDelVolcado(loQueRellena(plan, volcado), plan);
  assert.deepEqual(r.rellenados, ["previousInfo"]);
  assert.deepEqual(r.yaEstaban, ["consultationReasons"]);
  assert.match(r.diagnostico, /hipótesis/);
});

test("una entrevista vacía no rompe nada", () => {
  assert.deepEqual(volcadoDeEntrevista({}, APARTADOS_ENTREVISTA_BASE), {});
  assert.deepEqual(volcadoDeEntrevista(null, null), {});
  assert.deepEqual(loQueRellena(null, null), {});
});
