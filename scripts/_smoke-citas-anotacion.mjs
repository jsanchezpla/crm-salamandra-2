// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-anotacion.mjs — la anotación de una cita en la rejilla
 * (18/09/2026, AV-0211 de Aumenta).
 *
 *   node scripts/_smoke-citas-anotacion.mjs
 *   node --test-name-pattern="mes" scripts/_smoke-citas-anotacion.mjs
 *
 * ── QUÉ FIJA ───────────────────────────────────────────────────────────────
 * Olga pidió ver en la agenda las anotaciones que ya se escriben al crear la
 * cita. Lo que se pinta lo decide `lib/citas/anotacionEnLaAgenda.js`, y de ahí
 * hay dos cosas que no pueden torcerse sin que alguien se entere:
 *
 *   · Que la anotación salga en UNA línea y acotada. Un salto de línea o un
 *     párrafo de 400 caracteres rompen el alto de la caja de la cita, que es lo
 *     que se pasó tres semanas arreglando en agosto (`eventMinHeight`, citas
 *     pegadas, el nombre cortado con «…»).
 *   · Que en MES y en LISTA no se pinte. Ahí la caja es de una línea y ya la
 *     ocupa el nombre del paciente: meter una segunda estiraría la fila del día
 *     y el mes dejaría de leerse como una rejilla (el porqué del `dayMaxEvents`).
 *
 * Prueba lo que DEVUELVEN las dos funciones, no cómo están escritas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anotacionParaLaAgenda,
  laCajaEnseñaLaAnotacion,
  LARGO_ANOTACION,
} from "../lib/citas/anotacionEnLaAgenda.js";

test("una cita sin anotación no lleva nada a la rejilla", () => {
  for (const vacio of [null, undefined, "", "   ", "\n\t ", 0, 42, {}, []]) {
    assert.equal(anotacionParaLaAgenda(vacio), null, `debería ser null: ${JSON.stringify(vacio)}`);
  }
});

test("una anotación corta pasa tal cual, sin espacios de sobra", () => {
  assert.equal(anotacionParaLaAgenda("  viene la abuela  "), "viene la abuela");
});

test("nunca sale con saltos de línea: la caja mide lo que dura la cita", () => {
  const dosRenglones = "traer el informe\ndel colegio";
  const salida = anotacionParaLaAgenda(dosRenglones);
  assert.equal(salida, "traer el informe del colegio");
  assert.ok(!/[\n\r]/.test(salida), "no puede llevar saltos");
});

test("lo que no cabe se corta con «…» y no pasa del largo + el puntito", () => {
  const larga = "recordar a la madre que traiga el informe del colegio y la cartilla de vacunas";
  const salida = anotacionParaLaAgenda(larga);
  assert.ok(salida.endsWith("…"), `debería acabar en «…»: ${salida}`);
  assert.ok(salida.length <= LARGO_ANOTACION + 1, `se pasa de largo: ${salida.length}`);
  // El recorte es del principio y por palabra entera: la caja dice «…traiga el»
  // y no «…traiga e», que se lee como una errata.
  const sinPuntito = salida.slice(0, -1);
  assert.ok(larga.startsWith(sinPuntito), `el recorte no es del principio: ${salida}`);
  assert.equal(larga[sinPuntito.length], " ", "tenía que cortar en un espacio");
});

test("una palabra sola más larga que la caja se corta a lo bruto, pero se corta", () => {
  const salida = anotacionParaLaAgenda("x".repeat(400));
  assert.equal(salida.length, LARGO_ANOTACION + 1);
  assert.ok(salida.endsWith("…"));
});

test("la más larga medida en producción (142 caracteres) sale acotada", () => {
  // 18/09/2026: la anotación más larga de las 423 de Aumenta medía 142.
  const salida = anotacionParaLaAgenda("a".repeat(142));
  assert.ok(salida.length <= LARGO_ANOTACION + 1);
});

test("se pinta en semana, día y tres días", () => {
  for (const vista of ["timeGridWeek", "timeGridDay", "timeGridTresDias"]) {
    assert.equal(laCajaEnseñaLaAnotacion(vista), true, vista);
  }
});

test("NO se pinta en mes ni en lista: ahí la caja es una línea", () => {
  for (const vista of ["dayGridMonth", "listWeek", "dayGridWeek", null, undefined, ""]) {
    assert.equal(laCajaEnseñaLaAnotacion(vista), false, String(vista));
  }
});
