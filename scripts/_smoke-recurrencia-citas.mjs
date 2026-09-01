// @prueba ligera
// Fija lib/citas/recurrencia.js: qué fechas materializa una cita que se repite.
import test from "node:test";
import assert from "node:assert/strict";
import { fechasDeRepeticion, TOPE_REPETICIONES } from "../lib/citas/recurrencia.js";

test("semanal hasta una fecha: una por semana, sin la primera, tope inclusive", () => {
  const { fechas, sinDia } = fechasDeRepeticion("2026-09-01T16:00", "semana", "2026-09-29");
  assert.equal(fechas.length, 4); // 8, 15, 22 y 29 de septiembre
  assert.equal(fechas[0].getDate(), 8);
  assert.equal(fechas[3].getDate(), 29);
  assert.equal(sinDia, 0);
});

test("la hora de pared se conserva aunque cruce el cambio de hora", () => {
  // Del 20 de octubre al 3 de noviembre de 2026: en medio cae el fin del
  // horario de verano europeo (25/10). Las 16:00 siguen siendo las 16:00.
  const { fechas } = fechasDeRepeticion("2026-10-20T16:00", "semana", "2026-11-03");
  assert.equal(fechas.length, 2);
  for (const f of fechas) assert.equal(f.getHours(), 16);
});

test("quincenal salta de 14 en 14", () => {
  const { fechas } = fechasDeRepeticion("2026-09-01T10:30", "quincena", "2026-10-01");
  assert.equal(fechas.length, 2); // 15 y 29 de septiembre
  assert.equal(fechas[0].getDate(), 15);
  assert.equal(fechas[1].getDate(), 29);
});

test("mensual con día 31: los meses cortos se saltan y se cuentan", () => {
  const { fechas, sinDia } = fechasDeRepeticion("2026-01-31T12:00", "mes", "2026-05-31");
  // Marzo y mayo tienen 31; febrero y abril no.
  assert.deepEqual(fechas.map((f) => [f.getMonth() + 1, f.getDate()]), [[3, 31], [5, 31]]);
  assert.equal(sinDia, 2);
});

test("un «hasta» disparatado no crea mil citas: manda el tope", () => {
  const { fechas } = fechasDeRepeticion("2026-09-01T16:00", "semana", "2036-09-01");
  assert.equal(fechas.length, TOPE_REPETICIONES);
});

test("entradas ilegibles devuelven vacío", () => {
  assert.equal(fechasDeRepeticion("no es fecha", "semana", "2026-09-29").fechas.length, 0);
  assert.equal(fechasDeRepeticion("2026-09-01T16:00", "semana", "pronto").fechas.length, 0);
  assert.equal(fechasDeRepeticion("2026-09-01T16:00", "cada luna llena", "2026-09-29").fechas.length, 0);
});
