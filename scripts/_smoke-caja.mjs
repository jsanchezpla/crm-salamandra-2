// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-caja.mjs — entradas y salidas de caja, y el resumen del día por forma
 * de pago (01/09/2026).
 *
 *   node scripts/_smoke-caja.mjs
 *   node --test-name-pattern="arqueo" scripts/_smoke-caja.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * El arqueo comparaba lo contado en el cajón contra «fondo inicial + cobros en
 * efectivo». Por el cajón de un centro pasa mucho más: se paga la mensajería,
 * se saca el sobre para el banco, se mete cambio. Nada de eso es un cobro, así
 * que el arqueo descuadraba TODOS los días y el descuadre se acababa
 * explicando en la casilla de «motivo» — texto libre que dentro de seis meses
 * no dice nada.
 *
 * Lo que aquí se fija, por lo que DEVUELVE:
 *
 *  - EL SIGNO: `amount` se guarda siempre positivo y el signo lo pone
 *    `direction`. Teclear «-20» para una salida es lo que hará todo el mundo, y
 *    si se guardara −20 en una salida, restaría dos veces.
 *  - LAS TRES CESTAS: efectivo / tarjeta / banco, con la domiciliación contando
 *    como banco (para quien mira el resumen del día es lo mismo).
 *  - EL PENDIENTE FUERA: un cobro que aún no ha entrado no puede cuadrar una
 *    caja. Desde que la cuota del mes genera cobros PENDIENTES, esto no es
 *    teórico: son cientos de filas al mes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CESTAS,
  cestaDe,
  limpiarMovimiento,
  saldoDeMovimientos,
  resumenDelDia,
  cobrosDelDia,
} from "../lib/billing/caja.js";

const CAJA = "11111111-1111-1111-1111-111111111111";
const apunte = (extra = {}) => ({
  cashPointId: CAJA, date: "2026-09-01", direction: "out", amount: 20, concept: "Mensajería", ...extra,
});

describe("las tres cestas", () => {
  it("la domiciliación cuenta como banco, junto a la transferencia", () => {
    assert.equal(cestaDe("transfer"), "banco");
    assert.equal(cestaDe("direct_debit"), "banco");
    assert.equal(cestaDe("cash"), "efectivo");
    assert.equal(cestaDe("card"), "tarjeta");
  });

  it("un método que no existe no cae en ninguna cesta (no se inventa una)", () => {
    assert.equal(cestaDe("bizum"), null);
    assert.equal(cestaDe(undefined), null);
  });

  it("las cestas cubren los cuatro métodos del modelo Payment", () => {
    const cubiertos = Object.values(CESTAS).flat().sort();
    assert.deepEqual(cubiertos, ["card", "cash", "direct_debit", "transfer"]);
  });
});

describe("lo que acepta un apunte de caja", () => {
  it("pide los cuatro datos del centro: fecha, importe, concepto y si entra o sale", () => {
    assert.match(limpiarMovimiento({ ...apunte(), date: "1/9/26" }).problema, /AAAA-MM-DD/);
    assert.match(limpiarMovimiento({ ...apunte(), amount: "" }).problema, /importe/i);
    assert.match(limpiarMovimiento({ ...apunte(), concept: "  " }).problema, /concepto/i);
    assert.match(limpiarMovimiento({ ...apunte(), direction: "" }).problema, /entra o sale/i);
    assert.match(limpiarMovimiento({ ...apunte(), cashPointId: "" }).problema, /caja/i);
  });

  it("las observaciones son opcionales", () => {
    assert.equal(limpiarMovimiento(apunte()).valores.notes, null);
    assert.equal(limpiarMovimiento(apunte({ notes: " del 3 " })).valores.notes, "del 3");
  });

  it("UN IMPORTE EN NEGATIVO SE GUARDA POSITIVO: el signo lo pone la dirección", () => {
    const { valores } = limpiarMovimiento(apunte({ direction: "out", amount: -20 }));
    assert.equal(valores.amount, 20);
    assert.equal(valores.direction, "out");
  });

  it("un importe de 0 no es un apunte", () => {
    assert.match(limpiarMovimiento(apunte({ amount: 0 })).problema, /distinto de 0/);
  });

  it("un importe ilegible se rechaza en vez de colarse valiendo cero", () => {
    assert.match(limpiarMovimiento(apunte({ amount: "veinte" })).problema, /número/i);
  });

  it("la edición parcial solo toca lo que viaja", () => {
    const { valores } = limpiarMovimiento({ concept: "Papelería" }, { parcial: true });
    assert.deepEqual(Object.keys(valores), ["concept"]);
  });

  it("los céntimos se redondean como el resto del dinero", () => {
    assert.equal(limpiarMovimiento(apunte({ amount: 20.005 })).valores.amount, 20.01);
  });
});

