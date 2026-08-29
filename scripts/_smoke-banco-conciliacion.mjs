// @prueba ligera
/**
 * _smoke-banco-conciliacion.mjs — fija `lib/banco/conciliacion.js` (29/08/2026):
 * cómo se lee una transacción de GoCardless y a quién se sugiere casar un
 * movimiento. Puro `node:test` + `node:assert/strict`, sin red ni base de
 * datos: son las reglas de las que depende que la sincronización no duplique
 * el extracto y que las sugerencias no casen dinero que no es.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ladoDe, normalizarTransaccion, sugerenciasPara } from "../lib/banco/conciliacion.js";

describe("ladoDe: el signo decide con qué se casa", () => {
  it("dinero que entra → cobro; dinero que sale → gasto", () => {
    assert.equal(ladoDe({ amount: 75 }), "cobro");
    assert.equal(ladoDe({ amount: "-120.50" }), "gasto");
  });
  it("cero cuenta como cobro (no existe el gasto de 0 €)", () => {
    assert.equal(ladoDe({ amount: 0 }), "cobro");
  });
});

describe("normalizarTransaccion: lo que manda el banco → nuestra fila", () => {
  const base = {
    internalTransactionId: "abc123",
    transactionId: "otro456",
    bookingDate: "2026-08-20",
    valueDate: "2026-08-21",
    transactionAmount: { amount: "75.00", currency: "eur" },
    remittanceInformationUnstructured: "CONSULTA NUTRICION AGOSTO",
    debtorName: "MARIA PEREZ",
    creditorName: "NUTRI LAURA SL",
  };

  it("prefiere internalTransactionId (el estable) y cae a transactionId", () => {
    assert.equal(normalizarTransaccion(base).uid, "abc123");
    assert.equal(normalizarTransaccion({ ...base, internalTransactionId: undefined }).uid, "otro456");
  });

  it("SIN uid no hay fila: sin idempotencia, cada sincronización duplicaría el extracto", () => {
    assert.equal(normalizarTransaccion({ ...base, internalTransactionId: null, transactionId: null }), null);
  });

  it("sin fecha o sin importe legible tampoco hay fila", () => {
    assert.equal(normalizarTransaccion({ ...base, bookingDate: null, valueDate: null }), null);
    assert.equal(
      normalizarTransaccion({ ...base, transactionAmount: { amount: "no-es-un-numero" } }),
      null
    );
  });

  it("la fecha cae a valueDate si el banco no manda bookingDate", () => {
    assert.equal(normalizarTransaccion({ ...base, bookingDate: null }).bookingDate, "2026-08-21");
  });

  it("el importe queda como número firmado y la divisa en mayúsculas (EUR si falta)", () => {
    const fila = normalizarTransaccion(base);
    assert.equal(fila.amount, 75);
    assert.equal(fila.currency, "EUR");
    assert.equal(normalizarTransaccion({ ...base, transactionAmount: { amount: "-12.34" } }).currency, "EUR");
  });

  it("si entra dinero, la contraparte es quien lo MANDA; si sale, a quién se paga", () => {
    assert.equal(normalizarTransaccion(base).counterparty, "MARIA PEREZ");
    const cargo = normalizarTransaccion({ ...base, transactionAmount: { amount: "-40.00", currency: "EUR" } });
    assert.equal(cargo.counterparty, "NUTRI LAURA SL");
  });

  it("el concepto no repite la misma frase aunque llegue por dos campos", () => {
    const repetida = normalizarTransaccion({
      ...base,
      remittanceInformationUnstructuredArray: ["CONSULTA NUTRICION AGOSTO"],
    });
    assert.equal(repetida.concept, "CONSULTA NUTRICION AGOSTO");
  });

  it("y junta las piezas distintas en un solo texto", () => {
    const conRef = normalizarTransaccion({
      ...base,
      remittanceInformationUnstructured: null,
      remittanceInformationUnstructuredArray: ["CONSULTA NUTRICION AGOSTO", "REF 0042"],
    });
    assert.equal(conRef.concept, "CONSULTA NUTRICION AGOSTO REF 0042");
  });
});

describe("sugerenciasPara: a quién se ofrece casar un movimiento", () => {
  const mov = { amount: 75, bookingDate: "2026-08-20", counterparty: "MARIA PEREZ GARCIA" };

  it("el importe tiene que CLAVAR al céntimo: 75,01 no es 75,00", () => {
    const out = sugerenciasPara(mov, [
      { id: "a", importe: 75.0, fecha: "2026-08-19" },
      { id: "b", importe: 75.01, fecha: "2026-08-20" },
      { id: "c", importe: 74.99, fecha: "2026-08-20" },
    ]);
    assert.deepEqual(out.map((s) => s.id), ["a"]);
  });

  it("compara en valor absoluto: un cargo de -40 casa con un gasto de 40", () => {
    const out = sugerenciasPara({ amount: -40, bookingDate: "2026-08-20" }, [
      { id: "g", importe: 40, fecha: "2026-08-18" },
    ]);
    assert.equal(out.length, 1);
  });

  it("a más de maxDias de distancia, fuera (el banco liquida con retraso, no con meses)", () => {
    const out = sugerenciasPara(mov, [
      { id: "lejos", importe: 75, fecha: "2026-08-01" },
      { id: "cerca", importe: 75, fecha: "2026-08-15" },
    ]);
    assert.deepEqual(out.map((s) => s.id), ["cerca"]);
  });

  it("gana la fecha más cercana", () => {
    const out = sugerenciasPara(mov, [
      { id: "a5dias", importe: 75, fecha: "2026-08-15" },
      { id: "a1dia", importe: 75, fecha: "2026-08-19" },
    ]);
    assert.deepEqual(out.map((s) => s.id), ["a1dia", "a5dias"]);
  });

  it("el nombre parecido desempata, y compara sin tildes ni mayúsculas", () => {
    const out = sugerenciasPara(mov, [
      { id: "otra", importe: 75, fecha: "2026-08-18", nombre: "Carmen López" },
      { id: "maria", importe: 75, fecha: "2026-08-18", nombre: "María Pérez" },
    ]);
    assert.equal(out[0].id, "maria");
    assert.equal(out[0].nombreCoincide, true);
  });

  it("devuelve como mucho `max` y con un movimiento ilegible no devuelve nada", () => {
    const muchos = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, importe: 75, fecha: "2026-08-19" }));
    assert.equal(sugerenciasPara(mov, muchos).length, 5);
    assert.deepEqual(sugerenciasPara({ amount: "nada" }, muchos), []);
  });
});
