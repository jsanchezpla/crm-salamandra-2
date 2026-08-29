// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-calendario-google.mjs — el Calendario se espeja en Google (29/08/2026).
 *
 *   node scripts/_smoke-calendario-google.mjs
 *   node --test-name-pattern="eventoDesdeTarea" scripts/_smoke-calendario-google.mjs
 *
 * Fija lo que DEVUELVE la traducción tarea→evento de Google —los dos fallos
 * clásicos de calendario: el fin exclusivo de los eventos de día entero y la
 * fecha desplazada por la zona horaria—, la URL de autorización (el scope
 * mínimo `calendar.app.created` y el `prompt=consent` que garantiza el
 * refresh_token) y la lectura de la configuración BYOK del tenant.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_SCOPES,
  ZONA_HORARIA,
  emailDeIdToken,
  eventoDesdeTarea,
  getTenantGoogleCalendarConfig,
  googleCalendarDisponible,
  urlAutorizacion,
} from "../lib/calendar/googleCalendar.js";

describe("eventoDesdeTarea", () => {
  it("día entero de UN día: el fin de Google es EXCLUSIVO (día siguiente)", () => {
    const ev = eventoDesdeTarea({ title: "Cierre", allDay: true, startDate: "2026-08-31", endDate: null });
    assert.deepEqual(ev.start, { date: "2026-08-31" });
    assert.deepEqual(ev.end, { date: "2026-09-01" });
  });

  it("día entero de VARIOS días conserva el rango (fin exclusivo)", () => {
    const ev = eventoDesdeTarea({ title: "Feria", allDay: true, startDate: "2026-08-28", endDate: "2026-08-30" });
    assert.deepEqual(ev.end, { date: "2026-08-31" });
  });

  it("el cambio de mes no se desplaza por la zona horaria (el bug del 26/08)", () => {
    // "2026-08-31" + 1 con `new Date(iso)` en según qué zona daría el 31 otra vez.
    const ev = eventoDesdeTarea({ title: "x", allDay: true, startDate: "2026-12-31", endDate: null });
    assert.deepEqual(ev.end, { date: "2027-01-01" });
  });

  it("sin hora de inicio (aunque no sea «todo el día») va como evento de día", () => {
    const ev = eventoDesdeTarea({ title: "x", allDay: false, startDate: "2026-09-01", startTime: null });
    assert.deepEqual(ev.start, { date: "2026-09-01" });
  });

  it("con horas de inicio y fin, dateTime con la zona de España", () => {
    const ev = eventoDesdeTarea({
      title: "Reunión", allDay: false,
      startDate: "2026-09-03", startTime: "10:30:00", endDate: null, endTime: "11:30:00",
    });
    assert.deepEqual(ev.start, { dateTime: "2026-09-03T10:30:00", timeZone: ZONA_HORARIA });
    assert.deepEqual(ev.end, { dateTime: "2026-09-03T11:30:00", timeZone: ZONA_HORARIA });
  });

  it("sin hora de fin dura una hora", () => {
    const ev = eventoDesdeTarea({ title: "x", allDay: false, startDate: "2026-09-03", startTime: "10:30" });
    assert.equal(ev.end.dateTime, "2026-09-03T11:30:00");
  });

  it("a las 23:30 sin fin, la hora extra cae en el día siguiente", () => {
    const ev = eventoDesdeTarea({ title: "x", allDay: false, startDate: "2026-09-03", startTime: "23:30" });
    assert.equal(ev.end.dateTime, "2026-09-04T00:30:00");
  });

  it("un fin ANTERIOR al inicio no se manda tal cual (Google lo rechazaría): cae a una hora", () => {
    const ev = eventoDesdeTarea({
      title: "x", allDay: false,
      startDate: "2026-09-03", startTime: "10:00", endDate: null, endTime: "09:00",
    });
    assert.equal(ev.end.dateTime, "2026-09-03T11:00:00");
  });

  it("las notas y la videollamada van juntas en la descripción", () => {
    const ev = eventoDesdeTarea({
      title: "x", allDay: true, startDate: "2026-09-03",
      notes: "Llevar el informe", meetUrl: "https://meet.google.com/abc",
    });
    assert.ok(ev.description.includes("Llevar el informe"));
    assert.ok(ev.description.includes("https://meet.google.com/abc"));
  });
});

describe("urlAutorizacion", () => {
  const url = new URL(urlAutorizacion({ clientId: "id-123", redirectUri: "https://crm.example/api/calendar/google/callback", state: "nonce-1" }));

  it("pide el scope MÍNIMO: calendar.app.created, nunca el calendario entero", () => {
    assert.ok(url.searchParams.get("scope").includes("calendar.app.created"));
    assert.equal(url.searchParams.get("scope"), GOOGLE_SCOPES);
    // El scope amplio daría acceso a la agenda personal: si alguien lo cambia,
    // que esta prueba le pregunte por qué.
    assert.ok(!GOOGLE_SCOPES.split(" ").includes("https://www.googleapis.com/auth/calendar"));
  });

  it("offline + consent: sin los dos no hay refresh_token al reconectar", () => {
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
  });

  it("lleva client_id, redirect_uri y state tal cual", () => {
    assert.equal(url.searchParams.get("client_id"), "id-123");
    assert.equal(url.searchParams.get("redirect_uri"), "https://crm.example/api/calendar/google/callback");
    assert.equal(url.searchParams.get("state"), "nonce-1");
  });
});

describe("emailDeIdToken", () => {
  it("saca el email del cuerpo del id_token", () => {
    const cuerpo = Buffer.from(JSON.stringify({ email: "marta@ejemplo.com" })).toString("base64url");
    assert.equal(emailDeIdToken(`cab.${cuerpo}.firma`), "marta@ejemplo.com");
  });
  it("con basura devuelve null, nunca lanza", () => {
    assert.equal(emailDeIdToken("no-es-un-jwt"), null);
    assert.equal(emailDeIdToken(null), null);
  });
});

describe("getTenantGoogleCalendarConfig", () => {
  const ctxCon = (integrations) => ({ tenant: { settings: { integrations } } });

  it("con las dos piezas, configurado", () => {
    const c = getTenantGoogleCalendarConfig(ctxCon({ googleCalendarClientId: "abc", googleCalendarClientSecret: "GOCSPX-x" }));
    assert.equal(c.configured, true);
    assert.equal(c.clientId, "abc");
  });
  it("sin el secreto (o sin nada), NO configurado", () => {
    assert.equal(getTenantGoogleCalendarConfig(ctxCon({ googleCalendarClientId: "abc" })).configured, false);
    assert.equal(getTenantGoogleCalendarConfig({}).configured, false);
  });
});

describe("googleCalendarDisponible", () => {
  const ctxCon = (modulos) => ({ hasModule: (k) => modulos.includes(k) });

  it("exige Calendario Y Equipo (básico): con uno solo no hay función", () => {
    assert.equal(googleCalendarDisponible(ctxCon(["calendar", "team"])), true);
    assert.equal(googleCalendarDisponible(ctxCon(["calendar"])), false);
    assert.equal(googleCalendarDisponible(ctxCon(["team"])), false);
    assert.equal(googleCalendarDisponible({}), false);
  });
});
