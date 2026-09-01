// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-resultado-cita.mjs — cómo acabó una cita (01/09/2026).
 *
 * Fija `lib/citas/resultadoCita.js`, que es lo que comparten las DOS pantallas
 * donde ahora se pone el resultado: la ficha de la cita en la Agenda y las
 * citas de la ficha del paciente.
 *
 * Lo que de verdad se rompería sin esto:
 *
 *   · **`noShowJustified` omitido.** El endpoint lo lee como
 *     `body.noShowJustified === true`, así que una pantalla que se lo deje
 *     manda «falta SIN justificar» sin decirlo — y esa abre incidencia, avisa a
 *     administración y no se recupera. Aquí se fija que el cuerpo de las dos
 *     faltas lo lleva SIEMPRE, y con el valor que toca.
 *   · **El motivo en blanco.** Una cadena vacía en la base es «motivo puesto y
 *     vacío», que no es lo mismo que no haber puesto ninguno: tiene que ir null.
 *   · **La presunción de asistencia.** Una confirmada que ya pasó cuenta como
 *     completada (asistencia.js, 01/09/2026); si esto se pierde, la ficha del
 *     paciente enseñaría «Confirmada» en citas de hace tres meses.
 *
 *   node scripts/_smoke-resultado-cita.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  RESULTADOS_CITA,
  admiteResultado,
  cuerpoDelResultado,
  etiquetaResultado,
  resultadoDeCita,
  resultadoPorClave,
} from "../lib/citas/resultadoCita.js";

const AYER = new Date("2026-08-31T10:00:00.000Z");
const AHORA = new Date("2026-09-01T12:00:00.000Z");
const MANANA = new Date("2026-09-02T10:00:00.000Z");
const cita = (extra) => ({ id: "b1", scheduledAt: AYER.toISOString(), duration: 60, status: "confirmed", ...extra });

test("los cuatro resultados, y cada uno con su clave", () => {
  assert.deepEqual(
    RESULTADOS_CITA.map((r) => r.clave),
    ["completada", "falta_justificada", "falta_injustificada", "cancelada"]
  );
  assert.equal(resultadoPorClave("falta_justificada").label, "Falta justificada");
  assert.equal(resultadoPorClave("falta_injustificada").label, "Falta injustificada");
  assert.equal(resultadoPorClave("no_existe"), null);
});

test("una falta NUNCA sale sin decir si está justificada", () => {
  assert.deepEqual(cuerpoDelResultado("falta_justificada"), {
    status: "no_show",
    noShowJustified: true,
    noShowReason: null,
  });
  assert.deepEqual(cuerpoDelResultado("falta_injustificada"), {
    status: "no_show",
    noShowJustified: false,
    noShowReason: null,
  });
});

test("el motivo en blanco viaja como null, no como cadena vacía", () => {
  assert.equal(cuerpoDelResultado("falta_justificada", "   ").noShowReason, null);
  assert.equal(cuerpoDelResultado("falta_justificada", " fiebre ").noShowReason, "fiebre");
  assert.equal(cuerpoDelResultado("cancelada", "").cancellationReason, null);
  assert.equal(cuerpoDelResultado("cancelada", "se va de viaje").cancellationReason, "se va de viaje");
});

test("completada no arrastra motivo ni banderas de falta", () => {
  assert.deepEqual(cuerpoDelResultado("completada", "lo que sea"), { status: "completed" });
  assert.equal(cuerpoDelResultado("inventada"), null);
});

test("en qué resultado está una cita", () => {
  assert.equal(resultadoDeCita(cita({ status: "completed" }), AHORA), "completada");
  assert.equal(resultadoDeCita(cita({ status: "cancelled" }), AHORA), "cancelada");
  assert.equal(
    resultadoDeCita(cita({ status: "no_show", noShowJustified: true }), AHORA),
    "falta_justificada"
  );
  assert.equal(
    resultadoDeCita(cita({ status: "no_show", noShowJustified: false }), AHORA),
    "falta_injustificada"
  );
  // La presunción: confirmada que ya terminó = completada, sin tocar la base.
  assert.equal(resultadoDeCita(cita({ status: "confirmed" }), AHORA), "completada");
  // La de mañana todavía no tiene resultado, tiene estado.
  assert.equal(resultadoDeCita(cita({ scheduledAt: MANANA.toISOString() }), AHORA), null);
});

test("el rótulo distingue lo comprobado de lo supuesto", () => {
  assert.equal(etiquetaResultado(cita({ status: "completed" }), AHORA), "Completada");
  assert.equal(etiquetaResultado(cita({ status: "confirmed" }), AHORA), "Se da por asistida");
  assert.equal(
    etiquetaResultado(cita({ scheduledAt: MANANA.toISOString(), status: "confirmed" }), AHORA),
    "Confirmada"
  );
  assert.equal(etiquetaResultado(cita({ status: "pending", scheduledAt: MANANA.toISOString() }), AHORA), "Pendiente");
  assert.match(etiquetaResultado(cita({ status: "no_show", noShowJustified: true }), AHORA), /^Falta justificada/);
  assert.match(etiquetaResultado(cita({ status: "no_show", noShowJustified: false }), AHORA), /^Falta injustificada/);
});

test("los botones solo salen en citas que ya han empezado, y nunca en una cancelada", () => {
  assert.equal(admiteResultado(cita({}), AHORA), true);
  assert.equal(admiteResultado(cita({ scheduledAt: MANANA.toISOString() }), AHORA), false);
  assert.equal(admiteResultado(cita({ status: "cancelled" }), AHORA), false);
  assert.equal(admiteResultado(cita({ scheduledAt: null }), AHORA), false);
  assert.equal(admiteResultado(null, AHORA), false);
});
