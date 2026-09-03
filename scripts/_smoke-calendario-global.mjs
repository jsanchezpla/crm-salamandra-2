// @prueba ligera
/**
 * _smoke-calendario-global.mjs — lo que del calendario global se puede
 * comprobar sin base de datos (03/09/2026).
 *
 *   node --test scripts/_smoke-calendario-global.mjs
 *
 * Tres cosas, que son las tres que un despiste rompería en silencio:
 *   1. el reparto por host (`CALENDAR_HOST`) normaliza igual que el del
 *      back-office: mayúsculas, espacios y puerto no cambian la decisión;
 *   2. `etiquetar` marca cada evento con su calendario y pone el slug delante
 *      del id (FullCalendar exige ids únicos entre tenants);
 *   3. el pase de salto: un token que no es un pase, o que caducó, no se
 *      canjea (sin tocar la base: se rechaza ANTES de buscar la cuenta).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignJWT } from "jose";

process.env.JWT_SECRET ??= "secreto-de-prueba";

const { hostCalendario, esPeticionDeCalendario } = await import("../lib/auth/backoffice.js");
const { etiquetar } = await import("../lib/calendario-global/eventos.js");
const { canjearSalto } = await import("../lib/calendario-global/salto.js");

const peticion = (host) => ({ headers: { get: (k) => (k === "host" ? host : null) } });

describe("reparto por host del calendario global", () => {
  it("sin CALENDAR_HOST no hay host de calendario", () => {
    delete process.env.CALENDAR_HOST;
    assert.equal(hostCalendario(), "");
    assert.equal(esPeticionDeCalendario(peticion("calendar.salamandrasolutions.com")), false);
  });

  it("normaliza mayúsculas, espacios y puerto, como el back-office", () => {
    process.env.CALENDAR_HOST = " Calendar.SalamandraSolutions.com:443 ";
    assert.equal(hostCalendario(), "calendar.salamandrasolutions.com");
    assert.equal(esPeticionDeCalendario(peticion("calendar.salamandrasolutions.com")), true);
    assert.equal(esPeticionDeCalendario(peticion("CALENDAR.salamandrasolutions.com:8443")), true);
    assert.equal(esPeticionDeCalendario(peticion("crm.salamandrasolutions.com")), false);
    assert.equal(esPeticionDeCalendario(peticion("admin.salamandrasolutions.com")), false);
  });
});

describe("etiquetar: cada evento sabe de qué calendario es", () => {
  const vinculo = { slug: "aumenta", nombre: "Aumenta", color: "#FF1F96" };
  const ev = {
    id: "6dd41253-4036-4b88-b9b0-660ed50ec442",
    title: "Reunión",
    backgroundColor: "#f97316",
    borderColor: "#f97316",
    extendedProps: { status: "pending", colorPrioridad: "#f97316" },
  };
  const out = etiquetar(ev, vinculo);

  it("el id lleva el slug delante y el de verdad viaja en taskId", () => {
    assert.equal(out.id, "aumenta:6dd41253-4036-4b88-b9b0-660ed50ec442");
    assert.equal(out.extendedProps.taskId, ev.id);
  });

  it("se pinta del color del calendario y conserva el de prioridad para poder cambiar", () => {
    assert.equal(out.backgroundColor, "#FF1F96");
    assert.equal(out.borderColor, "#FF1F96");
    assert.equal(out.extendedProps.colorPrioridad, "#f97316");
    assert.deepEqual(out.extendedProps.calendario, vinculo);
  });

  it("no toca el evento original", () => {
    assert.equal(ev.id, "6dd41253-4036-4b88-b9b0-660ed50ec442");
    assert.equal(ev.extendedProps.taskId, undefined);
  });
});

describe("el pase de salto se rechaza antes de tocar la base", () => {
  it("nada, basura o un token de otro secreto → pase inválido", async () => {
    await assert.rejects(() => canjearSalto(null), /inválido/);
    await assert.rejects(() => canjearSalto("no-es-un-jwt"), /inválido/);
    const ajeno = await new SignJWT({ p: "calendario-global:salto", slug: "demo" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("a25a9846-09ed-41e1-ab74-72d5a1c0684e")
      .setJti("x")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode("otro-secreto"));
    await assert.rejects(() => canjearSalto(ajeno), /inválido/);
  });

  it("un pase con el propósito equivocado, aunque esté bien firmado, no vale", async () => {
    const secreto = new TextEncoder().encode(process.env.JWT_SECRET + "_salto");
    const raro = await new SignJWT({ p: "otra-cosa", slug: "demo" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("a25a9846-09ed-41e1-ab74-72d5a1c0684e")
      .setJti("y")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(secreto);
    await assert.rejects(() => canjearSalto(raro), /inválido/);
  });

  it("un pase caducado no vale, y lo dice como caducado", async () => {
    const secreto = new TextEncoder().encode(process.env.JWT_SECRET + "_salto");
    const viejo = await new SignJWT({ p: "calendario-global:salto", slug: "demo" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("a25a9846-09ed-41e1-ab74-72d5a1c0684e")
      .setJti("z")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 540)
      .sign(secreto);
    await assert.rejects(() => canjearSalto(viejo), /caducado/);
  });
});
