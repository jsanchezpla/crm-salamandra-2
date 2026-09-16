// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-marca-de-bono.mjs — la rejilla dice «Bono» y lo pinta aparte
 * (16/09/2026, AV-0162 de Aumenta).
 *
 *   node scripts/_smoke-marca-de-bono.mjs
 *
 * ── DE QUÉ PETICIÓN REAL NACE ──────────────────────────────────────────────
 * Olga: «para poder ver que son bonos y avisar a los pacientes, necesitaría que
 * aparezcan en otro color en el horario, o aún mejor, con la palabra bono».
 *
 * Lo que fija esta prueba no es el color —ese se puede cambiar— sino las dos
 * cosas que, si se tuercen, hacen daño de verdad:
 *
 *   1. Que la marca salga SOLO con `packId`. Marcar «tiene bono» en vez de «va
 *      con bono» haría que alguien le dijera a una familia que la sesión se
 *      descuenta cuando no se descuenta.
 *   2. Que el «3/10» de siempre siga saliendo en las citas sin bono. Ese
 *      número lleva en la rejilla desde antes y dice por dónde va una serie.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { COLOR_BONO, esDeBono, etiquetaDeSesion, colorConBono } from "../lib/citas/marcaDeBono.js";

test("es de bono solo si la cita está enganchada a uno", () => {
  assert.equal(esDeBono({ packId: "7c2f…" }), true);
  assert.equal(esDeBono({ packId: null }), false);
  assert.equal(esDeBono({}), false);
  assert.equal(esDeBono(null), false);
  // Que el PACIENTE tenga bono no marca la cita: la marca dice lo que pasa.
  assert.equal(esDeBono({ packId: null, patientId: "abc", tieneBono: true }), false);
});

test("la etiqueta lleva la palabra delante del número", () => {
  assert.equal(etiquetaDeSesion({ esBono: true, numero: 3, total: 10 }), "Bono 3/10");
  assert.equal(etiquetaDeSesion({ esBono: true, numero: 1, total: 1 }), "Bono 1");
  assert.equal(etiquetaDeSesion({ esBono: true }), "Bono");
});

test("sin bono se queda el «3/10» de siempre", () => {
  assert.equal(etiquetaDeSesion({ esBono: false, numero: 3, total: 10 }), "3/10");
  assert.equal(etiquetaDeSesion({ esBono: false, numero: 2, total: 0 }), "2");
  assert.equal(etiquetaDeSesion({ esBono: false, numero: 0, total: 10 }), null);
  assert.equal(etiquetaDeSesion(), null);
});

test("el color del bono manda sobre el que traía la cita, y solo entonces", () => {
  // El azul único de Aumenta, el verde de fábrica: los dos pierden con un bono.
  assert.equal(colorConBono({ esBono: true, color: "#9BBDC7" }), COLOR_BONO);
  assert.equal(colorConBono({ esBono: true, color: null }), COLOR_BONO);
  assert.equal(colorConBono({ esBono: false, color: "#9BBDC7" }), "#9BBDC7");
  assert.equal(colorConBono({ esBono: false, color: null }), null);
  assert.equal(colorConBono(), null);
});

test("el color del bono no es ninguno de los que ya se usan", () => {
  const yaUsados = ["#9BBDC7", "#3F6E5B", "#9ca3af", "#a78bfa", "#475569"];
  assert.ok(!yaUsados.map((c) => c.toUpperCase()).includes(COLOR_BONO.toUpperCase()));
  assert.match(COLOR_BONO, /^#[0-9A-Fa-f]{6}$/);
});
