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
  haEntrado,
  exigeMetodo,
  saldoDiarioEfectivo,
  fondoSugerido,
  esperadoAlCerrar,
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

/*
 * ── LAS DEVOLUCIONES (07/09/2026, tarea del Registro) ──────────────────────
 * Marcar un cobro como «Devuelto» lo sacaba de lo cobrado y no apuntaba la
 * salida en ningún sitio: el día del cobro dejaba de cuadrar con lo que se
 * contó entonces y el de la devolución cuadraba de menos. Ahora son dos
 * apuntes: entró el día `paidAt`, salió el día `refundedAt`.
 */
describe("las devoluciones: entró un día, salió otro", () => {
  const devuelto = {
    id: "d1", amount: 50, method: "cash", status: "refunded",
    paidAt: "2026-09-04T10:00:00.000Z", refundedAt: "2026-09-06T11:00:00.000Z",
  };

  it("el cobro devuelto SIGUE contando el día que se cobró: el dinero entró", () => {
    const r = resumenDelDia({ cobros: [devuelto] });
    assert.equal(r.efectivo.importe, 50);
    assert.equal(r.efectivo.cobros, 1);
    assert.equal(r.pendiente, 0);
    assert.equal(r.cobrado, 50);
  });

  it("el día de la devolución resta de su cesta y sale del cajón", () => {
    const r = resumenDelDia({
      cobros: [{ id: "c9", amount: 80, method: "cash", status: "completed" }],
      devoluciones: [devuelto],
      fondoInicial: 100,
    });
    assert.equal(r.efectivo.importe, 30);
    assert.equal(r.efectivo.devuelto, 50);
    assert.equal(r.devuelto, 50);
    assert.equal(r.devoluciones, 1);
    assert.equal(r.cobrado, 30);
    assert.equal(r.enCaja, 130); // 100 + 80 − 50
  });

  it("una devolución con tarjeta no toca el cajón: resta de tarjeta", () => {
    const r = resumenDelDia({ devoluciones: [{ ...devuelto, method: "card" }], fondoInicial: 100 });
    assert.equal(r.tarjeta.importe, -50);
    assert.equal(r.efectivo.importe, 0);
    assert.equal(r.enCaja, 100);
  });

  it("cobrado y devuelto el mismo día se anulan, pero el día no parece vacío", () => {
    const r = resumenDelDia({ cobros: [devuelto], devoluciones: [devuelto] });
    assert.equal(r.cobrado, 0);
    assert.equal(r.devuelto, 50);
    assert.equal(r.efectivo.cobros, 1);
  });

  it("en la lista del día la devolución va en negativo, marcada y a la hora en que se devolvió", () => {
    const cobroDelDia = { id: "c1", amount: 20, method: "cash", status: "completed", paidAt: "2026-09-06T12:00:00.000Z" };
    const { lista, pendientes } = cobrosDelDia([cobroDelDia], [devuelto]);
    assert.deepEqual(lista.map((c) => c.id), ["d1", "c1"]);
    assert.equal(lista[0].devolucion, true);
    assert.equal(lista[0].amount, -50);
    assert.equal(lista[0].paidAt, devuelto.refundedAt);
    assert.equal(pendientes.cobros, 0);
    // Y sigue sumando lo mismo que la fila del día.
    const suma = lista.reduce((s, c) => s + c.amount, 0);
    assert.equal(suma, resumenDelDia({ cobros: [cobroDelDia], devoluciones: [devuelto] }).cobrado);
  });

  it("un cobro que no está devuelto no se cuela como devolución aunque se le pase", () => {
    const r = resumenDelDia({ devoluciones: [{ ...devuelto, status: "completed" }] });
    assert.equal(r.devuelto, 0);
    assert.equal(r.devoluciones, 0);
    assert.equal(cobrosDelDia([], [{ ...devuelto, status: "completed" }]).lista.length, 0);
  });

  it("haEntrado: cobrado sí; pendiente y fallido no", () => {
    assert.equal(haEntrado({ status: "completed" }), true);
    assert.equal(haEntrado({ status: "pending" }), false);
    assert.equal(haEntrado({ status: "failed" }), false);
  });

  it("exigeMetodo: el pendiente puede no decirlo; el cobrado, sí", () => {
    // 10/09/2026: el cobro de la cuota nace sin método porque todavía no es
    // dinero. En cuanto se da por cobrado hay que decir por dónde entró, o el
    // importe sumaría al día sin caer en ninguna cesta.
    assert.equal(exigeMetodo("pending"), false);
    assert.equal(exigeMetodo("failed"), false);
    assert.equal(exigeMetodo("completed"), true);
    // Devuelto también: el dinero entró y volvió a salir por el mismo sitio.
    assert.equal(exigeMetodo("refunded"), true);
    // Un cobro sin método no cae en ninguna cesta (es lo que evita la regla).
    assert.equal(cestaDe(null), null);
    const r = resumenDelDia({ cobros: [{ id: "x", amount: 50, method: null, status: "pending" }] });
    assert.equal(r.pendiente, 50);
    assert.equal(r.banco.importe, 0);
  });

  it("un devuelto CON fecha entró (y saldrá su día); SIN fecha, no cuenta", () => {
    assert.equal(haEntrado({ status: "refunded", refundedAt: "2026-09-06T11:00:00.000Z" }), true);
    // Sin `refundedAt` la salida no se apunta en ningún día: contarlo como
    // entrado inventaría un descuadre. Se comporta como antes del 07/09/2026.
    assert.equal(haEntrado({ status: "refunded", refundedAt: null }), false);
    assert.equal(haEntrado({ status: "refunded" }), false);
    const r = resumenDelDia({ cobros: [{ id: "viejo", amount: 80, method: "cash", status: "refunded" }], fondoInicial: 100 });
    assert.equal(r.efectivo.importe, 0);
    assert.equal(r.enCaja, 100);
  });
});

