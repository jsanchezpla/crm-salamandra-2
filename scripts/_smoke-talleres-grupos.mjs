// @prueba ligera
/**
 * _smoke-talleres-grupos.mjs — las reglas de los GRUPOS de taller, sin base de
 * datos (01/09/2026, Aumenta por Rodrigo).
 *
 * Fija lo que decidió el encargo y que no se ve mirando el código:
 *
 *   · un grupo se lee «Actividad · Grupo», y ese rótulo es el nombre del tipo
 *     de cita con el que se apunta en la agenda;
 *   · su slug lleva el prefijo `taller-` para no chocar con un tipo de cita
 *     normal que se llame igual (pasa: «Habilidades sociales» puede existir
 *     como sesión individual);
 *   · el concepto de cobro del grupo MANDA sobre el de la actividad, y sin
 *     ninguno de los dos no se cobra nada;
 *   · la lista de quien imparte se limpia siempre (sin repetidos, sin basura),
 *     porque de ella sale quién es el dueño de la cita.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { rotuloDeGrupo, slugBaseDeGrupo } from "../lib/clinica/tipoCitaTaller.js";
import { conceptoDeGrupo } from "../lib/clinica/cuotaDeTaller.js";
import { limpiarIds, serializarGrupo } from "../lib/clinica/grupoDeTaller.js";
import { grupoDeTipoDeCita, esCitaDeTaller } from "../lib/clinica/citaDeTaller.js";

const HHSS = { name: "Habilidades sociales", active: true };

test("el rótulo del grupo lleva la actividad delante", () => {
  assert.equal(rotuloDeGrupo(HHSS, { name: "Grupo 1" }), "Habilidades sociales · Grupo 1");
});

test("sin nombre de grupo se queda con el de la actividad, y al revés", () => {
  assert.equal(rotuloDeGrupo(HHSS, { name: "" }), "Habilidades sociales");
  assert.equal(rotuloDeGrupo({ name: "" }, { name: "Grupo 1" }), "Grupo 1");
  // Sin ninguno de los dos sigue habiendo algo que enseñar: el tipo de cita
  // tiene `name` NOT NULL y una cadena vacía reventaría el alta.
  assert.equal(rotuloDeGrupo(null, null), "Taller");
});

test("el slug lleva el prefijo taller- para no chocar con un tipo normal", () => {
  const slug = slugBaseDeGrupo(HHSS, { name: "Grupo 1" });
  assert.equal(slug, "taller-habilidades-sociales-grupo-1");
  /*
   * Y sin nada legible sigue saliendo un slug válido Y DISTINTO para cada
   * grupo: `slug` es NOT NULL y UNIQUE. Antes esto devolvía «taller» a secas
   * para todos ellos, así que el segundo grupo con nombre en signos chocaba con
   * el primero.
   */
  const a = slugBaseDeGrupo({ name: "···" }, { name: "···", id: "abcd1234-0000" });
  const b = slugBaseDeGrupo({ name: "···" }, { name: "···", id: "ffff9999-0000" });
  assert.match(a, /^taller-/);
  assert.notEqual(a, b);
});

test("el concepto del grupo manda sobre el de la actividad", () => {
  const taller = { conceptId: "concepto-taller" };
  assert.equal(conceptoDeGrupo(taller, { conceptId: "concepto-grupo" }), "concepto-grupo");
  assert.equal(conceptoDeGrupo(taller, { conceptId: null }), "concepto-taller");
  // Sin ninguno de los dos no se cobra: apuntar a un niño no le crea cuota.
  assert.equal(conceptoDeGrupo({}, {}), null);
});

test("la lista de terapeutas se limpia: sin repetidos y sin basura", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(limpiarIds([a, b, a, "", null, "no-es-un-id", 7]), [a, b]);
  assert.deepEqual(limpiarIds(null), []);
});

test("el grupo serializado dice quién coordina, que es el dueño de la cita", () => {
  const g = serializarGrupo(
    {
      id: "g1",
      tallerId: "t1",
      name: "Grupo 1",
      duration: 90,
      active: true,
      terapeutas: [
        { id: "x", teamMemberId: "m1", coordina: false, profesional: { displayName: "Ana" } },
        { id: "y", teamMemberId: "m2", coordina: true, profesional: { displayName: "Marta" } },
      ],
    },
    { apuntados: 8 }
  );
  assert.equal(g.coordinaId, "m2");
  assert.equal(g.apuntados, 8);
  assert.equal(g.terapeutas.length, 2);
  // Sin nadie marcado, `coordinaId` es null y la cita nace sin profesional
  // asignado — que es válido, como cualquier otra cita sin asignar.
  const sinNadie = serializarGrupo({ id: "g2", name: "Grupo 2", terapeutas: [] });
  assert.equal(sinNadie.coordinaId, null);
});

test("un tipo de cita es taller solo si apunta a un grupo", () => {
  assert.equal(grupoDeTipoDeCita({ tallerGrupoId: "g1" }), "g1");
  assert.equal(grupoDeTipoDeCita({ tallerGrupoId: null }), null);
  assert.equal(grupoDeTipoDeCita({}), null);
  // La cadena vacía NO cuenta: un id vacío haría que una cita normal se
  // tratara como taller y se quedaría sin paciente.
  assert.equal(grupoDeTipoDeCita({ tallerGrupoId: "" }), null);
});

test("una cita es de taller por su grupo, no por su tipo", () => {
  assert.equal(esCitaDeTaller({ tallerGrupoId: "g1" }), true);
  assert.equal(esCitaDeTaller({ patientId: "p1" }), false);
});
