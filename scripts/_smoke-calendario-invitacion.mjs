// @prueba ligera
/**
 * _smoke-calendario-invitacion.mjs — la convocatoria de un evento del
 * Calendario: qué enlace se acepta, qué correo, y CUÁNDO se manda.
 *
 * Lo que más importa aquí es lo último. En Citas el correo del enlace sale solo
 * al detectar la transición null→valor; en el Calendario NO, y a propósito: un
 * evento se arrastra y se reajusta muchas veces, y un correo por cada roce sería
 * ruido para alguien que no lo ha pedido. Si alguien "unifica" los dos
 * comportamientos, esta prueba lo para.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  revisarEnlace,
  revisarCorreoInvitado,
  limpio,
  toca,
  MAX_URL,
} from "../lib/calendar/invitacion.js";
import { invitacionEventoTemplate } from "../lib/email/templates/calendar/invitacionEvento.js";

test("el enlace vacío vale: un evento sin videollamada es normal", () => {
  assert.equal(revisarEnlace(""), null);
  assert.equal(revisarEnlace(null), null);
});

test("se acepta cualquier proveedor, no solo Meet/Zoom/Teams", () => {
  for (const url of [
    "https://meet.google.com/abc-defg-hij",
    "https://us02web.zoom.us/j/123456789",
    "https://teams.microsoft.com/l/meetup-join/x",
    "https://meet.jit.si/una-sala",
    "https://videollamada.elcolegio.es/sala/42",
  ]) {
    assert.equal(revisarEnlace(url), null, `deberia valer: ${url}`);
  }
});

test("lo que no es una dirección web se rechaza con una frase en cristiano", () => {
  assert.match(revisarEnlace("pregunta a Marta"), /direcci[oó]n web/i);
  assert.match(revisarEnlace("javascript:alert(1)"), /https:\/\//);
  assert.match(revisarEnlace("h" + "t".repeat(MAX_URL)), /demasiado largo/i);
});

test("el correo del invitado: vacío vale, con forma de correo vale, lo demás no", () => {
  assert.equal(revisarCorreoInvitado(""), null);
  assert.equal(revisarCorreoInvitado("marta@centro.com"), null);
  assert.match(revisarCorreoInvitado("marta.centro.com"), /forma de correo/i);
});

test("limpio: cadena vacía y espacios son null, no cadena vacía", () => {
  assert.equal(limpio("   "), null);
  assert.equal(limpio(""), null);
  assert.equal(limpio(undefined), null);
  assert.equal(limpio("  https://x.es  "), "https://x.es");
});

test("el correo NO sale solo: hace falta pedirlo Y tener a quién mandárselo", () => {
  const conCorreo = { inviteEmail: "marta@centro.com" };
  const sinCorreo = { inviteEmail: null };
  // Lo pide la casilla de la pantalla.
  assert.equal(toca({ enviarInvitacion: true }, conCorreo), true);
  // Guardar sin marcarla NO manda nada — el caso del evento que se arrastra.
  assert.equal(toca({}, conCorreo), false);
  assert.equal(toca({ enviarInvitacion: false }, conCorreo), false);
  // Y sin destinatario no hay correo por mucho que se pida.
  assert.equal(toca({ enviarInvitacion: true }, sinCorreo), false);
});

test("la fecha del correo NO se desplaza un día (el fallo de la agenda del 26/08)", () => {
  const { subject, text } = invitacionEventoTemplate({
    tenantName: "Aumenta",
    titulo: "Coordinación de caso",
    startDate: "2026-08-27",
    startTime: "10:30:00",
    endTime: "11:30:00",
    meetUrl: "https://meet.google.com/abc-defg-hij",
  });
  assert.match(subject, /jueves 27 de agosto de 2026/);
  assert.match(subject, /de 10:30 a 11:30/);
  assert.match(text, /https:\/\/meet\.google\.com\/abc-defg-hij/);
});

test("sin enlace, el correo lo DICE en vez de dejar un botón muerto", () => {
  const { html } = invitacionEventoTemplate({
    tenantName: "Aumenta",
    titulo: "Reunión de equipo",
    startDate: "2026-09-01",
    allDay: true,
  });
  assert.match(html, /no lleva enlace de videollamada/i);
  assert.ok(!/Entrar a la videollamada/.test(html));
});

test("las notas del evento no pueden colar HTML en el correo", () => {
  const { html } = invitacionEventoTemplate({
    tenantName: "Aumenta",
    titulo: "Coordinación",
    startDate: "2026-09-01",
    notas: '<script>alert(1)</script>',
  });
  assert.ok(!/<script>/.test(html));
  assert.match(html, /&lt;script&gt;/);
});