describe("el saldo de los apuntes", () => {
  it("suma entradas, resta salidas", () => {
    const s = saldoDeMovimientos([
      { direction: "in", amount: 100 },
      { direction: "out", amount: 30 },
      { direction: "out", amount: 20.5 },
    ]);
    assert.deepEqual(s, { entradas: 100, salidas: 50.5, neto: 49.5 });
  });

  it("un importe guardado en negativo NO resta dos veces", () => {
    const s = saldoDeMovimientos([{ direction: "out", amount: -30 }]);
    assert.equal(s.salidas, 30);
    assert.equal(s.neto, -30);
  });

  it("sin apuntes, todo a cero (nunca NaN)", () => {
    assert.deepEqual(saldoDeMovimientos(), { entradas: 0, salidas: 0, neto: 0 });
    assert.deepEqual(saldoDeMovimientos([{ amount: "hola", direction: "in" }]).entradas, 0);
  });
});

describe("el resumen del día", () => {
  const cobros = [
    { amount: 50, method: "cash", status: "completed" },
    { amount: 30, method: "cash", status: "completed" },
    { amount: 90, method: "card", status: "completed" },
    { amount: 190, method: "transfer", status: "completed" },
    { amount: 110, method: "direct_debit", status: "completed" },
  ];

  it("reparte lo cobrado en efectivo, tarjeta y banco", () => {
    const r = resumenDelDia({ cobros });
    assert.equal(r.efectivo.importe, 80);
    assert.equal(r.efectivo.cobros, 2);
    assert.equal(r.tarjeta.importe, 90);
    assert.equal(r.banco.importe, 300); // transferencia + domiciliación
    assert.equal(r.cobrado, 470);
  });

  it("UN COBRO PENDIENTE NO CUADRA UNA CAJA: se cuenta aparte", () => {
    const r = resumenDelDia({ cobros: [...cobros, { amount: 190, method: "cash", status: "pending" }] });
    assert.equal(r.efectivo.importe, 80); // el pendiente NO entra
    assert.equal(r.pendiente, 190);
  });

  it("lo que debe quedar en el cajón: fondo + efectivo + entradas − salidas", () => {
    const r = resumenDelDia({
      cobros,
      movimientos: [{ direction: "in", amount: 40 }, { direction: "out", amount: 25 }],
      fondoInicial: 100,
    });
    assert.equal(r.movimientos.neto, 15);
    assert.equal(r.enCaja, 195); // 100 + 80 + 15
  });

  it("un día sin nada devuelve ceros, no huecos", () => {
    const r = resumenDelDia({});
    assert.equal(r.cobrado, 0);
    assert.equal(r.enCaja, 0);
    assert.equal(r.efectivo.cobros, 0);
  });

  it("un método desconocido no se suma a ninguna cesta ni descuadra el total", () => {
    const r = resumenDelDia({ cobros: [{ amount: 10, method: "bizum", status: "completed" }] });
    assert.equal(r.cobrado, 0);
  });
});

describe("la lista de cobros de un día", () => {
  const cobros = [
    { id: "c3", amount: 30, method: "cash", status: "completed", paidAt: "2026-09-04T16:40:00.000Z" },
    { id: "c1", amount: 50, method: "card", status: "completed", paidAt: "2026-09-04T07:05:00.000Z" },
    { id: "p1", amount: 200, method: "transfer", status: "pending", paidAt: "2026-09-04T08:00:00.000Z" },
    { id: "c2", amount: 90, method: "transfer", status: "completed", paidAt: "2026-09-04T09:30:00.000Z" },
  ];

  it("SUMA LO MISMO QUE LA FILA: la lista es el total del día, desglosado", () => {
    const { lista } = cobrosDelDia(cobros);
    const suma = lista.reduce((s, c) => s + c.amount, 0);
    assert.equal(suma, resumenDelDia({ cobros }).cobrado);
  });

  it("va en orden de hora, de la primera cobrada a la última", () => {
    const { lista } = cobrosDelDia(cobros);
    assert.deepEqual(lista.map((c) => c.id), ["c1", "c2", "c3"]);
  });

  it("los pendientes NO se listan (son cientos al generar las cuotas), pero se cuentan", () => {
    const { lista, pendientes } = cobrosDelDia(cobros);
    assert.ok(!lista.some((c) => c.id === "p1"));
    assert.equal(pendientes.cobros, 1);
    assert.equal(pendientes.importe, 200);
  });

  it("un cobro sin hora va al final, no el primero", () => {
    const { lista } = cobrosDelDia([
      { id: "sinhora", amount: 10, method: "cash", status: "completed", paidAt: null },
      { id: "conhora", amount: 10, method: "cash", status: "completed", paidAt: "2026-09-04T10:00:00.000Z" },
    ]);
    assert.deepEqual(lista.map((c) => c.id), ["conhora", "sinhora"]);
  });

  it("un día sin nada devuelve lista vacía y cero pendientes, no huecos", () => {
    const r = cobrosDelDia();
    assert.deepEqual(r.lista, []);
    assert.equal(r.pendientes.cobros, 0);
    assert.equal(r.pendientes.importe, 0);
  });
});
