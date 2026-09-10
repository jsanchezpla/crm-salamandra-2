// @prueba ligera
/**
 * _smoke-resto-del-mes.mjs — el resto de un mes cobrado a medias (04/09/2026).
 *
 * Fija `lib/billing/restoDelMes.js`. Los dos errores que cuestan dinero:
 * restar cobros que no son de esta cuota (se cobraría de MENOS) y no restar
 * los que sí lo son (se cobraría el mes DOS veces). Los dos están probados.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  cobrosQueCuentan,
  yaCobradoDelMes,
  restoDelMes,
  restoQueSeQuedaPendiente,
  esDeOtroServicio,
  cobrosDeOtroServicio,
} from "../lib/billing/restoDelMes.js";

test("el caso del encargo: 50 de 120 cobrados, quedan 70", () => {
  const r = restoDelMes({ esperado: 120, cobros: [{ patientId: null, amount: 50 }] });
  assert.equal(r.yaCobrado, 50);
  assert.equal(r.resto, 70);
  assert.equal(r.hayParcial, true);
  assert.equal(r.completo, false);
});

test("varios parciales se suman", () => {
  const r = restoDelMes({
    esperado: 120,
    cobros: [{ amount: 50 }, { amount: 30 }, { amount: 20 }],
  });
  assert.equal(r.yaCobrado, 100);
  assert.equal(r.resto, 20);
});

test("el mes ya cubierto NO propone importe, avisa", () => {
  const r = restoDelMes({ esperado: 120, cobros: [{ amount: 120 }] });
  assert.equal(r.resto, 0);
  assert.equal(r.completo, true);
  assert.equal(r.hayParcial, false);
});

test("pagado de más no da un resto NEGATIVO", () => {
  // Un importe negativo lo aceptaría el formulario y restaría de la caja del día.
  const r = restoDelMes({ esperado: 120, cobros: [{ amount: 150 }] });
  assert.equal(r.resto, 0);
  assert.equal(r.completo, true);
});

test("sin nada cobrado el resto es la cuota entera y no hay parcial", () => {
  const r = restoDelMes({ esperado: 120, cobros: [] });
  assert.equal(r.yaCobrado, 0);
  assert.equal(r.resto, 120);
  assert.equal(r.hayParcial, false);
  assert.equal(r.completo, false);
});

test("los cobros de un HERMANO no se restan", () => {
  // Restarlos haría cobrar de menos a este niño: son de otra cuota.
  const cobros = [
    { patientId: "hugo", amount: 60 },
    { patientId: "marta", amount: 50 },
  ];
  const r = restoDelMes({ esperado: 120, cobros, patientId: "marta" });
  assert.equal(r.yaCobrado, 50);
  assert.equal(r.resto, 70);
});

test("los cobros SIN paciente (de la familia entera) sí cuentan", () => {
  // La misma regla que `cuotasQueEntran`: el importe esperado incluye las
  // cuotas de la familia, así que lo cobrado contra ellas también.
  const cobros = [
    { patientId: null, amount: 40 },
    { patientId: "marta", amount: 10 },
    { patientId: "hugo", amount: 99 },
  ];
  assert.equal(yaCobradoDelMes(cobros, "marta"), 50);
  assert.deepEqual(
    cobrosQueCuentan(cobros, "marta").map((c) => c.amount),
    [40, 10],
  );
});

test("sin paciente elegido cuenta TODO lo de la familia", () => {
  const cobros = [{ patientId: "hugo", amount: 60 }, { patientId: "marta", amount: 50 }];
  assert.equal(yaCobradoDelMes(cobros, null), 110);
});

test("los céntimos cuadran (los importes llegan como texto de un DECIMAL)", () => {
  const r = restoDelMes({ esperado: "120.50", cobros: [{ amount: "40.17" }, { amount: "0.33" }] });
  assert.equal(r.yaCobrado, 40.5);
  assert.equal(r.resto, 80);
});

test("sin importe esperado no se inventa una resta", () => {
  // Una familia sin cuota conocida: se dice lo cobrado y el importe se deja
  // como esté, en vez de proponer un 0 o un negativo.
  for (const esperado of [null, undefined, "", 0, "no es un número", NaN]) {
    const r = restoDelMes({ esperado, cobros: [{ amount: 50 }] });
    assert.equal(r.resto, 0, `esperado=${String(esperado)}`);
    assert.equal(r.hayParcial, false);
    assert.equal(r.completo, false);
    assert.equal(r.yaCobrado, 50, "lo cobrado se sigue diciendo");
  }
});

test("entradas raras no revientan", () => {
  assert.deepEqual(restoDelMes(), { yaCobrado: 0, resto: 0, hayParcial: false, completo: false });
  assert.equal(yaCobradoDelMes(null), 0);
  assert.equal(yaCobradoDelMes([{ amount: "abc" }, null, undefined]), 0);
  assert.deepEqual(cobrosQueCuentan(null, "marta"), []);
});

/* ── Lo que se queda a deber cuando traen menos (10/09/2026) ──────────────── */

