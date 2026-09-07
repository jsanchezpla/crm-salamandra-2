// @prueba ligera
/**
 * _smoke-duracion-bloqueo.mjs — el freno de los bloqueos que se comen el curso
 * (08/09/2026, del caso real de Daniela y Estefanía en Aumenta).
 *
 * Lo que fija: por debajo de un día no molesta, por encima avisa, y cuando la
 * hora de fin es la de inicio —la huella de «hasta cuándo se repite»— el aviso
 * dice ESO y no un «son muchos días» genérico.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MINUTOS_DE_UN_DIA,
  minutosDeBloqueo,
  avisoDeBloqueoLargo,
} from "../lib/citas/duracionBloqueo.js";

/** Un instante de Madrid, escrito con su desfase para no depender del reloj. */
const md = (s) => new Date(s);

test("mide los minutos que dura", () => {
  assert.equal(minutosDeBloqueo(md("2026-09-11T15:30:00+02:00"), md("2026-09-11T15:45:00+02:00")), 15);
  assert.equal(minutosDeBloqueo(md("2026-09-11T09:00:00+02:00"), md("2026-09-11T21:00:00+02:00")), 720);
  assert.equal(MINUTOS_DE_UN_DIA, 1440);
});

test("una fecha ilegible no da un número inventado", () => {
  assert.equal(minutosDeBloqueo("no es una fecha", md("2026-09-11T15:45:00+02:00")), null);
  assert.equal(minutosDeBloqueo(md("2026-09-11T15:30:00+02:00"), undefined), null);
});

test("lo normal no pregunta nada", () => {
  // Un descanso de cuarto de hora.
  assert.equal(avisoDeBloqueoLargo(md("2026-09-11T15:30:00+02:00"), md("2026-09-11T15:45:00+02:00")), null);
  // Una jornada entera.
  assert.equal(avisoDeBloqueoLargo(md("2026-09-11T08:00:00+02:00"), md("2026-09-11T21:00:00+02:00")), null);
  // Justo un día clavado: el límite NO avisa.
  assert.equal(avisoDeBloqueoLargo(md("2026-09-11T08:00:00+02:00"), md("2026-09-12T08:00:00+02:00")), null);
});

test("el caso de Daniela: 15:30 del 11/09 a las 15:45 del 30/06 siguiente", () => {
  const a = avisoDeBloqueoLargo(md("2026-09-11T15:30:00+02:00"), md("2027-06-30T15:45:00+02:00"));
  assert.ok(a, "tiene que avisar");
  assert.equal(a.minutos, 420495);
  assert.equal(a.mismaHoraDelDia, true);
  assert.match(a.texto, /todas las semanas/);
  assert.match(a.texto, /meses/);
});

test("el caso de Estefanía es el mismo, con etiqueta bonita", () => {
  const a = avisoDeBloqueoLargo(md("2026-09-11T17:30:00+02:00"), md("2027-06-30T17:45:00+02:00"));
  assert.equal(a.mismaHoraDelDia, true);
  assert.equal(a.minutos, 420495);
});

test("unas vacaciones de verdad avisan, pero sin acusar de repetición", () => {
  // Tres semanas de agosto, de la mañana del 1 a la noche del 21.
  const a = avisoDeBloqueoLargo(md("2027-08-01T08:00:00+02:00"), md("2027-08-21T21:00:00+02:00"));
  assert.ok(a, "más de un día siempre se confirma");
  assert.equal(a.mismaHoraDelDia, false);
  assert.match(a.texto, /vacaciones o una baja/);
  assert.equal(a.dias, 21);
});

test("el aviso cuenta en meses cuando son muchos días", () => {
  const a = avisoDeBloqueoLargo(md("2026-09-11T15:30:00+02:00"), md("2027-06-30T15:45:00+02:00"));
  assert.match(a.texto, /10 meses/);
  const corto = avisoDeBloqueoLargo(md("2027-08-01T08:00:00+02:00"), md("2027-08-21T21:00:00+02:00"));
  assert.match(corto.texto, /21 días/);
});

test("el cambio de hora no descoloca la huella", () => {
  /*
   * Del 25/10/2026 (aún en verano, +02:00) al 26/10 (ya en invierno, +01:00):
   * las 15:30 de Madrid siguen siendo las 15:30 de Madrid, así que la huella
   * tiene que detectarse igual aunque en UTC haya una hora de diferencia.
   */
  const a = avisoDeBloqueoLargo(md("2026-10-24T15:30:00+02:00"), md("2026-11-24T15:30:00+01:00"));
  assert.equal(a.mismaHoraDelDia, true);
});

test("una fecha ilegible no inventa un aviso", () => {
  assert.equal(avisoDeBloqueoLargo("ayer", "mañana"), null);
});
