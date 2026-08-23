// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clients-comunicaciones-transaccionales.mjs — los cinco correos que no
 * preguntan por las casillas (20/08/2026).
 *
 *   node scripts/_smoke-clients-comunicaciones-transaccionales.mjs
 *   node --test-name-pattern="motivo" scripts/_smoke-clients-comunicaciones-transaccionales.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `lib/clients/comunicaciones.js` es la única regla de «¿le puedo escribir por
 * aquí?», y hasta hoy cinco correos se la saltaban por OMISIÓN: nadie decidió
 * que fueran distintos, simplemente no se puso la comprobación. Desde fuera,
 * eso es indistinguible de un olvido.
 *
 * Jorge lo cierra el 20/08/2026: los cinco son transaccionales —responden a un
 * acto de la propia persona— y salen siempre. `CORREOS_TRANSACCIONALES` es esa
 * decisión escrita y `esCorreoTransaccional` la puerta que consultan los cinco
 * puntos de envío. Esta prueba sujeta las tres cosas que pueden torcerse solas:
 * que la lista siga siendo esos cinco con su motivo, que nadie declare
 * transaccional un correo que sí pregunta (el recordatorio), y que la lista no
 * se llene de nombres repetidos ni de motivos en blanco al ir creciendo.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CORREOS_TRANSACCIONALES,
  esCorreoTransaccional,
} from "../lib/clients/comunicaciones.js";

/** Los cinco de la decisión, por si alguien añade o quita sin querer. */
const LOS_CINCO = [
  "bookingCancelled",
  "bookingRejected",
  "pedirTarjeta",
  "solicitudAceptada",
  "bookingReceived",
];

describe("la lista declarada: cinco correos, uno a uno", () => {
  it("son la cancelación, el rechazo, la petición de tarjeta, la solicitud aceptada y el acuse de la reserva pagada", () => {
    assert.deepEqual(
      CORREOS_TRANSACCIONALES.map((c) => c.plantilla),
      LOS_CINCO
    );
  });

  it("cada uno dice POR QUÉ no pregunta, dónde se manda y desde cuándo", () => {
    for (const correo of CORREOS_TRANSACCIONALES) {
      assert.equal(typeof correo.motivo, "string", `${correo.plantilla} sin motivo`);
      assert.ok(correo.motivo.trim().length > 20, `${correo.plantilla}: el motivo no explica nada`);
      assert.ok(correo.donde.trim().length > 0, `${correo.plantilla} sin punto de envío`);
      assert.ok(correo.desde.trim().length > 0, `${correo.plantilla} sin fecha de la decisión`);
    }
  });

  it("ninguna plantilla aparece dos veces (dos motivos para el mismo correo serían dos decisiones)", () => {
    const nombres = CORREOS_TRANSACCIONALES.map((c) => c.plantilla);
    assert.equal(new Set(nombres).size, nombres.length);
  });
});

describe("esCorreoTransaccional: quién se salta las casillas", () => {
  it("los cinco declarados, sí", () => {
    for (const plantilla of LOS_CINCO) {
      assert.equal(esCorreoTransaccional(plantilla), true, plantilla);
    }
  });

  it("el recordatorio NO: lo genera el centro por su cuenta y respeta la casilla", () => {
    assert.equal(esCorreoTransaccional("bookingReminder"), false);
  });

  it("tampoco el cambio de hora, la videollamada ni la confirmación", () => {
    assert.equal(esCorreoTransaccional("bookingRescheduled"), false);
    assert.equal(esCorreoTransaccional("bookingMeetLink"), false);
    assert.equal(esCorreoTransaccional("bookingConfirmed"), false);
  });

  it("un nombre que no existe no se cuela, ni siquiera por parecerse", () => {
    assert.equal(esCorreoTransaccional("bookingCancelledTemplate"), false);
    assert.equal(esCorreoTransaccional("bookingcancelled"), false);
    assert.equal(esCorreoTransaccional(""), false);
    assert.equal(esCorreoTransaccional(undefined), false);
    assert.equal(esCorreoTransaccional(null), false);
  });

  it("una propiedad heredada de Object tampoco cuenta como declarada", () => {
    assert.equal(esCorreoTransaccional("toString"), false);
    assert.equal(esCorreoTransaccional("constructor"), false);
  });
});
