// @prueba ligera
/**
 * _smoke-citas-asistencia.mjs — una cita que ya terminó y que nadie marcó se
 * da por asistida (01/09/2026, Aumenta por Rodrigo).
 *
 * Lo que se fija aquí:
 *
 *   1. La presunción SOLO toca a `confirmed`. Una petición `pending` que se
 *      pasó de hora no es una asistencia: es una cita que el centro nunca
 *      aceptó. Y `cancelled` / `no_show` son decisiones tomadas.
 *   2. Se presume cuando la cita ha TERMINADO, no cuando ha empezado: dentro de
 *      su hora todavía no se sabe.
 *   3. `esPresunta` distingue lo supuesto de lo comprobado. Es lo que permite
 *      que la ficha diga «se da por asistida» en vez de mentir con un
 *      «Completada» que nadie pulsó — y que marcar la falta siga leyéndose como
 *      una corrección y no como un cambio de opinión.
 *   4. Nada de esto escribe: son funciones puras sobre la fila que llega.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  cuentaComoAtendida,
  esPresunta,
  estadoEfectivo,
  finDeLaCita,
  yaTermino,
} from "../lib/citas/asistencia.js";

// Reloj fijo: la prueba no puede depender de la hora a la que se lance.
const AHORA = new Date("2026-09-01T12:00:00.000Z");

/** Una cita de 60 minutos que empezó hace `horas` horas. */
function citaHace(horas, status = "confirmed", extra = {}) {
  return {
    id: `c-${horas}-${status}`,
    status,
    scheduledAt: new Date(AHORA.getTime() - horas * 3_600_000).toISOString(),
    duration: 60,
    ...extra,
  };
}

test("finDeLaCita suma la duración al inicio, y aguanta lo que llega roto", () => {
  const fin = finDeLaCita({ scheduledAt: "2026-09-01T10:00:00.000Z", duration: 45 });
  assert.equal(fin.toISOString(), "2026-09-01T10:45:00.000Z");

  // Sin duración usable se supone una hora: es la duración corriente de una
  // sesión y el error posible es de minutos, no de días.
  for (const dur of [null, undefined, 0, -30, "sesenta", NaN]) {
    const f = finDeLaCita({ scheduledAt: "2026-09-01T10:00:00.000Z", duration: dur });
    assert.equal(f.toISOString(), "2026-09-01T11:00:00.000Z", `duración ${dur}`);
  }

  // Sin fecha no hay nada que calcular, y no puede reventar.
  assert.equal(finDeLaCita(null), null);
  assert.equal(finDeLaCita({}), null);
  assert.equal(finDeLaCita({ scheduledAt: "no soy una fecha" }), null);
});

test("solo se da por asistida cuando la cita ha TERMINADO", () => {
  // Empezada pero sin acabar: dentro de su hora todavía no se sabe.
  const enCurso = { status: "confirmed", scheduledAt: "2026-09-01T11:30:00.000Z", duration: 60 };
  assert.equal(yaTermino(enCurso, AHORA), false);
  assert.equal(estadoEfectivo(enCurso, AHORA), "confirmed");
  assert.equal(esPresunta(enCurso, AHORA), false);

  // Justo al minuto de acabar, sí (medio-abierto, como los huecos de agenda).
  const justoAcabada = { status: "confirmed", scheduledAt: "2026-09-01T11:00:00.000Z", duration: 60 };
  assert.equal(yaTermino(justoAcabada, AHORA), true);
  assert.equal(estadoEfectivo(justoAcabada, AHORA), "completed");
  assert.equal(esPresunta(justoAcabada, AHORA), true);

  // Y una de mañana, ni de lejos.
  const futura = { status: "confirmed", scheduledAt: "2026-09-02T10:00:00.000Z", duration: 60 };
  assert.equal(estadoEfectivo(futura, AHORA), "confirmed");
  assert.equal(cuentaComoAtendida(futura, AHORA), false);
});

test("la presunción no toca ningún estado que ya diga algo", () => {
  // Pendiente: el centro nunca dijo que sí. Que pase su hora no la convierte
  // en una asistencia — es justo la que hay que revisar.
  const pendiente = citaHace(3, "pending");
  assert.equal(estadoEfectivo(pendiente, AHORA), "pending");
  assert.equal(esPresunta(pendiente, AHORA), false);
  assert.equal(cuentaComoAtendida(pendiente, AHORA), false);

  // Decisiones tomadas: se quedan como están, hayan pasado o no.
  for (const status of ["cancelled", "no_show", "completed"]) {
    const cita = citaHace(3, status);
    assert.equal(estadoEfectivo(cita, AHORA), status, status);
    assert.equal(esPresunta(cita, AHORA), false, status);
  }
});

test("lo comprobado y lo presumido cuentan igual, pero se distinguen", () => {
  const marcada = citaHace(3, "completed");
  const presumida = citaHace(3, "confirmed");

  // Para contar, las dos son atendidas: es lo que arregla las estadísticas.
  assert.equal(cuentaComoAtendida(marcada, AHORA), true);
  assert.equal(cuentaComoAtendida(presumida, AHORA), true);
  assert.equal(estadoEfectivo(marcada, AHORA), estadoEfectivo(presumida, AHORA));

  // Para contarlo en pantalla, no: solo una la miró alguien.
  assert.equal(esPresunta(marcada, AHORA), false);
  assert.equal(esPresunta(presumida, AHORA), true);
});

test("no se escribe nada: la fila que entra sale intacta", () => {
  const cita = citaHace(5, "confirmed");
  const copia = JSON.parse(JSON.stringify(cita));
  estadoEfectivo(cita, AHORA);
  esPresunta(cita, AHORA);
  cuentaComoAtendida(cita, AHORA);
  assert.deepEqual(cita, copia);
  // Y sigue siendo `confirmed` en la base: la presunción es solo al leer.
  assert.equal(cita.status, "confirmed");
});

test("una fila incompleta no tumba a quien la llama", () => {
  assert.equal(estadoEfectivo(null, AHORA), "pending");
  assert.equal(estadoEfectivo({}, AHORA), "pending");
  assert.equal(esPresunta(undefined, AHORA), false);
  // Confirmada pero sin fecha (no debería existir): no se presume nada.
  assert.equal(estadoEfectivo({ status: "confirmed" }, AHORA), "confirmed");
});
