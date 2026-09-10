// @prueba ligera
// Fija lib/billing/busquedaArqueo.js: el buscador del arqueo (10/09/2026).
import test from "node:test";
import assert from "node:assert/strict";
import { Op } from "sequelize";
import {
  whereDeBusquedaCierres,
  whereDeBusquedaMovimientos,
  colgarBusqueda,
  importeDe,
} from "../lib/billing/busquedaArqueo.js";

/** Las condiciones de una palabra (el `Op.or` de su grupo). */
const campos = (where, i = 0) => where[Op.and][i][Op.or];

/** Cuántas condiciones son una expresión SQL de esta función (`to_char`, `abs`). */
const cuantas = (where, funcion) =>
  campos(where).filter((c) => c?.attribute?.fn === funcion).length;

test("sin nada que buscar, null", () => {
  for (const nada of ["", "   ", null, undefined]) {
    assert.equal(whereDeBusquedaCierres(nada), null);
    assert.equal(whereDeBusquedaMovimientos(nada), null);
  }
});

test("todas las palabras, cada una en cualquiera de los campos", () => {
  const where = whereDeBusquedaCierres("olga banco");
  assert.equal(where[Op.and].length, 2);
  for (const grupo of where[Op.and]) {
    assert.ok(grupo[Op.or].some((c) => "notes" in c));
    assert.ok(grupo[Op.or].some((c) => "$closedBy.display_name$" in c));
  }
  // Un pegote enorme se corta: seis palabras son seis condiciones, no cuarenta.
  assert.equal(whereDeBusquedaCierres("a b c d e f g h i")[Op.and].length, 6);
});

test("un cierre se encuentra por su día, escrito como se escribe", () => {
  // Dos formatos, porque las dos maneras se teclean: la de la pantalla
  // (31/07/2026) y la de la base (2026-07-31).
  assert.equal(cuantas(whereDeBusquedaCierres("31/07/2026"), "to_char"), 2);
  assert.equal(cuantas(whereDeBusquedaCierres("31/07"), "to_char"), 2);
  assert.equal(cuantas(whereDeBusquedaCierres("2026-07"), "to_char"), 2);
  // El año, por igualdad y con una sola condición.
  assert.equal(cuantas(whereDeBusquedaCierres("2026"), "to_char"), 1);
  assert.equal(cuantas(whereDeBusquedaMovimientos("31/07"), "to_char"), 2);
  // Una palabra normal no pregunta por la fecha.
  assert.equal(cuantas(whereDeBusquedaCierres("olga"), "to_char"), 0);
});

test("«20» NO se busca como fecha: casaría el 2026 de todo el año", () => {
  assert.equal(cuantas(whereDeBusquedaCierres("20"), "to_char"), 0);
  assert.equal(cuantas(whereDeBusquedaMovimientos("20"), "to_char"), 0);
});

test("el importe se busca por igualdad, no por parecido", () => {
  const where = whereDeBusquedaCierres("20,50");
  assert.deepEqual(campos(where).find((c) => "countedAmount" in c), { countedAmount: 20.5 });
  assert.deepEqual(campos(where).find((c) => "openingAmount" in c), { openingAmount: 20.5 });
  assert.deepEqual(campos(where).find((c) => "expectedAmount" in c), { expectedAmount: 20.5 });
  // Del descuadre se busca el TAMAÑO: faltar 20 y sobrar 20 es el mismo 20.
  assert.equal(cuantas(where, "abs"), 1);
  // Y un texto no genera condiciones de importe.
  const sin = whereDeBusquedaCierres("olga");
  assert.equal(campos(sin).some((c) => "countedAmount" in c), false);
  assert.equal(cuantas(sin, "abs"), 0);
});

test("importeDe solo acepta la palabra entera", () => {
  assert.equal(importeDe("250"), 250);
  assert.equal(importeDe("20,50"), 20.5);
  assert.equal(importeDe("-3.5"), -3.5);
  assert.equal(importeDe("f-2026"), null);
  assert.equal(importeDe("31/07"), null);
  assert.equal(importeDe(""), null);
});

test("los apuntes buscan por concepto, observaciones, quién y dirección", () => {
  const where = whereDeBusquedaMovimientos("mensajeria");
  assert.ok(campos(where).some((c) => "concept" in c));
  assert.ok(campos(where).some((c) => "notes" in c));
  assert.ok(campos(where).some((c) => "$createdBy.display_name$" in c));
  const salida = whereDeBusquedaMovimientos("salida");
  assert.deepEqual(campos(salida).find((c) => "direction" in c), { direction: "out" });
  const entrada = whereDeBusquedaMovimientos("entradas");
  assert.deepEqual(campos(entrada).find((c) => "direction" in c), { direction: "in" });
  // El importe se guarda siempre positivo: el signo lo pone la dirección.
  const importe = whereDeBusquedaMovimientos("-40");
  assert.deepEqual(campos(importe).find((c) => "amount" in c), { amount: 40 });
});

test("las tildes no se exigen: mensajeria casa «mensajería»", () => {
  const patron = campos(whereDeBusquedaMovimientos("mensajeria")).find((c) => "concept" in c)
    .concept[Op.iRegexp];
  assert.match("Mensajería", new RegExp(patron, "i"));
});

test("lo especial de una regex se escapa y no revienta la consulta", () => {
  const patron = campos(whereDeBusquedaCierres("(banco)")).find((c) => "notes" in c).notes[Op.iRegexp];
  assert.doesNotThrow(() => new RegExp(patron));
  assert.match("sobre (banco)", new RegExp(patron, "i"));
});

test("colgarBusqueda no se lleva por delante lo que ya había", () => {
  const where = { cashPointId: "abc", [Op.and]: [{ ya: 1 }] };
  colgarBusqueda(where, whereDeBusquedaCierres("olga"));
  assert.equal(where.cashPointId, "abc");
  assert.equal(where[Op.and].length, 2);
  assert.deepEqual(where[Op.and][0], { ya: 1 });
  // Sin nada que buscar, el where se queda como estaba.
  const igual = { [Op.and]: [{ ya: 1 }] };
  colgarBusqueda(igual, whereDeBusquedaCierres(""));
  assert.equal(igual[Op.and].length, 1);
});
