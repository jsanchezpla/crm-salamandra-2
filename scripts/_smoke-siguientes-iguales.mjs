/**
 * _smoke-siguientes-iguales.mjs — «esta y las siguientes» sin serie
 * (lib/citas/siguientesIguales.js, 11/09/2026).
 *
 * @prueba ligera
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  desplazamiento,
  esBloqueoSiguiente,
  esCitaSiguiente,
  fechaCorta,
  instanteMovido,
  paredDe,
} from "../lib/citas/siguientesIguales.js";

// Miércoles 16/09/2026 a las 12:30 de Madrid (CEST, +02:00).
const BASE = {
  id: "a",
  scheduledAt: "2026-09-16T10:30:00.000Z",
  duration: 45,
  status: "confirmed",
  eventTypeId: "t1",
  teamMemberId: "tm1",
  patientId: "p1",
  clientId: "c1",
};
const cita = (cambios) => ({ ...BASE, id: "b", ...cambios });

test("paredDe: día de la semana y hora en Madrid, no en UTC", () => {
  const p = paredDe("2026-09-16T10:30:00.000Z");
  assert.equal(p.dow, 3);
  assert.equal(p.hhmm, "12:30");
  // A las 00:30 de Madrid en UTC todavía es el día anterior.
  const madrugada = paredDe("2026-09-16T22:30:00.000Z");
  assert.equal(madrugada.dow, 4);
  assert.equal(madrugada.hhmm, "00:30");
});

test("una cita siguiente: mismo niño, tipo, terapeuta, día de la semana y hora, y después", () => {
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-09-23T10:30:00.000Z" })), true);
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-10-07T10:30:00.000Z" })), true);
});

test("la serie sobrevive al cambio de hora de octubre (misma hora de pared)", () => {
  // Miércoles 04/11/2026 a las 12:30 de Madrid es 11:30Z.
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-11-04T11:30:00.000Z" })), true);
  // Y 10:30Z en noviembre sería las 11:30 de Madrid: NO es la misma.
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-11-04T10:30:00.000Z" })), false);
});

test("no es siguiente: la anterior, la misma, otra hora, otro día, otro tipo, otro niño, cancelada, taller", () => {
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-09-09T10:30:00.000Z" })), false);
  assert.equal(esCitaSiguiente(BASE, { ...BASE }), false);
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-09-23T11:00:00.000Z" })), false);
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-09-24T10:30:00.000Z" })), false);
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-09-23T10:30:00.000Z", eventTypeId: "t2" })), false);
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-09-23T10:30:00.000Z", patientId: "p2" })), false);
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-09-23T10:30:00.000Z", status: "cancelled" })), false);
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-09-23T10:30:00.000Z", tallerGrupoId: "g" })), false);
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-09-23T10:30:00.000Z", teamMemberId: "tm2" })), false);
  assert.equal(esCitaSiguiente(BASE, cita({ scheduledAt: "2026-09-23T10:30:00.000Z", duration: 60 })), false);
});

test("sin paciente manda la familia; sin familia, el correo; sin correo, el nombre", () => {
  const sinPaciente = { ...BASE, patientId: null };
  assert.equal(esCitaSiguiente(sinPaciente, cita({ scheduledAt: "2026-09-23T10:30:00.000Z", patientId: null })), true);
  assert.equal(esCitaSiguiente(sinPaciente, cita({ scheduledAt: "2026-09-23T10:30:00.000Z", patientId: null, clientId: "c2" })), false);
  const porCorreo = { ...BASE, patientId: null, clientId: null, clientEmail: "Mama@Casa.es" };
  assert.equal(esCitaSiguiente(porCorreo, { ...porCorreo, id: "b", scheduledAt: "2026-09-23T10:30:00.000Z", clientEmail: "mama@casa.es" }), true);
  const porNombre = { ...BASE, patientId: null, clientId: null, clientEmail: "", clientName: "Familia Pérez" };
  assert.equal(esCitaSiguiente(porNombre, { ...porNombre, id: "b", scheduledAt: "2026-09-23T10:30:00.000Z", clientName: "familia pérez " }), true);
});

test("bloqueos: misma persona, categoría, rótulo, duración, día y hora", () => {
  const b = { id: "x", teamMemberId: "tm1", categoryKey: "gestion_documental", label: "GESTION DOCUMENTAL", startAt: "2026-09-17T11:30:00.000Z", endAt: "2026-09-17T12:30:00.000Z" };
  const sig = (c) => ({ ...b, id: "y", startAt: "2026-09-24T11:30:00.000Z", endAt: "2026-09-24T12:30:00.000Z", ...c });
  assert.equal(esBloqueoSiguiente(b, sig()), true);
  assert.equal(esBloqueoSiguiente(b, sig({ label: "gestion documental" })), true);
  assert.equal(esBloqueoSiguiente(b, sig({ label: "" })), false);
  assert.equal(esBloqueoSiguiente(b, sig({ categoryKey: "descanso" })), false);
  assert.equal(esBloqueoSiguiente(b, sig({ endAt: "2026-09-24T12:15:00.000Z" })), false);
  assert.equal(esBloqueoSiguiente(b, sig({ teamMemberId: null })), false);
  assert.equal(esBloqueoSiguiente(b, sig({ startAt: "2026-09-10T11:30:00.000Z", endAt: "2026-09-10T12:30:00.000Z" })), false);
  // Cierre del centro: las dos sin persona.
  const centro = { ...b, teamMemberId: null };
  assert.equal(esBloqueoSiguiente(centro, { ...sig(), teamMemberId: null }), true);
});

test("desplazamiento e instanteMovido: mover de miércoles 12:30 a jueves 14:15", () => {
  const d = desplazamiento("2026-09-16T10:30:00.000Z", "2026-09-17T12:15:00.000Z");
  assert.deepEqual(d, { dias: 1, hhmm: "14:15" });
  // La del 23/09 (miércoles) pasa al jueves 24/09 a las 14:15 de Madrid.
  assert.equal(instanteMovido("2026-09-23T10:30:00.000Z", d).toISOString(), "2026-09-24T12:15:00.000Z");
  // La del 11/11 (ya en horario de invierno) pasa al jueves 12/11 a las 14:15 de Madrid = 13:15Z.
  assert.equal(instanteMovido("2026-11-11T11:30:00.000Z", d).toISOString(), "2026-11-12T13:15:00.000Z");
});

test("desplazamiento de solo hora, y hacia atrás en el calendario", () => {
  assert.deepEqual(desplazamiento("2026-09-16T10:30:00.000Z", "2026-09-16T08:00:00.000Z"), { dias: 0, hhmm: "10:00" });
  assert.deepEqual(desplazamiento("2026-09-16T10:30:00.000Z", "2026-09-14T10:30:00.000Z"), { dias: -2, hhmm: "12:30" });
});

test("fechaCorta", () => {
  assert.equal(fechaCorta("2027-06-24T10:30:00.000Z"), "24/06/2027");
});
