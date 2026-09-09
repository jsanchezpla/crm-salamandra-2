// @prueba ligera
/**
 * _smoke-hace-cuanto.mjs — «ayer» es un día del calendario, no 24 horas
 * (09/09/2026, AV-0091).
 *
 * EL CASO QUE LO ORIGINA, primero y con sus fechas reales: Laura rellenó un
 * formulario el lunes 07/09 por la tarde y el miércoles 09/09 por la mañana el
 * CRM se lo enseñaba como «ayer». Llevaban 41 horas: una división entre 24 da
 * 1, y de ahí «ayer». Pero el lunes no fue ayer.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { diaCivil, diasDeCalendario, haceCuanto } from "../lib/utils/haceCuanto.js";

/** Un instante de Madrid, escrito como se lee. */
const madrid = (s) => new Date(`${s}+02:00`).getTime(); // septiembre = CEST

test("EL CASO DE LAURA: el lunes por la tarde, visto el miércoles, no es «ayer»", () => {
  const formulario = madrid("2026-09-07T18:00:00");
  const ahora = madrid("2026-09-09T11:23:00");
  // 41 horas: la cuenta vieja decía «ayer».
  assert.ok((ahora - formulario) / 3_600_000 > 24 && (ahora - formulario) / 3_600_000 < 48);
  assert.equal(haceCuanto(formulario, { ahora }), "hace 2 días");
});

test("«ayer» es el día de calendario anterior, dure lo que dure", () => {
  const ahora = madrid("2026-09-09T09:00:00");
  // Ayer a las 23:50: solo 9 horas, pero fue ayer.
  assert.equal(haceCuanto(madrid("2026-09-08T23:50:00"), { ahora }), "ayer");
  // Y ayer a las 00:10: casi 33 horas, y sigue siendo ayer.
  assert.equal(haceCuanto(madrid("2026-09-08T00:10:00"), { ahora }), "ayer");
});

test("lo de hoy se cuenta en horas, aunque hayan pasado muchas", () => {
  const ahora = madrid("2026-09-09T23:30:00");
  assert.equal(haceCuanto(madrid("2026-09-09T00:15:00"), { ahora }), "hace 23 h");
});

test("lo recién hecho se cuenta en minutos, aunque cambie el día", () => {
  // 23:55 visto a las 00:05: son diez minutos, y decir «ayer» sería absurdo.
  const ahora = madrid("2026-09-10T00:05:00");
  assert.equal(haceCuanto(madrid("2026-09-09T23:55:00"), { ahora }), "hace 10 min");
});

test("los escalones de siempre siguen igual", () => {
  const ahora = madrid("2026-09-09T12:00:00");
  assert.equal(haceCuanto(madrid("2026-09-09T11:59:40"), { ahora }), "ahora mismo");
  assert.equal(haceCuanto(madrid("2026-09-09T11:45:00"), { ahora }), "hace 15 min");
  assert.equal(haceCuanto(madrid("2026-09-09T09:00:00"), { ahora }), "hace 3 h");
  assert.equal(haceCuanto(madrid("2026-09-01T12:00:00"), { ahora }), "hace 8 días");
});

test("el formato largo, para donde ya se escribía así", () => {
  const ahora = madrid("2026-09-09T12:00:00");
  assert.equal(haceCuanto(madrid("2026-09-09T11:59:40"), { ahora, largo: true }), "hace un momento");
  assert.equal(haceCuanto(madrid("2026-09-09T11:59:00"), { ahora, largo: true }), "hace 1 minuto");
  assert.equal(haceCuanto(madrid("2026-09-09T11:50:00"), { ahora, largo: true }), "hace 10 minutos");
  assert.equal(haceCuanto(madrid("2026-09-09T11:00:00"), { ahora, largo: true }), "hace 1 hora");
  assert.equal(haceCuanto(madrid("2026-09-09T09:00:00"), { ahora, largo: true }), "hace 3 horas");
  // Y los días no cambian de palabra por ser el formato largo.
  assert.equal(haceCuanto(madrid("2026-09-08T09:00:00"), { ahora, largo: true }), "ayer");
});

test("nada de esto se rompe con una fecha rara", () => {
  for (const bicho of [null, undefined, "", "no soy una fecha", NaN]) {
    assert.equal(haceCuanto(bicho), "");
  }
  assert.equal(haceCuanto(madrid("2026-09-10T12:00:00"), { ahora: madrid("2026-09-09T12:00:00") }), "en el futuro");
});

/* ── Las dos piezas por dentro ───────────────────────────────────────────── */

test("el día civil se calcula en Madrid, no en UTC", () => {
  // 00:30 de Madrid en verano son las 22:30 UTC del día ANTERIOR: quien mire el
  // UTC se equivoca de día, y ese es el fallo que se está arreglando.
  assert.equal(diaCivil("2026-09-09T00:30:00+02:00"), "2026-09-09");
  assert.equal(diaCivil("2026-09-08T23:30:00Z"), "2026-09-09");
  assert.equal(diaCivil("no soy una fecha"), null);
});

test("los días de calendario no los mueve el cambio de hora", () => {
  assert.equal(diasDeCalendario("2026-09-07", "2026-09-09"), 2);
  assert.equal(diasDeCalendario("2026-09-09", "2026-09-09"), 0);
  // El último domingo de octubre se atrasa una hora: esa noche dura 25.
  assert.equal(diasDeCalendario("2026-10-24", "2026-10-26"), 2);
  // Y en marzo dura 23.
  assert.equal(diasDeCalendario("2026-03-28", "2026-03-30"), 2);
  assert.equal(diasDeCalendario(null, "2026-09-09"), 0);
});