/*
 * ── LO QUE QUEDA EN EL CAJÓN, DÍA A DÍA (09/09/2026) ───────────────────────
 *
 * Aumenta: «que se vea cada día lo que queda en caja a golpe de vista, una vez
 * restadas las salidas». El resumen por día ya decía cuánto ENTRÓ; lo que no
 * decía es cuánto HAY, y no se puede sacar sumando la columna de efectivo:
 * el cajón arrastra el saldo del día anterior y las salidas lo bajan.
 *
 * Lo que se fija aquí: el arrastre (cada día parte del anterior), que la
 * tarjeta y el banco NO entran en el cajón, y que las salidas restan una vez.
 */
describe("el efectivo que queda en el cajón", () => {
  const dia = (fecha, { cash = 0, card = 0, entradas = 0, salidas = 0 } = {}) => ({
    fecha,
    ...resumenDelDia({
      cobros: [
        ...(cash ? [{ amount: cash, method: "cash", status: "completed" }] : []),
        ...(card ? [{ amount: card, method: "card", status: "completed" }] : []),
      ],
      movimientos: [
        ...(entradas ? [{ direction: "in", amount: entradas }] : []),
        ...(salidas ? [{ direction: "out", amount: salidas }] : []),
      ],
    }),
  });

  it("arrastra el saldo de un día al siguiente", () => {
    const filas = saldoDiarioEfectivo(
      [dia("2026-09-01", { cash: 100 }), dia("2026-09-02", { cash: 50 }), dia("2026-09-03")],
      200
    );
    assert.deepEqual(filas.map((f) => f.efectivoDelDia.queda), [300, 350, 350]);
  });

  it("las salidas restan (y solo una vez)", () => {
    const [uno] = saldoDiarioEfectivo([dia("2026-09-01", { cash: 100, salidas: 30 })], 0);
    assert.equal(uno.efectivoDelDia.cobrado, 100);
    assert.equal(uno.efectivoDelDia.salidas, 30);
    assert.equal(uno.efectivoDelDia.movimiento, 70);
    assert.equal(uno.efectivoDelDia.queda, 70);
  });

  it("la tarjeta no pasa por el cajón", () => {
    const [uno] = saldoDiarioEfectivo([dia("2026-09-01", { cash: 20, card: 480 })], 0);
    assert.equal(uno.efectivoDelDia.queda, 20);
  });

  it("un día sin nada no mueve el saldo, pero lo dice", () => {
    const [uno] = saldoDiarioEfectivo([dia("2026-09-01")], 125.5);
    assert.equal(uno.efectivoDelDia.movimiento, 0);
    assert.equal(uno.efectivoDelDia.queda, 125.5);
  });

  it("sin días, no hay saldo que arrastrar", () => {
    assert.deepEqual(saldoDiarioEfectivo([], 100), []);
  });

  it("los céntimos se redondean una vez por día, no al final", () => {
    const filas = saldoDiarioEfectivo(
      [dia("2026-09-01", { cash: 0.1 }), dia("2026-09-02", { cash: 0.2 })],
      0
    );
    assert.deepEqual(filas.map((f) => f.efectivoDelDia.queda), [0.1, 0.3]);
  });

  it("el fondo del cierre siguiente sale del conteo, no de los apuntes", () => {
    // Recordatorio de la regla del 07/09/2026: un cierre importado (a cero y
    // sin autor) no propone fondo; uno contado por alguien, sí.
    assert.equal(fondoSugerido({ closeDate: "2026-07-31", countedAmount: 0, hechoPorUnaPersona: false }), null);
    assert.deepEqual(
      fondoSugerido({ closeDate: "2026-09-08", countedAmount: 240.75, hechoPorUnaPersona: true }),
      { importe: 240.75, fecha: "2026-09-08" }
    );
  });
});

