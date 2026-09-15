// @prueba ligera
// Pinchar una notificación lleva a su contenido (15/09/2026, Rodrigo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { notificationLink, serializeNotification } from "../lib/notifications/alerts.js";

test("una cita abre su ficha en la agenda", () => {
  assert.equal(notificationLink("Booking", "b-1"), "/citas?cita=b-1");
  assert.equal(notificationLink("Booking"), "/citas");
});

test("ficha, leads, formularios, permisos de IA y contraseña llevan a su pantalla", () => {
  assert.equal(notificationLink("Client", "c-1"), "/clientes/c-1");
  assert.equal(notificationLink("Lead", "l-1"), "/leads");
  assert.equal(notificationLink("FormSubmission", "f-1"), "/formularios");
  assert.equal(notificationLink("AiPermission"), "/configuracion?zona=modulos");
  assert.equal(notificationLink("User", "u-1"), "/equipo");
});

test("el aviso de la cuenta de IA, sin entidad, va por su tipo", () => {
  assert.equal(notificationLink(null, null, "ai_cuenta"), "/configuracion?zona=conexiones");
  assert.equal(serializeNotification({ id: 1, type: "ai_cuenta", title: "x", entityType: null }).link, "/configuracion?zona=conexiones");
  assert.equal(notificationLink(null, null, "otro"), null);
});

test("la agenda lee ?cita= y abre la ficha", () => {
  const agenda = readFileSync(new URL("../modules/default/CitasModule.jsx", import.meta.url), "utf8");
  assert.match(agenda, /searchParams\.get\("cita"\)/);
});
