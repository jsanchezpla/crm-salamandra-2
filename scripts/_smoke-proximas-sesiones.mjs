// @prueba ligera — función pura de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-proximas-sesiones.mjs — «Próximas sesiones» es la preparación de la
 * SIGUIENTE (01/09/2026, Aumenta por Rodrigo).
 *
 *   node scripts/_smoke-proximas-sesiones.mjs
 *
 * ── DE QUÉ ENCARGO NACE ────────────────────────────────────────────────────
 * «Todo lo que sea Próximas sesiones se tiene que registrar automáticamente
 * como borrador para la siguiente preparación.» Se escribía al cerrar la sesión
 * del martes y el jueves la preparación abría en blanco: para recuperarlo había
 * que salir del formulario, abrir la sesión anterior y copiarlo a mano. En
 * Aumenta, con 22.064 sesiones, había once con preparación escrita.
 *
 * ── LO QUE SE FIJA AQUÍ ────────────────────────────────────────────────────
 * Esto decide qué texto aparece escrito en un formulario de nota clínica sin
 * que nadie lo haya tecleado. Los dos fallos posibles no se parecen:
 *
 *   · **No traer nada** → el recuadro sale vacío, como toda la vida. Molesta.
 *   · **Traer el de otra sesión** → la preparación de un niño con el texto de
 *     otro día (o, peor, de otro momento del tratamiento) escrita como si la
 *     hubiera puesto ella. Eso no se ve.
 *
 * Por eso la regla es estrecha: la más reciente ESTRICTAMENTE anterior, nunca
 * ella misma, y ante cualquier duda `null`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { proximasSesionesPendientes } from "../lib/clinica/prepararSesion.js";

const sesion = (id, fecha, proximas, extra = {}) => ({
  id,
  sessionDate: fecha,
  observations: { familyComments: "", nextSessionNotes: proximas, homeworkTasks: "", incidents: "" },
  ...extra,
});

const MARTES = "2026-09-01T17:00:00.000Z";
const MIERCOLES = "2026-09-02T17:00:00.000Z";
const JUEVES = "2026-09-03T17:00:00.000Z";
const VIERNES = "2026-09-04T17:00:00.000Z";

test("trae lo apuntado en la sesión anterior", () => {
  const r = proximasSesionesPendientes([sesion("a", MARTES, "Seguir con flexibilidad cognitiva")], {
    antesDe: JUEVES,
  });
  assert.equal(r.texto, "Seguir con flexibilidad cognitiva");
  assert.equal(r.sesion.id, "a");
});

test("de varias anteriores, gana la MÁS RECIENTE", () => {
  const r = proximasSesionesPendientes(
    [sesion("vieja", MARTES, "Lo de la semana pasada"), sesion("nueva", MIERCOLES, "Lo de ayer")],
    { antesDe: JUEVES }
  );
  assert.equal(r.sesion.id, "nueva");
  assert.equal(r.texto, "Lo de ayer");
});

test("una sesión POSTERIOR no cuenta, aunque sea la última de la lista", () => {
  // Desde que una sesión puede prepararse con fecha futura, la última de la
  // lista puede ser la del viernes. Preparar la del jueves no puede traerse lo
  // que se apuntó para después.
  const r = proximasSesionesPendientes(
    [sesion("previa", MARTES, "Lo del martes"), sesion("futura", VIERNES, "Lo del viernes")],
    { antesDe: JUEVES }
  );
  assert.equal(r.sesion.id, "previa");
});

test("la sesión que se está editando no se hereda a sí misma", () => {
  const lista = [sesion("esta", JUEVES, "Lo mío"), sesion("previa", MARTES, "Lo del martes")];
  const r = proximasSesionesPendientes(lista, { antesDe: VIERNES, excluirId: "esta" });
  assert.equal(r.sesion.id, "previa");
  // Y sin nada anterior, nada: mejor un recuadro vacío que su propio texto.
  assert.equal(proximasSesionesPendientes([sesion("esta", JUEVES, "Lo mío")], { antesDe: VIERNES, excluirId: "esta" }), null);
});

test("una sesión sin «Próximas sesiones» se salta y se sigue buscando", () => {
  const r = proximasSesionesPendientes(
    [sesion("muda", MIERCOLES, "   "), sesion("vieja", MARTES, "Lo del martes")],
    { antesDe: JUEVES }
  );
  assert.equal(r.sesion.id, "vieja");
});

test("también vale si el centro lo guarda en los apartados de su plantilla", () => {
  const r = proximasSesionesPendientes(
    [{ id: "x", sessionDate: MARTES, contentSections: { nextSessionNotes: "Desde el JSONB" } }],
    { antesDe: JUEVES }
  );
  assert.equal(r.texto, "Desde el JSONB");
});

test("una lista se junta en líneas, como en el formulario", () => {
  const r = proximasSesionesPendientes([sesion("a", MARTES, ["Planificación", "  ", "Memoria de trabajo"])], {
    antesDe: JUEVES,
  });
  assert.equal(r.texto, "Planificación\nMemoria de trabajo");
});

test("lo que llega roto no rompe nada: null y a otra cosa", () => {
  assert.equal(proximasSesionesPendientes(null, { antesDe: JUEVES }), null);
  assert.equal(proximasSesionesPendientes([], { antesDe: JUEVES }), null);
  assert.equal(proximasSesionesPendientes([null, 7], { antesDe: JUEVES }), null);
  // Sin fecha de referencia no se adivina: se devolvería el texto de cualquiera.
  assert.equal(proximasSesionesPendientes([sesion("a", MARTES, "Algo")], { antesDe: "el jueves" }), null);
  assert.equal(proximasSesionesPendientes([sesion("a", MARTES, "Algo")]), null);
  // Una sesión sin fecha legible no puede compararse: fuera.
  assert.equal(proximasSesionesPendientes([sesion("a", "ayer", "Algo")], { antesDe: JUEVES }), null);
});
