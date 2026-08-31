// @prueba ligera
// Fija lib/clinica/trabajoInterno.js: qué cuenta como trabajo interno en
// Productividad — bloqueos T.I./equipo, valoraciones sin asignar y el
// desglose bono/taller/normal.
import test from "node:test";
import assert from "node:assert/strict";
import { clasificarBloqueo, valoracionEsInterna, desgloseDeCita, minutosDentroDe } from "../lib/clinica/trabajoInterno.js";

test("las tres grafías reales de «Reservado T.I.» cuentan juntas", () => {
  assert.equal(clasificarBloqueo("Reservado T.I."), "ti");
  assert.equal(clasificarBloqueo("Reservado T.I"), "ti");
  assert.equal(clasificarBloqueo("Reservado t.i."), "ti");
});

test("la reunión de equipo, con o sin tilde, y el trabajo en equipo", () => {
  assert.equal(clasificarBloqueo("REUNIÓN EQUIPO"), "equipo");
  assert.equal(clasificarBloqueo("reunion equipo"), "equipo");
  assert.equal(clasificarBloqueo("Trabajo en equipo"), "equipo");
});

test("un bloqueo cualquiera (vacaciones, médico) no es trabajo interno", () => {
  assert.equal(clasificarBloqueo("Vacaciones"), null);
  assert.equal(clasificarBloqueo("Médico"), null);
  assert.equal(clasificarBloqueo(""), null);
  assert.equal(clasificarBloqueo(null), null);
});

test("valoración a paciente no asignado = interna; al asignado, directa", () => {
  assert.equal(valoracionEsInterna({ teamMemberId: "ana", terapeutasDelPaciente: ["bea"] }), true);
  assert.equal(valoracionEsInterna({ teamMemberId: "ana", terapeutasDelPaciente: [] }), true);
  assert.equal(valoracionEsInterna({ teamMemberId: "ana", terapeutasDelPaciente: ["ana", "bea"] }), false);
});

test("el desglose: bono manda sobre el nombre; taller/grupal por nombre; el resto normal", () => {
  assert.equal(desgloseDeCita({ packId: "p1", eventTypeName: "Taller X" }), "bono");
  assert.equal(desgloseDeCita({ packId: null, eventTypeName: "Taller de Estimulación" }), "taller");
  assert.equal(desgloseDeCita({ packId: null, eventTypeName: "Terapia GRUPAL 1h" }), "taller");
  assert.equal(desgloseDeCita({ packId: null, eventTypeName: "Sesión seguimiento" }), "normal");
});

test("los minutos de un bloqueo se recortan al mes", () => {
  const desde = new Date("2026-08-01T00:00:00Z");
  const hasta = new Date("2026-09-01T00:00:00Z");
  assert.equal(minutosDentroDe("2026-08-31T10:00:00Z", "2026-08-31T12:00:00Z", desde, hasta), 120);
  assert.equal(minutosDentroDe("2026-08-31T23:00:00Z", "2026-09-01T01:00:00Z", desde, hasta), 60);
  assert.equal(minutosDentroDe("2026-07-30T10:00:00Z", "2026-07-30T12:00:00Z", desde, hasta), 0);
});
