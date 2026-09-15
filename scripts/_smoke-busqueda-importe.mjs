/**
 * El buscador de Cobros y Morosos encuentra por importe y por paciente
 * (15/09/2026, AV-0136 de Aumenta).
 */
// @prueba ligera
import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";

import { importeBuscado, casaImporte } from "../lib/billing/importeBuscado.js";
import { filtrarMorosos } from "../lib/billing/morosidad.js";
import { whereDeBusquedaCobros } from "../lib/billing/busquedaCobros.js";

test("un número con coma, punto o € es un importe; lo demás no", () => {
  assert.equal(importeBuscado("60"), 60);
  assert.equal(importeBuscado("60,5"), 60.5);
  assert.equal(importeBuscado("60.50"), 60.5);
  assert.equal(importeBuscado("60€"), 60);
  assert.equal(importeBuscado("garcia"), null);
  assert.equal(importeBuscado("F-2026-01"), null);
  assert.equal(importeBuscado("1.200"), null);
  assert.equal(importeBuscado(""), null);
});

test("casaImporte compara al céntimo", () => {
  assert.equal(casaImporte(["60.00", 30], 60), true);
  assert.equal(casaImporte([60.01], 60), false);
  assert.equal(casaImporte([60], null), false);
});

test("Morosos: por importe (debe o cuota) y por nombre del paciente", () => {
  const lista = [
    { clientId: "1", name: "Familia López", importes: [160], pacientes: ["Hugo Martín"] },
    { clientId: "2", name: "Familia Ruiz", debe: 60, importes: [], pacientes: [] },
  ];
  assert.deepEqual(filtrarMorosos(lista, "160").map((m) => m.clientId), ["1"]);
  assert.deepEqual(filtrarMorosos(lista, "60,00").map((m) => m.clientId), ["2"]);
  assert.deepEqual(filtrarMorosos(lista, "martin").map((m) => m.clientId), ["1"]);
});

test("Cobros: un número añade el importe exacto a los campos buscados", () => {
  const campos = (q) => whereDeBusquedaCobros(q)[Op.and][0][Op.or];
  assert.ok(campos("60,50").some((c) => c.amount === 60.5));
  assert.ok(!campos("garcia").some((c) => "amount" in c));
});