test("el caso del encargo: piden 650 y traen 325, quedan 325 pendientes", () => {
  assert.equal(restoQueSeQuedaPendiente({ esperado: 650, importe: 325 }), 325);
});

test("con una fila pendiente detrás no se propone nada: la parte el servidor", () => {
  // Si aquí se dijera «faltan 60» y además el POST parte la fila, la familia
  // acabaría debiendo esos 60 dos veces.
  assert.equal(restoQueSeQuedaPendiente({ esperado: 160, importe: 100, hayPendiente: true }), 0);
});

test("pagando lo que se pide, o de más, no queda nada", () => {
  assert.equal(restoQueSeQuedaPendiente({ esperado: 190, importe: 190 }), 0);
  assert.equal(restoQueSeQuedaPendiente({ esperado: 190, importe: 250 }), 0);
});

test("los céntimos se redondean y un resto de redondeo no es una deuda", () => {
  assert.equal(restoQueSeQuedaPendiente({ esperado: 145.55, importe: 45.5 }), 100.05);
  assert.equal(restoQueSeQuedaPendiente({ esperado: 120.004, importe: 120 }), 0);
});

test("sin importe esperado —una familia sin cuota conocida— no se inventa deuda", () => {
  for (const esperado of [null, undefined, "", 0, "no es un número", NaN]) {
    assert.equal(restoQueSeQuedaPendiente({ esperado, importe: 50 }), 0, `esperado=${String(esperado)}`);
  }
  for (const importe of [null, undefined, "", 0, "x"]) {
    assert.equal(restoQueSeQuedaPendiente({ esperado: 100, importe }), 0, `importe=${String(importe)}`);
  }
  assert.equal(restoQueSeQuedaPendiente(), 0);
});

/*
 * ── LO DE OTRO SERVICIO NO PAGA LA CUOTA (10/09/2026, Rodrigo) ─────────────
 *
 * Leo: 50 € cobrados de la entrevista inicial, y el cajón pedía 95 € de una
 * cuota de logopedia de 145 €. La entrevista inicial no está en ninguna cuota
 * de Aumenta.
 */
const LOGO = "concepto-logopedia";
const ENTREVISTA = "concepto-entrevista";

test("un cobro de otro concepto no cuenta contra la cuota", () => {
  const cobros = [{ id: "1", amount: 50, conceptId: ENTREVISTA, patientId: "leo" }];
  const r = restoDelMes({ esperado: 116, cobros, patientId: "leo", conceptIds: [LOGO] });
  assert.equal(r.yaCobrado, 0);
  assert.equal(r.resto, 116);
  assert.equal(r.hayParcial, false);
});

test("y sin decir de qué conceptos es la cuota, todo cuenta, como siempre", () => {
  const cobros = [{ id: "1", amount: 50, conceptId: ENTREVISTA, patientId: "leo" }];
  assert.equal(restoDelMes({ esperado: 145, cobros, patientId: "leo" }).resto, 95);
});

test("lo tecleado a mano —sin concepto— sigue saldando el mes", () => {
  const cobros = [
    { id: "1", amount: 50, conceptId: ENTREVISTA, patientId: "leo" },
    { id: "2", amount: 45, conceptId: null, patientId: "leo" },
  ];
  const r = restoDelMes({ esperado: 116, cobros, patientId: "leo", conceptIds: [LOGO] });
  assert.equal(r.yaCobrado, 45, "el pago a cuenta de la cuota sí cuenta");
  assert.equal(r.resto, 71);
});

test("y el que se queda fuera se puede nombrar, para que no parezca perdido", () => {
  const cobros = [
    { id: "1", amount: 50, conceptId: ENTREVISTA, patientId: "leo" },
    { id: "2", amount: 45, conceptId: LOGO, patientId: "leo" },
    { id: "3", amount: 30, conceptId: ENTREVISTA, patientId: "otro" },
  ];
  const fuera = cobrosDeOtroServicio(cobros, "leo", [LOGO]);
  assert.deepEqual(fuera.map((c) => c.id), ["1"], "ni lo de la cuota ni lo de otro hermano");
});

test("esDeOtroServicio: sin conceptos, o sin concepto en el cobro, no descarta", () => {
  assert.equal(esDeOtroServicio({ conceptId: ENTREVISTA }, null), false);
  assert.equal(esDeOtroServicio({ conceptId: ENTREVISTA }, []), false);
  assert.equal(esDeOtroServicio({ conceptId: null }, [LOGO]), false);
  assert.equal(esDeOtroServicio({ conceptId: LOGO }, [LOGO]), false);
  assert.equal(esDeOtroServicio({ conceptId: ENTREVISTA }, [LOGO]), true);
});

test("cobrosQueCuentan sigue sin traer lo de un hermano", () => {
  const cobros = [
    { id: "1", amount: 50, patientId: "leo" },
    { id: "2", amount: 60, patientId: "hermana" },
    { id: "3", amount: 70, patientId: null },
  ];
  assert.deepEqual(cobrosQueCuentan(cobros, "leo").map((c) => c.id), ["1", "3"]);
  assert.equal(yaCobradoDelMes(cobros, "leo"), 120);
});
