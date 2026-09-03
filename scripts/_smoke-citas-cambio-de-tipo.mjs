// @prueba ligera
/**
 * _smoke-citas-cambio-de-tipo.mjs — cambiar el tipo de una cita que ya existe
 * desde la ficha de la cita, solo dirección (03/09/2026, Aumenta por Rodrigo).
 *
 * Lo que se fija aquí:
 *
 *   1. Solo admin / superadmin. Una terapeuta recibe 403, no un «no existe».
 *   2. Un taller no cambia de tipo y una cita no se convierte en taller por
 *      ese camino: las dos son 409 con su frase, no un 500 al montar la lista.
 *   3. Una sesión de un bono se queda con su tipo.
 *   4. Pasar al MISMO tipo no es un cambio (`sinCambio`), para que el endpoint
 *      no escriba ni audite nada.
 *   5. El desplegable no ofrece tipos de taller, y si el tipo actual ya no
 *      está en el catálogo activo, lo mete igualmente y marcado.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { puedeCambiarTipo, puedeCambiarTipoDeCita, tiposParaCambiar } from "../lib/citas/cambioDeTipo.js";

const LOGO = { id: "t-logo", name: "Logopedia 45", tallerGrupoId: null };
const ENTREVISTA = { id: "t-ent", name: "Entrevista inicial", tallerGrupoId: null };
const TALLER = { id: "t-hhss", name: "Habilidades sociales · 1 hora", tallerGrupoId: "g-1" };

const cita = (extra = {}) => ({ id: "c1", eventTypeId: LOGO.id, tallerGrupoId: null, packId: null, ...extra });

test("solo dirección cambia el tipo", () => {
  assert.equal(puedeCambiarTipoDeCita("admin"), true);
  assert.equal(puedeCambiarTipoDeCita("superadmin"), true);
  assert.equal(puedeCambiarTipoDeCita("user"), false);
  assert.equal(puedeCambiarTipoDeCita(undefined), false);
  const r = puedeCambiarTipo({ role: "user", booking: cita(), tipoNuevo: ENTREVISTA });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("una cita normal pasa a otro tipo normal", () => {
  assert.deepEqual(puedeCambiarTipo({ role: "admin", booking: cita(), tipoNuevo: ENTREVISTA }), { ok: true });
});

test("el mismo tipo no es un cambio", () => {
  const r = puedeCambiarTipo({ role: "admin", booking: cita(), tipoNuevo: LOGO });
  assert.equal(r.ok, true);
  assert.equal(r.sinCambio, true);
});

test("un tipo que no existe se rechaza con 400", () => {
  const r = puedeCambiarTipo({ role: "admin", booking: cita(), tipoNuevo: null });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("ni el taller cambia de tipo ni la cita se vuelve taller", () => {
  const desdeTaller = puedeCambiarTipo({ role: "admin", booking: cita({ tallerGrupoId: "g-1", eventTypeId: TALLER.id }), tipoNuevo: ENTREVISTA });
  assert.equal(desdeTaller.ok, false);
  assert.equal(desdeTaller.status, 409);
  const haciaTaller = puedeCambiarTipo({ role: "admin", booking: cita(), tipoNuevo: TALLER });
  assert.equal(haciaTaller.ok, false);
  assert.equal(haciaTaller.status, 409);
  assert.match(haciaTaller.motivo, /taller/i);
});

test("la sesión de un bono se queda con su tipo", () => {
  const r = puedeCambiarTipo({ role: "admin", booking: cita({ packId: "p-1" }), tipoNuevo: ENTREVISTA });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.motivo, /bono/i);
});

test("acepta filas de Sequelize (toJSON) igual que JSON plano", () => {
  const fila = { toJSON: () => cita() };
  const tipo = { toJSON: () => ENTREVISTA };
  assert.deepEqual(puedeCambiarTipo({ role: "admin", booking: fila, tipoNuevo: tipo }), { ok: true });
});

test("el desplegable deja fuera los talleres", () => {
  const lista = tiposParaCambiar([LOGO, TALLER, ENTREVISTA], cita({ eventType: LOGO }));
  assert.deepEqual(lista.map((t) => t.id), ["t-logo", "t-ent"]);
});

test("el tipo actual que ya no está en el catálogo se añade y se marca", () => {
  const VIEJO = { id: "t-viejo", name: "Tipo retirado", tallerGrupoId: null };
  const lista = tiposParaCambiar([LOGO, ENTREVISTA], cita({ eventTypeId: VIEJO.id, eventType: VIEJO }));
  assert.equal(lista[0].id, "t-viejo");
  assert.equal(lista[0].inactivo, true);
  assert.equal(lista.length, 3);
});

test("sin lista ni cita no revienta", () => {
  assert.deepEqual(tiposParaCambiar(undefined, undefined), []);
  assert.deepEqual(tiposParaCambiar(null, {}), []);
});
