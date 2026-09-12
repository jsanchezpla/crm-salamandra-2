/**
 * _smoke-siguientes-iguales.mjs — «esta y las siguientes» sin serie
 * (lib/citas/siguientesIguales.js, 11/09/2026).
 *
 * @prueba ligera
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  desplazamiento,
  esBloqueoSiguiente,
  esCitaSiguiente,
  fechaCorta,
  instanteMovido,
  paredDe,
} from "../lib/citas/siguientesIguales.js";
import { preguntaDeSerie, resumenDeSerie } from "../lib/citas/preguntaDeSerie.js";

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

/*
 * ── LA PREGUNTA Y EL RESUMEN (12/09/2026, Rodrigo) ─────────────────────────
 * «Si borro o muevo una cita, que me proponga borrar o mover esa y todas las
 * citas futuras, por si me he equivocado.» El texto se escribe una vez
 * (lib/citas/siguientesIguales.js) porque lo usan cinco vías.
 */
test("la pregunta: mover es un sí o un no; cancelar y borrar, tres respuestas", () => {
  const mover = preguntaDeSerie("mover", { n: 38, hasta: "24/06/2027" });
  assert.match(mover.texto, /38 citas más como esta/);
  assert.match(mover.texto, /hasta el 24\/06\/2027/);
  assert.equal(mover.confirmar, "Sí, moverlas también");
  assert.equal(mover.opciones, undefined, "mover no elige: ya está movida");

  const borrar = preguntaDeSerie("borrar", { n: 1, lineas: ["Aún no ha pasado."] });
  assert.match(borrar.texto, /Aún no ha pasado/, "las advertencias de la pantalla siguen delante");
  assert.match(borrar.texto, /1 cita más como esta/);
  assert.deepEqual(borrar.opciones.map((o) => o.valor), ["solo", "serie"]);
  assert.equal(borrar.opciones[1].label, "Borrar esta y la siguiente");

  const cancelar = preguntaDeSerie("cancelar", { n: 4 });
  assert.equal(cancelar.opciones[1].label, "Cancelar esta y las 4 siguientes");
  assert.match(cancelar.opciones[1].pista, /no se avisa por correo/);
});

test("el resumen cuenta las que salieron y, con su fecha, las que se quedaron", () => {
  const r = resumenDeSerie("borrar", { hechas: 36, saltadas: [{ fecha: "01/10/2026", motivo: "está cobrada" }] });
  assert.equal(r.titulo, "Borradas, menos algunas");
  assert.match(r.texto, /36 citas borradas/);
  assert.match(r.texto, /01\/10\/2026: está cobrada/);
  const limpio = resumenDeSerie("mover", { hechas: 1 });
  assert.equal(limpio.titulo, "Movidas");
  assert.equal(limpio.texto, "1 cita movida a la nueva hora.");
  // Más de ocho se cuentan, no se listan todas.
  const muchas = resumenDeSerie("cancelar", {
    hechas: 0,
    saltadas: Array.from({ length: 9 }, (_, i) => ({ fecha: `0${i + 1}/10/2026`, motivo: "no" })),
  });
  assert.match(muchas.texto, /y 1 más/);
});

// ── Y que las cinco vías sigan preguntando ────────────────────────────────
// Esto sí es texto: lo que se vigila es que el conteo vaya ANTES de tocar la
// cita y que el borrado en bloque vaya ANTES de borrar la de partida. Si se
// invierte el orden, la serie deja de existir y no hay de quién deducirla.
const raiz = new URL("../", import.meta.url);
const leer = (p) => readFileSync(new URL(p, raiz), "utf8");
const RUTA = leer("app/api/citas/bookings/[id]/siguientes/route.js");
const MODAL = leer("modules/default/citas/CitaDetalleModal.jsx");
const AGENDA = leer("modules/default/CitasModule.jsx");
const ETIQUETAS = leer("lib/actividad/etiquetas.js");
const BORRAR = leer("lib/citas/borrarCita.js");

test("el endpoint de las siguientes sabe mover, cancelar y borrar", () => {
  assert.ok(RUTA.includes('body?.accion === "cancelar"'), "tiene que aceptar la cancelación en bloque");
  assert.ok(RUTA.includes("export const DELETE"), "y el borrado en bloque");
  assert.ok(RUTA.includes("borrarCitaDeVerdad"), "borrando con la misma regla que una sola cita");
  assert.ok(RUTA.includes("reembolsarCitaSiProcede"), "y resolviendo el dinero al cancelar");
});

test("una línea de auditoría por tanda, cada una con su frase", () => {
  for (const accion of ["movidas", "canceladas", "borradas"]) {
    assert.ok(RUTA.includes(`action: "citas.${accion}_en_bloque"`), `falta la auditoría de ${accion}`);
    assert.ok(ETIQUETAS.includes(`"citas.${accion}_en_bloque":`), `falta la frase de ${accion} en etiquetas.js`);
  }
});

test("el dinero frena el borrado, y quien llama se entera", () => {
  assert.ok(BORRAR.includes("dineroQueImpideBorrar"));
  assert.ok(BORRAR.includes('paid: "está cobrada"'));
  assert.ok(BORRAR.includes("return { ok: false, freno }"), "el freno se devuelve, no se traga");
});

test("la ficha de la cita cuenta las siguientes antes de mover, cancelar y borrar", () => {
  assert.equal((MODAL.match(/contarSiguientes\(openBooking\.id\)/g) ?? []).length, 3);
  assert.ok(MODAL.includes('alcanceDeSerie("cancelar"'));
  assert.ok(MODAL.includes('alcanceDeSerie("borrar"'));
  const enBloque = MODAL.indexOf('aplicarALasSiguientes("borrar"');
  const laDeAqui = MODAL.indexOf("}?hard=true"); // el fetch, no el comentario que lo explica
  assert.ok(enBloque > 0 && enBloque < laDeAqui, "las siguientes se borran ANTES que la cita de la que se deducen");
});

test("arrastrar una cita y pegarla tras cortarla preguntan también", () => {
  assert.equal((AGENDA.match(/contarSiguientes\(/g) ?? []).length, 2);
  assert.equal((AGENDA.match(/ofrecerMoverSiguientes\(\{/g) ?? []).length, 2);
  // El conteo, antes del PATCH que mueve la cita.
  const cuenta = AGENDA.indexOf("contarSiguientes(info.event.id)");
  const patch = AGENDA.indexOf("scheduledAt: nuevoIso", cuenta);
  assert.ok(cuenta > 0 && cuenta < patch, "hay que contar con la hora que la cita todavía tiene");
});
