// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-coordinadoras.mjs — quién ve el trabajo de todo el equipo sin ser
 * dirección (02/09/2026, AV-0022 de Aumenta).
 *
 *   node scripts/_smoke-coordinadoras.mjs
 *
 * La bandeja solo dejaba cambiar de terapeuta a quien no tenía ficha de
 * equipo, y la tarjeta de informes vencidos contaba los de todo el centro para
 * todo el mundo. Ahora manda una lista en `settings.clinica.coordinadoras`;
 * esta prueba fija cómo se lee (limpia, sin repetidos, sin basura) y quién
 * pasa: dirección siempre, la lista cuando toca, y nadie más.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coordinadorasDe, esCoordinadora, veTodoElEquipo } from "../lib/clinica/coordinadoras.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const tenant = { settings: { clinica: { coordinadoras: [A, ` ${B} `, A, "no-es-un-id", 7, null] } } };

describe("coordinadorasDe", () => {
  it("devuelve los ids limpios, sin repetidos y sin basura", () => {
    assert.deepEqual(coordinadorasDe(tenant), [A, B]);
  });
  it("sin nada guardado, lista vacía: nadie coordina", () => {
    assert.deepEqual(coordinadorasDe({ settings: {} }), []);
    assert.deepEqual(coordinadorasDe({ settings: { clinica: { coordinadoras: "A" } } }), []);
    assert.deepEqual(coordinadorasDe(null), []);
  });
});

describe("esCoordinadora", () => {
  it("la ficha que está en la lista coordina; otra no; sin ficha, no", () => {
    assert.equal(esCoordinadora(tenant, A), true);
    assert.equal(esCoordinadora(tenant, B), true);
    assert.equal(esCoordinadora(tenant, "33333333-3333-4333-8333-333333333333"), false);
    assert.equal(esCoordinadora(tenant, null), false);
    assert.equal(esCoordinadora(tenant, ""), false);
  });
});

describe("veTodoElEquipo", () => {
  it("dirección siempre, aunque no esté en la lista ni tenga ficha", () => {
    assert.equal(veTodoElEquipo({ tenant, role: "admin", teamMemberId: null }), true);
    assert.equal(veTodoElEquipo({ tenant, role: "superadmin", teamMemberId: "x" }), true);
  });
  it("una terapeuta solo si coordina", () => {
    assert.equal(veTodoElEquipo({ tenant, role: "user", teamMemberId: A }), true);
    assert.equal(veTodoElEquipo({ tenant, role: "user", teamMemberId: "33333333-3333-4333-8333-333333333333" }), false);
    assert.equal(veTodoElEquipo({ tenant: { settings: {} }, role: "user", teamMemberId: A }), false);
  });
});
