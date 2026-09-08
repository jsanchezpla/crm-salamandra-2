// @prueba ligera
/**
 * _smoke-cobro-del-bono.mjs — el cobro pendiente que nace al dar un bono
 * (08/09/2026, AV-0070 de Aumenta).
 *
 * Lo primero que fija es la regla que comparte con las cuotas: **nace
 * PENDIENTE**. Si un día alguien lo pone en `completed` «porque ya está dado»,
 * esta prueba se pone roja — y con ella se iría en silencio la mitad de lo que
 * pidió Rosa, que es enterarse de quién no ha pagado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  METODO_POR_DEFECTO,
  bonoLlevaCobro,
  textoDelCobroDeBono,
  cobroPendienteDeBono,
} from "../lib/billing/cobroDelBono.js";

const BASE = { amount: 15000, clientId: "cli-1", packId: "pk-1", nombre: "PSICOLOGÍA 45", sesiones: 5 };

test("el cobro de un bono nace PENDIENTE", () => {
  assert.equal(cobroPendienteDeBono(BASE).status, "pending");
});

test("sin importe no se crea cobro", () => {
  // Una fila pendiente de importe desconocido no es una deuda: nadie la puede
  // saldar y ensucia Cobros.
  assert.equal(cobroPendienteDeBono({ ...BASE, amount: null }), null);
  assert.equal(cobroPendienteDeBono({ ...BASE, amount: undefined }), null);
  assert.equal(bonoLlevaCobro(null), false);
});

test("un bono regalado (0 €) tampoco genera cobro", () => {
  assert.equal(cobroPendienteDeBono({ ...BASE, amount: 0 }), null);
  assert.equal(bonoLlevaCobro(0), false);
});

test("un importe que no es un entero de céntimos no cuela", () => {
  assert.equal(bonoLlevaCobro(150.5), false);
  assert.equal(bonoLlevaCobro("15000"), false);
  assert.equal(bonoLlevaCobro(-15000), false);
});

test("sin ficha no hay a quién cobrarle", () => {
  assert.equal(cobroPendienteDeBono({ ...BASE, clientId: null }), null);
});

test("el texto dice de qué bono es y cuántas sesiones", () => {
  assert.equal(textoDelCobroDeBono({ nombre: "PSICOLOGÍA 45", sesiones: 5 }), "Bono «PSICOLOGÍA 45» · 5 sesiones");
  assert.equal(textoDelCobroDeBono({ nombre: "LOGOPEDIA", sesiones: 1 }), "Bono «LOGOPEDIA» · 1 sesión");
  assert.equal(textoDelCobroDeBono({}), "Bono de sesiones");
});

test("el importe y la ficha viajan tal cual", () => {
  const c = cobroPendienteDeBono(BASE);
  assert.equal(c.amount, 15000);
  assert.equal(c.clientId, "cli-1");
  assert.equal(c.packId, "pk-1");
});

test("un bono NO es de un mes", () => {
  /*
   * `periodMonth` a null a propósito: con un mes puesto entraría en el bloqueo
   * del portal y en «Facturar el mes» de ese mes como si fuera una cuota.
   */
  assert.equal(cobroPendienteDeBono(BASE).periodMonth, null);
  assert.equal(cobroPendienteDeBono(BASE).cuotaId, null);
});

test("el paciente viaja cuando el bono es de un niño", () => {
  assert.equal(cobroPendienteDeBono({ ...BASE, patientId: "pac-1" }).patientId, "pac-1");
  assert.equal(cobroPendienteDeBono(BASE).patientId, null);
});

test("la fecha es la de compra del bono, no la de hoy", () => {
  const c = cobroPendienteDeBono({ ...BASE, compradoEl: "2026-09-01T10:00:00.000Z" });
  assert.equal(c.paidAt.toISOString().slice(0, 10), "2026-09-01");
});

test("el método por defecto es el de siempre y se puede cambiar", () => {
  assert.equal(cobroPendienteDeBono(BASE).method, METODO_POR_DEFECTO);
  assert.equal(cobroPendienteDeBono({ ...BASE, metodo: "cash" }).method, "cash");
  // Un método vacío cae al de siempre en vez de guardar null, que rompería la columna.
  assert.equal(cobroPendienteDeBono({ ...BASE, metodo: "" }).method, METODO_POR_DEFECTO);
});

test("no revienta sin argumentos", () => {
  assert.equal(cobroPendienteDeBono(), null);
  assert.equal(cobroPendienteDeBono({}), null);
});
