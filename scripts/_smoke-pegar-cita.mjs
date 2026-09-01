// @prueba ligera
// Fija lib/citas/pegarCita.js: dónde cae una cita cortada/copiada al pegarla.
import test from "node:test";
import assert from "node:assert/strict";
import { destinoDePegado, sePuedeMover } from "../lib/citas/pegarCita.js";

test("un clic con hora pega en ese instante exacto (el offset manda)", () => {
  assert.equal(destinoDePegado("2026-09-15T10:30:00+02:00", "da igual"), "2026-09-15T08:30:00.000Z");
});

test("un clic de la vista de mes (solo fecha) conserva la hora original", () => {
  const iso = destinoDePegado("2026-09-15", "2026-08-31T16:00:00+02:00");
  // Se construye en hora LOCAL del proceso, así que se lee igual: las 16:00.
  const d = new Date(iso);
  assert.equal(d.getHours(), 16);
  assert.equal(d.getMinutes(), 0);
  assert.equal(iso.startsWith("2026-09-1"), true);
});

test("entradas ilegibles devuelven null, no una fecha inventada", () => {
  assert.equal(destinoDePegado("", "2026-08-31T16:00:00+02:00"), null);
  assert.equal(destinoDePegado("no es fecha", "2026-08-31T16:00:00+02:00"), null);
  assert.equal(destinoDePegado("2026-09-15", "sin hora"), null);
  assert.equal(destinoDePegado("2026-99-99", "2026-08-31T16:00:00+02:00"), null);
});

test("las citas cerradas no se mueven; las vivas sí", () => {
  assert.equal(sePuedeMover("confirmed"), true);
  assert.equal(sePuedeMover("pending"), true);
  assert.equal(sePuedeMover("cancelled"), false);
  assert.equal(sePuedeMover("no_show"), false);
  assert.equal(sePuedeMover("completed"), false);
});
