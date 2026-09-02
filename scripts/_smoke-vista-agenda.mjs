// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-vista-agenda.mjs — qué días y qué horas pinta la agenda de un centro
 * (02/09/2026, AV-0020 y AV-0012 de Aumenta).
 *
 *   node scripts/_smoke-vista-agenda.mjs
 *
 * La semana laboral es un ajuste POR CENTRO (hay centros que abren sábados) y
 * las horas salen del horario de apertura ya puesto en Disponibilidad. Esta
 * prueba fija el margen, el redondeo, los topes y el centro sin horario, que
 * son los casos en los que una agenda se quedaría corta o vacía sin avisar.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { semanaLaboralDe, esSemanaValida, diasOcultos, horasDeApertura, vistaDe, aMinutos, aHoraFc } from "../lib/citas/vistaAgenda.js";

describe("semanaLaboralDe", () => {
  it("«lv» esconde el fin de semana; cualquier otra cosa es la semana completa", () => {
    assert.equal(semanaLaboralDe({ settings: { citas: { semanaLaboral: "lv" } } }), "lv");
    assert.equal(semanaLaboralDe({ settings: { citas: { semanaLaboral: " LV " } } }), "lv");
    assert.equal(semanaLaboralDe({ settings: { citas: { semanaLaboral: "completa" } } }), "completa");
    assert.equal(semanaLaboralDe({ settings: { citas: {} } }), "completa");
    assert.equal(semanaLaboralDe({ settings: { citas: { semanaLaboral: "L-V" } } }), "completa");
    assert.equal(semanaLaboralDe(null), "completa");
  });
  it("solo se guardan los dos valores conocidos", () => {
    assert.equal(esSemanaValida("lv"), true);
    assert.equal(esSemanaValida("completa"), true);
    assert.equal(esSemanaValida("sabados"), false);
    assert.equal(esSemanaValida(null), false);
  });
  it("diasOcultos: domingo y sábado, o ninguno", () => {
    assert.deepEqual(diasOcultos("lv"), [0, 6]);
    assert.deepEqual(diasOcultos("completa"), []);
  });
});

describe("horasDeApertura", () => {
  it("de la franja más temprana a la más tardía, con media hora de margen redondeada a la media hora", () => {
    const h = horasDeApertura([
      { startTime: "09:00", endTime: "14:00" },
      { startTime: "16:00", endTime: "20:15" },
      { startTime: "10:00", endTime: "13:00" },
    ]);
    assert.deepEqual(h, { slotMinTime: "08:30:00", slotMaxTime: "21:00:00", desdeHorario: true });
  });
  it("acepta «HH:MM:SS» (que es como vienen de la base) y descarta franjas rotas", () => {
    const h = horasDeApertura([
      { startTime: "09:30:00", endTime: "13:00:00" },
      { startTime: "x", endTime: "14:00" },
      { startTime: "15:00", endTime: "12:00" }, // fin antes del inicio
      null,
    ]);
    assert.deepEqual(h, { slotMinTime: "09:00:00", slotMaxTime: "13:30:00", desdeHorario: true });
  });
  it("sin horario puesto, la rejilla de siempre", () => {
    assert.deepEqual(horasDeApertura([]), { slotMinTime: "07:00:00", slotMaxTime: "22:00:00", desdeHorario: false });
    assert.deepEqual(horasDeApertura(null), { slotMinTime: "07:00:00", slotMaxTime: "22:00:00", desdeHorario: false });
  });
  it("nunca se sale del día: ni antes de las 00:00 ni después de las 24:00", () => {
    const h = horasDeApertura([{ startTime: "00:15", endTime: "23:45" }]);
    assert.deepEqual(h, { slotMinTime: "00:00:00", slotMaxTime: "24:00:00", desdeHorario: true });
  });
});

describe("vistaDe", () => {
  it("junta las dos reglas en lo que pide el calendario", () => {
    const v = vistaDe({ settings: { citas: { semanaLaboral: "lv" } } }, [{ startTime: "09:00", endTime: "20:00" }]);
    assert.deepEqual(v, { semanaLaboral: "lv", hiddenDays: [0, 6], slotMinTime: "08:30:00", slotMaxTime: "20:30:00", desdeHorario: true });
  });
});

describe("horas", () => {
  it("aMinutos y aHoraFc se entienden entre sí", () => {
    assert.equal(aMinutos("08:30"), 510);
    assert.equal(aMinutos("08:30:00"), 510);
    assert.equal(aMinutos("25:00"), null);
    assert.equal(aMinutos(""), null);
    assert.equal(aHoraFc(510), "08:30:00");
    assert.equal(aHoraFc(-10), "00:00:00");
    assert.equal(aHoraFc(2000), "24:00:00");
  });
});
