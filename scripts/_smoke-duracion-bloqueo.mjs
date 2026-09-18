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
  DURACION_POR_DEFECTO,
  minutosDeBloqueo,
  avisoDeBloqueoLargo,
  duracionSugeridaDeBloqueo,
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

/* ── Lo que se propone al pulsar un hueco (18/09/2026, AV-0200) ───────────── */

/** Un bloqueo de `min` minutos que empieza a las 10:00 del día que se diga. */
const bloq = (dia, min) => ({
  startAt: md(`2026-09-${dia}T10:00:00+02:00`),
  endAt: md(`2026-09-${dia}T${String(10 + Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00+02:00`),
});

test("propone lo que esa persona bloquea, no lo que dura una cita", () => {
  // El caso de Rocío: cuatro bloqueos de 45 y unos tipos de cita de 60.
  const r = duracionSugeridaDeBloqueo({
    mios: [bloq("01", 45), bloq("02", 45), bloq("03", 45), bloq("04", 45)],
    delCentro: [bloq("05", 60)],
    tiposDeCita: [60, 60, 60, 60, 30],
  });
  assert.deepEqual(r, { minutos: 45, de: "mios" });
});

test("sin bloqueos propios, la costumbre del centro", () => {
  const r = duracionSugeridaDeBloqueo({
    mios: [],
    delCentro: [bloq("01", 15), bloq("02", 15), bloq("03", 60)],
    tiposDeCita: [60],
  });
  assert.deepEqual(r, { minutos: 15, de: "centro" });
});

test("a igualdad de veces gana la más corta: pasarse tapa huecos, quedarse corto no", () => {
  const r = duracionSugeridaDeBloqueo({ mios: [bloq("01", 90), bloq("02", 30)] });
  assert.equal(r.minutos, 30);
});

test("un centro recién abierto cae a la cita más corta que tiene", () => {
  const r = duracionSugeridaDeBloqueo({ mios: [], delCentro: [], tiposDeCita: [60, 45, 90] });
  assert.deepEqual(r, { minutos: 45, de: "tipos" });
});

test("y sin nada de nada, la hora de siempre", () => {
  assert.deepEqual(duracionSugeridaDeBloqueo(), { minutos: 60, de: "defecto" });
  assert.deepEqual(duracionSugeridaDeBloqueo({}), { minutos: 60, de: "defecto" });
  assert.equal(DURACION_POR_DEFECTO, 60);
});

test("las vacaciones y los días enteros no dicen cuánto dura un hueco", () => {
  /*
   * Tres semanas y un día entero de 00:00 a 23:59, que son 1.439 minutos y no
   * 1.440: es la forma real que tienen los seis días enteros de `nutri_laura`
   * y, sin el tope de cuatro horas, serían «lo que esa persona bloquea».
   */
  const r = duracionSugeridaDeBloqueo({
    mios: [
      { startAt: md("2026-08-01T00:00:00+02:00"), endAt: md("2026-08-21T23:59:00+02:00") },
      { startAt: md("2026-09-01T00:00:00+02:00"), endAt: md("2026-09-01T23:59:00+02:00") },
    ],
    delCentro: [bloq("10", 30)],
  });
  assert.deepEqual(r, { minutos: 30, de: "centro" });
});

test("aguanta filas ilegibles y las de la base en snake_case", () => {
  const r = duracionSugeridaDeBloqueo({
    mios: [
      null,
      { startAt: "no es una fecha", endAt: md("2026-09-01T11:00:00+02:00") },
      { start_at: md("2026-09-01T10:00:00+02:00"), end_at: md("2026-09-01T10:50:00+02:00") },
    ],
  });
  assert.deepEqual(r, { minutos: 50, de: "mios" });
});
