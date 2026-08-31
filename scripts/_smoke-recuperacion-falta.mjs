// @prueba ligera
// Fija lib/citas/recuperacionFalta.js: la falta justificada ES la recuperable,
// y qué citas pueden apuntarse como su recuperación.
import test from "node:test";
import assert from "node:assert/strict";
import { esRecuperable, rotuloFalta, citasQuePuedenRecuperar } from "../lib/citas/recuperacionFalta.js";

test("recuperable = falta justificada; lo demás, no", () => {
  assert.equal(esRecuperable({ status: "no_show", noShowJustified: true }), true);
  assert.equal(esRecuperable({ status: "no_show", noShowJustified: false }), false);
  assert.equal(esRecuperable({ status: "confirmed", noShowJustified: true }), false);
  assert.equal(esRecuperable(null), false);
});

test("el rótulo lleva la palabra del centro delante", () => {
  assert.equal(rotuloFalta({ status: "no_show", noShowJustified: true }), "Falta recuperable (justificada)");
  assert.equal(rotuloFalta({ status: "no_show", noShowJustified: false }), "Falta no recuperable (sin justificar)");
  assert.equal(rotuloFalta({ status: "completed" }), null);
});

test("recuperan: otras citas vivas del mismo cliente, posteriores, en orden", () => {
  const falta = { id: "f", clientId: "c1", scheduledAt: "2026-09-10T10:00:00Z", status: "no_show", noShowJustified: true };
  const candidatas = citasQuePuedenRecuperar(
    [
      { id: "f", clientId: "c1", status: "confirmed", scheduledAt: "2026-09-17T10:00:00Z" }, // ella misma
      { id: "a", clientId: "c1", status: "confirmed", scheduledAt: "2026-09-24T10:00:00Z" },
      { id: "b", clientId: "c1", status: "pending", scheduledAt: "2026-09-17T10:00:00Z" },
      { id: "c", clientId: "c2", status: "confirmed", scheduledAt: "2026-09-18T10:00:00Z" }, // otro cliente
      { id: "d", clientId: "c1", status: "cancelled", scheduledAt: "2026-09-19T10:00:00Z" }, // cancelada
      { id: "e", clientId: "c1", status: "confirmed", scheduledAt: "2026-09-03T10:00:00Z" }, // anterior
    ],
    falta
  );
  assert.deepEqual(candidatas.map((c) => c.id), ["b", "a"]);
});