/*
 * ── EL CIERRE LO ESCRIBE EL SISTEMA (10/09/2026, Aumenta) ──────────────────
 *
 * Rodrigo, contando lo que pasaba en recepción: «en el botón de cerrar caja
 * Rosa escribe lo que quiere y lo correcto es que escriba el sistema el
 * efectivo que se ha ingresado y el que se ha retirado». Y la cuenta tiene que
 * ser UNA: la que propone el cierre y la que enseña la columna «Queda en caja»
 * del resumen por día. Si cada pantalla hiciera la suya, el centro vería dos
 * cifras de la misma caja y no sabría a cuál creer.
 *
 * Lo que se fija aquí:
 *  - la suma del cierre, con el arrastre de los días que nadie cerró;
 *  - que el día que se arquea manda lo CONTADO, no lo esperado: si faltaban
 *    20 €, siguen faltando mañana, y el fondo del día siguiente parte de ahí.
 */
describe("lo que debería quedar al cerrar", () => {
  it("es fondo + arrastre + cobros − devoluciones + entradas − salidas", () => {
    assert.equal(
      esperadoAlCerrar({ fondo: 100, arrastre: 20, efectivo: 50, devuelto: 10, entradas: 5, salidas: 15 }),
      150
    );
  });

  it("sin nada, cero (no NaN)", () => {
    assert.equal(esperadoAlCerrar(), 0);
    assert.equal(esperadoAlCerrar({ fondo: "", efectivo: null }), 0);
  });

  it("los números que llegan como texto cuentan igual", () => {
    assert.equal(esperadoAlCerrar({ fondo: "120.50", efectivo: "9.50" }), 130);
  });

  it("los céntimos se cierran una vez", () => {
    assert.equal(esperadoAlCerrar({ fondo: 0.1, efectivo: 0.2 }), 0.3);
  });
});

describe("el día que se arquea manda lo contado", () => {
  const dia = (fecha, { cash = 0, entradas = 0, salidas = 0 } = {}) => ({
    fecha,
    ...resumenDelDia({
      cobros: cash ? [{ amount: cash, method: "cash", status: "completed" }] : [],
      movimientos: [
        ...(entradas ? [{ direction: "in", amount: entradas }] : []),
        ...(salidas ? [{ direction: "out", amount: salidas }] : []),
      ],
    }),
  });

  it("el saldo pasa a ser lo contado, y el día siguiente parte de ahí", () => {
    const filas = saldoDiarioEfectivo(
      [dia("2026-09-01", { cash: 100 }), dia("2026-09-02", { cash: 50 })],
      0,
      new Map([["2026-09-01", { contado: 80 }]])
    );
    assert.equal(filas[0].efectivoDelDia.esperado, 100);
    assert.equal(filas[0].efectivoDelDia.queda, 80, "lo contado manda sobre lo esperado");
    assert.equal(filas[0].efectivoDelDia.descuadre, -20);
    assert.equal(filas[1].efectivoDelDia.queda, 130, "el día siguiente arrastra los 80, no los 100");
  });

  it("un día sin arqueo no dice que se contó nada", () => {
    const [uno] = saldoDiarioEfectivo([dia("2026-09-01", { cash: 40 })], 10);
    assert.equal(uno.efectivoDelDia.contado, null);
    assert.equal(uno.efectivoDelDia.descuadre, null);
    assert.equal(uno.efectivoDelDia.esperado, uno.efectivoDelDia.queda);
  });

  it("sin cierres, todo como antes", () => {
    const filas = saldoDiarioEfectivo([dia("2026-09-01", { cash: 100, salidas: 30 })], 0, null);
    assert.equal(filas[0].efectivoDelDia.queda, 70);
  });

  it("el cierre que cuadra deja el saldo donde estaba", () => {
    const filas = saldoDiarioEfectivo(
      [dia("2026-09-01", { cash: 100, entradas: 20, salidas: 30 })],
      50,
      { "2026-09-01": { contado: 140 } }
    );
    assert.equal(filas[0].efectivoDelDia.descuadre, 0);
    assert.equal(filas[0].efectivoDelDia.queda, 140);
  });
});
