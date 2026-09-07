// @prueba ligera — función pura de /lib y una regex sobre el fuente; sin base, sin servidor, sin .env.
/**
 * _smoke-firma-por-defecto.mjs — quién firma un registro de sesión nuevo si
 * nadie toca el desplegable (07/09/2026, AV-0060 de Aumenta: «que salga la
 * persona correcta de manera automática»).
 *
 *   node scripts/_smoke-firma-por-defecto.mjs
 *
 * La regla vive en `lib/clinica/firmaPorDefecto.js`: cita → quien escribe →
 * terapeuta de referencia → nadie. Y el POST de sesiones firma con quien
 * escribe cuando no llega firma (antes: 400 «therapistId es obligatorio»).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { terapeutaPorDefecto } from "../lib/clinica/firmaPorDefecto.js";

const EQUIPO = [{ id: "tm-logo" }, { id: "tm-psico" }];

describe("terapeutaPorDefecto", () => {
  it("la cita manda: quien dio la sesión la firma", () => {
    assert.equal(terapeutaPorDefecto({ profDeLaCita: "tm-psico", yo: "tm-logo", equipo: EQUIPO, mainTherapistId: "tm-logo" }), "tm-psico");
  });
  it("sin cita, firma quien escribe, aunque el de referencia sea otra (paciente compartido)", () => {
    assert.equal(terapeutaPorDefecto({ profDeLaCita: null, yo: "tm-logo", equipo: EQUIPO, mainTherapistId: "tm-psico" }), "tm-logo");
  });
  it("sin ficha de equipo de quien escribe, el de referencia", () => {
    assert.equal(terapeutaPorDefecto({ yo: null, equipo: EQUIPO, mainTherapistId: "tm-psico" }), "tm-psico");
  });
  it("un profesional de la cita que no es del centro se ignora", () => {
    assert.equal(terapeutaPorDefecto({ profDeLaCita: "tm-ajeno", yo: "tm-logo", equipo: EQUIPO }), "tm-logo");
  });
  it("sin nada, cadena vacía: que lo elija", () => {
    assert.equal(terapeutaPorDefecto({}), "");
    assert.equal(terapeutaPorDefecto({ equipo: [] }), "");
  });
});

describe("POST /api/clinica/sessions", () => {
  it("firma con quien escribe si no llega firma, y comprueba que es del centro", () => {
    const src = readFileSync(new URL("../app/api/clinica/sessions/route.js", import.meta.url), "utf8");
    assert.match(src, /resolveCurrentTeamMemberId\(request, ctx\.tenantModels\)/);
    assert.match(src, /Ese profesional no es del centro/);
  });
});
