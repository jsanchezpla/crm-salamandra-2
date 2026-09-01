// @prueba ligera — función pura de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-sesion-de-la-cita.mjs — UNA CITA, UN REGISTRO (01/09/2026).
 *
 *   node scripts/_smoke-sesion-de-la-cita.mjs
 *   node --test-name-pattern="adopta" scripts/_smoke-sesion-de-la-cita.mjs
 *
 * ── DE QUÉ QUEJA REAL NACE ─────────────────────────────────────────────────
 *
 * Rodrigo, 01/09/2026: «entro al modal de la cita, le doy a preparar sesión y
 * la empieza a trabajar; si me salgo y vuelvo a entrar a la misma cita, en
 * lugar de abrirse el mismo registro se me abre uno completamente nuevo y
 * tengo que ir a buscar el que estaba editando por la pestaña de sesiones».
 *
 * Y era exactamente así: el enlace del modal llevaba paciente y FECHA, nada que
 * dijera de qué cita era la sesión, así que cada vuelta abría un formulario en
 * blanco y guardarlo dejaba una sesión más en la historia clínica.
 *
 * ── LO QUE SE FIJA AQUÍ, Y POR QUÉ ES LO PELIGROSO ─────────────────────────
 *
 * `sesionDeLaCita` decide EN QUÉ NOTA CLÍNICA se va a escribir. Los dos fallos
 * posibles no se parecen en nada:
 *
 *   · **No encontrarla** → una sesión duplicada. Se ve, molesta y se arregla.
 *   · **Encontrar la que no es** → se escribe encima del registro de OTRO día
 *     o de OTRA cita, firmado por una colegiada. Eso no se ve.
 *
 * Por eso la regla del segundo camino —el que adopta las sesiones preparadas
 * antes de que existiera `bookingId`— es tan estrecha: hora EXACTA, una sola
 * candidata, nunca una que ya sea de otra cita, nunca una de taller. Ante
 * cualquier duda, `null`: mejor duplicar que pisar.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sesionDeLaCita } from "../lib/clinica/prepararSesion.js";

const HORA = "2026-09-03T17:00:00.000Z";
const OTRA_HORA = "2026-09-03T18:00:00.000Z";
const sesion = (extra) => ({ id: "s", bookingId: null, tallerSesionId: null, sessionDate: HORA, ...extra });

describe("por la cita — el camino bueno", () => {
  it("devuelve la sesión apuntada a esa cita", () => {
    const r = sesionDeLaCita([sesion({ id: "s1", bookingId: "b1" })], { bookingId: "b1" });
    assert.equal(r.sesion.id, "s1");
    assert.equal(r.via, "cita");
  });

  it("no se lleva la de otra cita aunque sea del mismo día y hora", () => {
    // Dos citas seguidas del mismo paciente existen: si la hora mandara sobre
    // el id, se escribiría en el registro de la otra.
    const r = sesionDeLaCita([sesion({ id: "s1", bookingId: "b2" })], { bookingId: "b1", scheduledAt: HORA });
    assert.equal(r, null);
  });

  it("con dos apuntadas a la misma cita gana la última tocada", () => {
    // Puede pasar con una adopción a mano o con dos pestañas a la vez. El
    // índice no es único a propósito: mejor elegir que un 500 en la agenda.
    const r = sesionDeLaCita(
      [
        sesion({ id: "vieja", bookingId: "b1", updatedAt: "2026-09-01T10:00:00.000Z" }),
        sesion({ id: "nueva", bookingId: "b1", updatedAt: "2026-09-02T10:00:00.000Z" }),
      ],
      { bookingId: "b1" }
    );
    assert.equal(r.sesion.id, "nueva");
  });
});

describe("por la hora — solo para ADOPTAR lo escrito antes del 01/09", () => {
  it("adopta la sesión suelta que cae en la hora exacta de la cita", () => {
    const r = sesionDeLaCita([sesion({ id: "s1" })], { bookingId: "b1", scheduledAt: HORA });
    assert.equal(r.sesion.id, "s1");
    // El `via` no es adorno: quien llama le pone el `bookingId` SOLO cuando
    // viene por aquí. Si dijera "cita", la sesión no se adoptaría nunca y el
    // rodeo por la hora se repetiría en cada visita.
    assert.equal(r.via, "fecha");
  });

  it("una hora distinta NO se adopta, ni por un minuto", () => {
    assert.equal(sesionDeLaCita([sesion({ sessionDate: OTRA_HORA })], { bookingId: "b1", scheduledAt: HORA }), null);
    assert.equal(
      sesionDeLaCita([sesion({ sessionDate: "2026-09-03T17:01:00.000Z" })], { bookingId: "b1", scheduledAt: HORA }),
      null
    );
  });

  it("dos sesiones a la misma hora exacta: ninguna", () => {
    // Empate que no se puede deshacer sin adivinar. Crear una nueva se ve;
    // escribir en la equivocada, no.
    const r = sesionDeLaCita([sesion({ id: "a" }), sesion({ id: "b" })], { bookingId: "b1", scheduledAt: HORA });
    assert.equal(r, null);
  });

  it("nunca se adopta la que ya es de otra cita", () => {
    const r = sesionDeLaCita([sesion({ id: "s1", bookingId: "b9" })], { bookingId: "b1", scheduledAt: HORA });
    assert.equal(r, null);
  });

  it("nunca se adopta una sesión de TALLER", () => {
    // Su cuerpo lo escribe quien da el taller y se copia a los asistentes:
    // editarla desde la cita de uno solo se perdería en la propagación
    // siguiente, sin decir nada.
    const r = sesionDeLaCita([sesion({ id: "s1", tallerSesionId: "t1" })], { bookingId: "b1", scheduledAt: HORA });
    assert.equal(r, null);
  });

  it("sin hora de la cita no se adopta nada", () => {
    assert.equal(sesionDeLaCita([sesion({ id: "s1" })], { bookingId: "b1" }), null);
    assert.equal(sesionDeLaCita([sesion({ id: "s1" })], { bookingId: "b1", scheduledAt: "el jueves" }), null);
  });
});

describe("lo que no puede romper la pantalla", () => {
  it("una lista vacía, nula o rara devuelve null y no revienta", () => {
    for (const mala of [[], null, undefined, "sesiones", 7]) {
      assert.equal(sesionDeLaCita(mala, { bookingId: "b1", scheduledAt: HORA }), null, `${mala}`);
    }
  });

  it("sin cita no se devuelve nada, aunque la hora cuadre", () => {
    // Se llega aquí desde la ficha del paciente («Nuevo registro»), que no
    // viene de ninguna cita: ahí lo correcto es empezar una sesión nueva.
    assert.equal(sesionDeLaCita([sesion({ id: "s1" })], { scheduledAt: HORA }), null);
    assert.equal(sesionDeLaCita([sesion({ id: "s1" })], {}), null);
    assert.equal(sesionDeLaCita([sesion({ id: "s1" })]), null);
  });

  it("una sesión con la fecha rota se ignora en vez de casar por casualidad", () => {
    const r = sesionDeLaCita([sesion({ id: "s1", sessionDate: null })], { bookingId: "b1", scheduledAt: HORA });
    assert.equal(r, null);
  });
});
