/**
 * _smoke-facturas-orden-y-vencimiento.mjs — las dos quejas de formato de
 * AV-0176 (Isabel, de Aumenta, 17/09/2026), cada una en su regla de `lib/`.
 *
 *   «¿Por qué no salen correlativas en el buscador?» → `parseSortOrder` pega
 *   SIEMPRE el desempate detrás de la clave elegida. Ordenando por fecha —lo
 *   que pide la pantalla siempre—, las 229 facturas de septiembre empatan
 *   todas, y con una sola clave Postgres las devuelve como quiere.
 *
 *   «Y quitar lo de Vencimiento» → `vencimientoALaVista` solo lo enseña cuando
 *   significa algo. Sus facturas nacen COBRADAS y llevaban de vencimiento el
 *   día mismo de la emisión.
 *
 * Se prueba lo que DEVUELVEN, no cómo están escritas.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSortOrder } from "../lib/billing/parseSort.js";
import { vencimientoALaVista } from "../lib/billing/invoiceStatus.js";

const ALLOWED = {
  issueDate: "issueDate",
  number: "number",
  "client.name": [{ model: "Client", as: "client" }, "name"],
};
const FALLBACK = [["issueDate", "DESC"], ["number", "DESC"]];
const DESEMPATE = [["number", "DESC"]];

describe("parseSortOrder — el desempate va detrás de la clave elegida", () => {
  it("por fecha sale también por número: el fallo del encargo", () => {
    const order = parseSortOrder("issueDate", "desc", ALLOWED, FALLBACK, DESEMPATE);
    assert.deepEqual(order, [["issueDate", "DESC"], ["number", "DESC"]]);
  });

  /*
   * ── Y EL DESEMPATE DE VERDAD ES EL DE `ordenPorNumero` (18/09/2026) ──────
   * Comprobando el arreglo en producción, el 01/09 de Aumenta abría con
   * R-C2600028 y R-C2600027: dentro de un mismo día, «R-C26…» va delante de
   * «C26…» por puro orden alfabético. El endpoint pasa como desempate el
   * MISMO orden que usa al ordenar por número —normales delante,
   * rectificativas detrás—, así que aquí se prueba que se pega entero.
   */
  it("y si el desempate trae la agrupación de rectificativas, entra entera", () => {
    const grupo = { sql: "CASE WHEN … THEN 1 ELSE 0 END" };
    const order = parseSortOrder("issueDate", "desc", ALLOWED, FALLBACK, [[grupo, "ASC"], ["number", "DESC"]]);
    assert.deepEqual(order, [["issueDate", "DESC"], [grupo, "ASC"], ["number", "DESC"]]);
  });

  it("también ascendente, y el desempate no cambia de sentido", () => {
    const order = parseSortOrder("issueDate", "asc", ALLOWED, FALLBACK, DESEMPATE);
    assert.deepEqual(order, [["issueDate", "ASC"], ["number", "DESC"]]);
  });

  it("ordenando por esa misma columna no se repite", () => {
    const order = parseSortOrder("number", "asc", ALLOWED, FALLBACK, DESEMPATE);
    assert.deepEqual(order, [["number", "ASC"]]);
  });

  it("con clave de include anidado, el desempate sigue pegándose", () => {
    const order = parseSortOrder("client.name", "asc", ALLOWED, FALLBACK, DESEMPATE);
    assert.deepEqual(order, [[{ model: "Client", as: "client" }, "name", "ASC"], ["number", "DESC"]]);
  });

  it("una clave que no está en el mapa sigue cayendo al fallback tal cual", () => {
    assert.deepEqual(parseSortOrder("passwordHash", "asc", ALLOWED, FALLBACK, DESEMPATE), FALLBACK);
    assert.deepEqual(parseSortOrder(null, null, ALLOWED, FALLBACK, DESEMPATE), FALLBACK);
  });

  it("y sin desempate se comporta como siempre (los otros endpoints)", () => {
    assert.deepEqual(parseSortOrder("issueDate", "desc", ALLOWED, FALLBACK), [["issueDate", "DESC"]]);
  });
});

describe("vencimientoALaVista — solo cuando queda por cobrar", () => {
  it("la factura del lote, cobrada y con vencimiento el día de la emisión, no lo enseña", () => {
    const delLote = { status: "paid", dueDate: "2026-09-17", issueDate: "2026-09-17", total: 115, paidAmount: 115 };
    assert.equal(vencimientoALaVista(delLote), false);
  });

  it("la emitida y sin cobrar sí: ahí el vencimiento es la información", () => {
    const aDeber = { status: "issued", dueDate: "2026-10-05", total: 160, paidAmount: 0 };
    assert.equal(vencimientoALaVista(aDeber), true);
  });

  it("la cobrada a medias también, que el resto sigue debiéndose", () => {
    const aMedias = { status: "partially_paid", dueDate: "2026-10-05", total: 160, paidAmount: 100 };
    assert.equal(vencimientoALaVista(aMedias), true);
  });

  it("sin fecha de vencimiento no hay fila que pintar (antes salía con una raya)", () => {
    assert.equal(vencimientoALaVista({ status: "issued", dueDate: null, total: 160, paidAmount: 0 }), false);
    assert.equal(vencimientoALaVista({ status: "issued", total: 160 }), false);
  });

  it("el céntimo de redondeo no deja una factura pagada enseñando vencimiento", () => {
    const casi = { status: "issued", dueDate: "2026-10-05", total: 160, paidAmount: 159.996 };
    assert.equal(vencimientoALaVista(casi), false);
  });

  it("y sin factura no revienta", () => {
    assert.equal(vencimientoALaVista(null), false);
    assert.equal(vencimientoALaVista(undefined), false);
  });
});
