// @prueba ligera
/**
 * _smoke-incidencia-visto.mjs — el «Visto» por responsable (04/09/2026).
 *
 * Fija `lib/clinica/vistoIncidencia.js`. Lo que de verdad puede salir mal aquí
 * son dos cosas, y las dos están probadas:
 *
 *   · Que una actualización NO devuelva la incidencia a quien la dio por vista
 *     — entonces el visto sería un «no me lo cuentes más» y no un «ya está lo
 *     mío», que es lo que se pidió.
 *   · Que se la devuelva a QUIEN la provoca — comentar te devolvería tu propio
 *     comentario a la bandeja, para siempre.
 */

import test, { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  esActualizacion,
  aQuienSeLeReabre,
  vistoDe,
  repasoDelEquipo,
  CAMPOS_QUE_REABREN,
} from "../lib/clinica/vistoIncidencia.js";

// Un `Op` de mentira: solo hace falta que sea una clave estable y distinguible.
const Op = { ne: Symbol.for("ne") };

test("un comentario es una actualización", () => {
  assert.equal(esActualizacion({ cambios: {}, hayComentario: true }), true);
});

test("reasignar la incidencia es una actualización", () => {
  assert.equal(esActualizacion({ cambios: {}, cambiaronResponsables: true }), true);
});

test("cada campo que cuenta reabre por sí solo", () => {
  for (const campo of CAMPOS_QUE_REABREN) {
    assert.equal(
      esActualizacion({ cambios: { [campo]: "lo que sea" } }),
      true,
      `${campo} debería reabrir`,
    );
  }
});

test("reabrir una incidencia cerrada cuenta (verification y status)", () => {
  assert.equal(esActualizacion({ cambios: { verification: null, status: "pending" } }), true);
});

test("lo que no cambia nada para el equipo NO reabre", () => {
  // `clientId` se recalcula solo al cambiar el paciente (que sí cuenta): avisar
  // dos veces del mismo cambio es avisar mal. `resolvedAt` viaja con
  // `verification`. Y una llamada vacía no es una actualización.
  assert.equal(esActualizacion({ cambios: { clientId: "otra-familia" } }), false);
  assert.equal(esActualizacion({ cambios: { resolvedAt: new Date() } }), false);
  assert.equal(esActualizacion({ cambios: {} }), false);
  assert.equal(esActualizacion({}), false);
  assert.equal(esActualizacion(), false);
});

test("marcar visto a secas no reabre nada", () => {
  // El PATCH de `{ visto: true }` no lleva `cambios`: si esto devolviera true,
  // dar una por vista se la devolvería a las demás en el acto.
  assert.equal(esActualizacion({ cambios: {}, hayComentario: false, cambiaronResponsables: false }), false);
});

test("se le reabre a los demás, nunca a quien lo provoca", () => {
  const where = aQuienSeLeReabre("inc-1", "ana", Op);
  assert.equal(where.incidenciaId, "inc-1");
  // Solo a quien lo tenía puesto: no se escriben filas que ya estaban a NULL.
  assert.deepEqual(where.vistoAt, { [Op.ne]: null });
  assert.deepEqual(where.teamMemberId, { [Op.ne]: "ana" });
});

test("sin ficha de equipo se reabre para todos", () => {
  // Dirección con un usuario que no está en plantilla: nadie de la lista lo ha
  // provocado, así que a nadie se le perdona.
  const where = aQuienSeLeReabre("inc-1", null, Op);
  assert.equal("teamMemberId" in where, false);
});

test("vistoDe: solo los responsables tienen parte que dar por hecha", () => {
  const filas = [
    { teamMemberId: "ana", vistoAt: "2026-09-04T10:00:00Z" },
    { teamMemberId: "bea", vistoAt: null },
  ];
  assert.deepEqual(vistoDe(filas, "ana"), {
    puedeMarcar: true,
    visto: true,
    vistoAt: "2026-09-04T10:00:00Z",
  });
  assert.deepEqual(vistoDe(filas, "bea"), { puedeMarcar: true, visto: false, vistoAt: null });
  // Carmen registró la incidencia pero no es responsable: la ve, y no tiene botón.
  assert.deepEqual(vistoDe(filas, "carmen"), { puedeMarcar: false, visto: false, vistoAt: null });
});

test("vistoDe no revienta sin datos", () => {
  assert.deepEqual(vistoDe([], "ana"), { puedeMarcar: false, visto: false, vistoAt: null });
  assert.deepEqual(vistoDe(null, "ana"), { puedeMarcar: false, visto: false, vistoAt: null });
  assert.deepEqual(vistoDe([{ teamMemberId: "ana", vistoAt: null }], null), {
    puedeMarcar: false,
    visto: false,
    vistoAt: null,
  });
});

/*
 * QUIÉN LA HA REVISADO (05/09/2026, vuelta de AV-0039).
 *
 * Olga: «así podríamos saber en todo momento en qué estado se encuentra la
 * incidencia y quién la ha revisado». El dato estaba guardado desde el 04/09,
 * pero la ficha solo decía si lo habías marcado TÚ.
 *
 * Lo que se fija: el ORDEN (las que faltan primero: quién falta es lo que se
 * mira) y el recuento. Los nombres no entran aquí a propósito — los pone la
 * pantalla, que ya los tiene, y así esto no toca datos de personas.
 */
describe("repasoDelEquipo", () => {
  const ayer = "2026-09-04T10:00:00.000Z";
  const hoy = "2026-09-05T10:00:00.000Z";

  it("pone primero a quien falta, y entre las vistas la más reciente arriba", () => {
    const { repaso } = repasoDelEquipo([
      { teamMemberId: "a", vistoAt: ayer },
      { teamMemberId: "b", vistoAt: null },
      { teamMemberId: "c", vistoAt: hoy },
    ]);
    assert.deepEqual(repaso.map((r) => r.teamMemberId), ["b", "c", "a"]);
    assert.equal(repaso[0].visto, false);
  });

  it("cuenta cuántas la han dado por vista", () => {
    const r = repasoDelEquipo([
      { teamMemberId: "a", vistoAt: ayer },
      { teamMemberId: "b", vistoAt: null },
    ]);
    assert.equal(r.vistos, 1);
    assert.equal(r.total, 2);
    assert.equal(r.todos, false);
  });

  it("`todos` solo con al menos una y todas marcadas", () => {
    assert.equal(repasoDelEquipo([{ teamMemberId: "a", vistoAt: hoy }]).todos, true);
    assert.equal(repasoDelEquipo([]).todos, false, "sin responsables no están «todas vistas»");
    assert.equal(repasoDelEquipo(null).todos, false);
  });

  it("no se inventa filas sin responsable", () => {
    const { repaso } = repasoDelEquipo([{ teamMemberId: null, vistoAt: hoy }, null, { teamMemberId: "a", vistoAt: null }]);
    assert.deepEqual(repaso.map((r) => r.teamMemberId), ["a"]);
  });
});
