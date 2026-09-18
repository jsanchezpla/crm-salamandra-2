// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-duracion-sesion.mjs — una sesión no se inventa cuánto duró
 * (18/09/2026, Aumenta).
 *
 *   node scripts/_smoke-duracion-sesion.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Olga: «aparece duración 45 min en la ficha de paciente cuando la mayoría de
 * sus sesiones son de 60 min». El 45 no salía de ningún cálculo: el volcado de
 * Organízate lo escribió a fuego en las 22.996 sesiones que trajo, porque
 * Organízate no guarda ese dato. Y el CRM lo pintaba en la ficha y lo imprimía
 * en el PDF del registro como si fuera una medida.
 *
 * Esta prueba fija las tres cosas que tienen que seguir siendo verdad:
 *   · manda lo que escribe la terapeuta;
 *   · si no lo escribe, se hereda de la CITA (que sí lo sabe);
 *   · y si no hay ninguna de las dos, **null** — nunca un número por defecto.
 *
 * El tercer caso es el que importa: el día que alguien vuelva a poner un «?? 45»
 * para que la ficha no enseñe una raya, esta prueba se pone roja.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { duracionDeLaSesion, minutosDeSesion } from "../lib/clinica/duracionDeLaSesion.js";

test("minutosDeSesion acepta minutos con sentido y tira el resto", () => {
  assert.equal(minutosDeSesion(60), 60);
  assert.equal(minutosDeSesion("45"), 45);
  assert.equal(minutosDeSesion(1), 1);
  assert.equal(minutosDeSesion(480), 480);

  assert.equal(minutosDeSesion(0), null, "una sesión de 0 minutos no existe");
  assert.equal(minutosDeSesion(-30), null);
  assert.equal(minutosDeSesion(481), null, "el tope es el de Booking/EventType");
  assert.equal(minutosDeSesion(45.5), null, "minutos partidos, no");
  assert.equal(minutosDeSesion("una hora"), null);
  assert.equal(minutosDeSesion(""), null);
  assert.equal(minutosDeSesion(null), null);
  assert.equal(minutosDeSesion(undefined), null);
});

test("manda lo que escribe la terapeuta, aunque la cita diga otra cosa", () => {
  assert.equal(duracionDeLaSesion({ pedida: 90, cita: { duration: 45 } }), 90);
  assert.equal(duracionDeLaSesion({ pedida: "30", cita: { duration: 60 } }), 30);
});

test("sin escribirla, se hereda la de la cita", () => {
  assert.equal(duracionDeLaSesion({ pedida: null, cita: { duration: 60 } }), 60);
  assert.equal(duracionDeLaSesion({ pedida: "", cita: { duration: 45 } }), 45);
  assert.equal(
    duracionDeLaSesion({ pedida: "cualquier cosa", cita: { duration: 60 } }),
    60,
    "un valor imposible en el cuerpo no gana a la cita",
  );
});

test("sin dato por ninguna parte, null — y NUNCA un número por defecto", () => {
  assert.equal(duracionDeLaSesion({}), null);
  assert.equal(duracionDeLaSesion({ pedida: null, cita: null }), null);
  assert.equal(duracionDeLaSesion({ pedida: "", cita: {} }), null, "cita sin duración no la inventa");
  assert.equal(duracionDeLaSesion({ cita: { duration: 0 } }), null);
});
