// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-incidencia-por-falta.mjs — marcar una falta abre una incidencia
 * (01/09/2026, Rodrigo: «que se abra una incidencia y se le mande
 * automáticamente a Olga; esto último solo para Aumenta»).
 *
 * Lo que se fija aquí es justo lo que hace que «solo para Aumenta» NO sea un
 * `if (slug === "aumenta")`:
 *
 *   · **De fábrica está apagado.** Un centro sin la lista puesta no abre
 *     ninguna incidencia. Si esto se rompiera, los otros nueve tenants con
 *     módulo asistencial empezarían a generar incidencias sin haberlas pedido.
 *   · **La lista se limpia.** Un id repetido abriría la incidencia con la misma
 *     persona dos veces; uno con espacios o que no es un UUID, ninguna.
 *   · **El título dice las tres cosas** —qué pasó, a quién y cuándo— y cabe en
 *     los 200 caracteres de la columna; y **las dos faltas abren incidencia**,
 *     con prioridad distinta.
 *
 *   node scripts/_smoke-incidencia-por-falta.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIA_FALTA,
  SUBCATEGORIA_FALTA,
  cuandoEra,
  limpiarResponsables,
  responsablesDeIncidenciaPorFalta,
  textoIncidenciaFalta,
} from "../lib/citas/incidenciaPorFalta.js";

const OLGA = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ROSA = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

test("sin lista puesta no se abre ninguna incidencia", () => {
  assert.deepEqual(responsablesDeIncidenciaPorFalta(undefined), []);
  assert.deepEqual(responsablesDeIncidenciaPorFalta({}), []);
  assert.deepEqual(responsablesDeIncidenciaPorFalta({ settings: {} }), []);
  assert.deepEqual(responsablesDeIncidenciaPorFalta({ settings: { citas: {} } }), []);
  // Un valor que no es lista tampoco enciende nada.
  assert.deepEqual(responsablesDeIncidenciaPorFalta({ settings: { citas: { incidenciaPorFalta: OLGA } } }), []);
});

test("con la lista puesta, salen sus responsables en orden", () => {
  const tenant = { settings: { citas: { incidenciaPorFalta: [OLGA, ROSA] } } };
  assert.deepEqual(responsablesDeIncidenciaPorFalta(tenant), [OLGA, ROSA]);
});

test("la lista se limpia: sin repetidos, sin espacios y solo UUID", () => {
  assert.deepEqual(limpiarResponsables([OLGA, ` ${OLGA} `, ROSA]), [OLGA, ROSA]);
  assert.deepEqual(limpiarResponsables(["olga", "", null, 7, {}]), []);
  assert.deepEqual(limpiarResponsables(null), []);
});

test("el título dice qué, a quién y cuándo, y cabe en la columna", () => {
  const { titulo, cuerpo, prioridad } = textoIncidenciaFalta({
    justificada: false,
    quien: "Hugo Castro",
    scheduledAt: "2026-09-03T08:00:00.000Z",
    motivo: "no cogen el teléfono",
  });
  assert.match(titulo, /^Falta injustificada · Hugo Castro · /);
  assert.ok(titulo.length <= 200);
  assert.match(cuerpo, /no cogen el teléfono/);
  assert.equal(prioridad, "high");
});

test("la justificada también abre incidencia, pero no como urgente", () => {
  const { titulo, prioridad } = textoIncidenciaFalta({
    justificada: true,
    quien: "Hugo Castro",
    scheduledAt: "2026-09-03T08:00:00.000Z",
    motivo: null,
  });
  assert.match(titulo, /^Falta justificada · /);
  assert.equal(prioridad, "medium");
});

test("un nombre larguísimo no revienta la columna de 200", () => {
  const { titulo } = textoIncidenciaFalta({
    justificada: true,
    quien: "M".repeat(400),
    scheduledAt: "2026-09-03T08:00:00.000Z",
    motivo: null,
  });
  assert.equal(titulo.length, 200);
});

test("sin ficha ni fecha se dice, no se inventa", () => {
  const { titulo } = textoIncidenciaFalta({ justificada: true, quien: null, scheduledAt: null, motivo: null });
  assert.match(titulo, /sin ficha/);
  assert.equal(cuandoEra(null), "sin fecha");
  assert.equal(cuandoEra("mañana por la tarde"), "sin fecha");
});

test("entra por Administrativa · Citas, que es quien la resuelve", () => {
  assert.equal(CATEGORIA_FALTA, "administrativa");
  assert.equal(SUBCATEGORIA_FALTA, "Citas");
});
