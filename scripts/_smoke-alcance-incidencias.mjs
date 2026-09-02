// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-alcance-incidencias.mjs — quién ve y quién borra cada incidencia
 * (02/09/2026, Aumenta por el buzón: AV-0018 y AV-0013).
 *
 *   node scripts/_smoke-alcance-incidencias.mjs
 *
 * Lo que pidió el centro: «cada terapeuta que vea las suyas, pero Dirección que
 * pueda ver todas», y poder eliminar una incidencia creada por error. La regla
 * vive en `lib/clinica/alcanceIncidencias.js` y la leen cuatro endpoints; si
 * se rompe, no da error: una terapeuta ve la solicitud laboral de otra.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";

import {
  veTodasLasIncidencias,
  whereIncidenciasVisibles,
  puedeVerIncidencia,
  puedeBorrarIncidencia,
} from "../lib/clinica/alcanceIncidencias.js";

// Un tenant de mentira con la tabla pivote: la incidencia «i-1» tiene a «yo»
// de segunda responsable; «i-2» no tiene a nadie.
function modelos({ enlaces = [{ incidenciaId: "i-1", teamMemberId: "yo" }] } = {}) {
  return {
    IncidenciaAssignee: {
      findAll: async ({ where }) => enlaces.filter((e) => e.teamMemberId === where.teamMemberId),
      count: async ({ where }) =>
        enlaces.filter((e) => e.incidenciaId === where.incidenciaId && e.teamMemberId === where.teamMemberId).length,
    },
  };
}

describe("dirección ve todas", () => {
  it("admin y superadmin sí; user no; sin sesión no", () => {
    assert.equal(veTodasLasIncidencias({ user: { role: "admin" } }), true);
    assert.equal(veTodasLasIncidencias({ user: { role: "superadmin" } }), true);
    assert.equal(veTodasLasIncidencias({ user: { role: "user" } }), false);
    assert.equal(veTodasLasIncidencias({}), false);
    assert.equal(veTodasLasIncidencias(null), false);
  });
});

describe("la condición de «las mías»", () => {
  it("sin ficha de equipo no casa con NINGUNA fila (antes se enseñaban todas)", async () => {
    const w = await whereIncidenciasVisibles(modelos(), null);
    assert.deepEqual(w, { id: { [Op.in]: [] } });
  });

  it("es responsable O la registró, por la pivote", async () => {
    const w = await whereIncidenciasVisibles(modelos(), "yo");
    assert.deepEqual(w, {
      [Op.or]: [{ id: { [Op.in]: ["i-1"] } }, { reportedById: "yo" }],
    });
  });

  it("en un tenant sin la pivote cae al espejo assignedToId", async () => {
    const w = await whereIncidenciasVisibles({}, "yo");
    assert.deepEqual(w, { [Op.or]: [{ assignedToId: "yo" }, { reportedById: "yo" }] });
  });
});

describe("una fila concreta", () => {
  it("la que registré, la que tengo asignada (pivote o espejo); la ajena no", async () => {
    const M = modelos();
    assert.equal(await puedeVerIncidencia(M, { id: "i-9", reportedById: "yo" }, "yo"), true);
    assert.equal(await puedeVerIncidencia(M, { id: "i-1", reportedById: "otra" }, "yo"), true);
    assert.equal(await puedeVerIncidencia(M, { id: "i-9", reportedById: "otra", assignedToId: "yo" }, "yo"), true);
    assert.equal(await puedeVerIncidencia(M, { id: "i-2", reportedById: "otra", assignedToId: "otra" }, "yo"), false);
  });

  it("sin ficha de equipo, o sin fila, no", async () => {
    assert.equal(await puedeVerIncidencia(modelos(), { id: "i-1", reportedById: "yo" }, null), false);
    assert.equal(await puedeVerIncidencia(modelos(), null, "yo"), false);
  });
});

describe("borrar", () => {
  it("dirección borra cualquiera", () => {
    assert.equal(puedeBorrarIncidencia({ esAdmin: true, row: { reportedById: "otra" }, teamMemberId: null }), true);
  });
  it("el resto solo la que registró — ser responsable no basta", () => {
    assert.equal(puedeBorrarIncidencia({ esAdmin: false, row: { reportedById: "yo" }, teamMemberId: "yo" }), true);
    assert.equal(puedeBorrarIncidencia({ esAdmin: false, row: { reportedById: "otra", assignedToId: "yo" }, teamMemberId: "yo" }), false);
    assert.equal(puedeBorrarIncidencia({ esAdmin: false, row: { reportedById: null }, teamMemberId: "yo" }), false);
    assert.equal(puedeBorrarIncidencia({ esAdmin: false, row: { reportedById: "yo" }, teamMemberId: null }), false);
  });
});
