// @prueba ligera
// Fija lib/citas/permisosBloqueos.js: quién puede poner, cambiar y quitar un
// bloqueo (07/09/2026, AV-0056 y AV-0058 de Aumenta). Tres escalones:
// dirección todo; administración los de cualquiera menos el centro; el resto
// solo los suyos.
import test from "node:test";
import assert from "node:assert/strict";
import {
  aNombreDeQuien,
  puedeCerrarElCentro,
  puedeElegirPersona,
  vetoParaTocar,
} from "../lib/citas/permisosBloqueos.js";

const YO = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";

const direccion = { esAdmin: true, esAdministracion: false, teamMemberId: null };
const administracion = { esAdmin: false, esAdministracion: true, teamMemberId: YO };
const terapeuta = { esAdmin: false, esAdministracion: false, teamMemberId: YO };
const sinFicha = { esAdmin: false, esAdministracion: false, teamMemberId: null };

const mio = { teamMemberId: YO };
const deOtra = { teamMemberId: OTRA };
const delCentro = { teamMemberId: null };

test("dirección puede todo, incluidos los cierres de centro", () => {
  assert.equal(vetoParaTocar(direccion, mio), null);
  assert.equal(vetoParaTocar(direccion, deOtra), null);
  assert.equal(vetoParaTocar(direccion, delCentro), null);
  assert.equal(vetoParaTocar(direccion, delCentro, "quitar"), null);
  assert.equal(puedeCerrarElCentro(direccion), true);
  assert.deepEqual(aNombreDeQuien(direccion, null), { veto: null, teamMemberId: null });
  assert.deepEqual(aNombreDeQuien(direccion, OTRA), { veto: null, teamMemberId: OTRA });
});

test("administración toca los bloqueos de cualquiera, pero no los cierres de centro", () => {
  assert.equal(vetoParaTocar(administracion, mio), null);
  assert.equal(vetoParaTocar(administracion, deOtra), null);
  assert.equal(vetoParaTocar(administracion, deOtra, "quitar"), null);
  assert.match(vetoParaTocar(administracion, delCentro), /todo el centro.*administrador/);
  assert.match(vetoParaTocar(administracion, delCentro, "quitar"), /quita un administrador/);
  assert.equal(puedeElegirPersona(administracion), true);
  assert.equal(puedeCerrarElCentro(administracion), false);
});

test("administración pone a nombre de quien elija; sin elegir, a sí misma; nunca al centro", () => {
  assert.deepEqual(aNombreDeQuien(administracion, OTRA), { veto: null, teamMemberId: OTRA });
  assert.deepEqual(aNombreDeQuien(administracion, null), { veto: null, teamMemberId: YO });
  assert.deepEqual(aNombreDeQuien(administracion, ""), { veto: null, teamMemberId: YO });
  // Administración sin ficha propia y sin elegir a nadie: no hay a quién ponérselo.
  const sinFichaAdmon = { ...administracion, teamMemberId: null };
  const r = aNombreDeQuien(sinFichaAdmon, null);
  assert.match(r.veto, /dirección/);
  assert.equal(r.teamMemberId, null);
});

test("el resto del equipo solo los suyos, con la frase de siempre", () => {
  assert.equal(vetoParaTocar(terapeuta, mio), null);
  assert.equal(vetoParaTocar(terapeuta, deOtra), "Solo puedes cambiar tus propias ausencias.");
  assert.equal(vetoParaTocar(terapeuta, deOtra, "quitar"), "Solo puedes quitar tus propias ausencias.");
  assert.equal(vetoParaTocar(terapeuta, delCentro), "Los cierres de todo el centro los cambia un administrador.");
  assert.equal(puedeElegirPersona(terapeuta), false);
});

test("el resto del equipo se lo pone siempre a sí mismo, mande lo que mande el navegador", () => {
  assert.deepEqual(aNombreDeQuien(terapeuta, OTRA), { veto: null, teamMemberId: YO });
  assert.deepEqual(aNombreDeQuien(terapeuta, null), { veto: null, teamMemberId: YO });
});

test("sin ficha de equipo no se puede poner nada, y se dice por qué", () => {
  const r = aNombreDeQuien(sinFicha, OTRA);
  assert.match(r.veto, /ficha de equipo/);
  assert.equal(r.teamMemberId, null);
  assert.equal(vetoParaTocar(sinFicha, mio), "Solo puedes cambiar tus propias ausencias.");
});
