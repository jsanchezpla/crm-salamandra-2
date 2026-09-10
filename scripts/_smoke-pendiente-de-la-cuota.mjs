/**
 * _smoke-pendiente-de-la-cuota.mjs — subir (o bajar) el importe de una cuota
 * con un pago parcial detrás (10/09/2026, encargo de Rodrigo).
 *
 *   «Debe 80 y le cobro 30, se queda pendiente a deber 50. Si entre medias,
 *   antes de que pague, subo la cuota a 100, debe automáticamente 70.
 *   IMPORTANTE: si un paciente ha pagado la cuota completa y ha completado su
 *   cobro ANTES de subir la cuota, no le salta de pronto un cobro pendiente de
 *   20 euros.»
 *
 * Las dos frases son la misma regla y aquí está escrita en números. Ligera: no
 * toca base de datos ni servidor.
 *
 * @prueba ligera
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ajusteDelPendiente, repartoDelMes } from "../lib/billing/pendienteDeLaCuota.js";

const lee = (r) => readFileSync(new URL(r, import.meta.url), "utf8");

/** Un cobro cobrado de ese mes (los DECIMAL llegan como texto, como en la BD). */
const cobrado = (amount, id = "cobrado") => ({ id, status: "completed", amount: String(amount) });
/** El pendiente que dejó la cuota. */
const pendiente = (amount, id = "pendiente") => ({
  id,
  status: "pending",
  amount: String(amount),
  invoiceId: null,
  stripePaymentIntentId: null,
  bankTransactionId: null,
  paymentSessionId: null,
});

describe("EL ENCARGO, en números", () => {
  it("debía 80, pagó 30 y la cuota sube a 100: el pendiente pasa a 70", () => {
    const r = ajusteDelPendiente({ esperado: 100, filas: [cobrado(30), pendiente(50)] });
    assert.equal(r.accion, "actualizar");
    assert.equal(r.importe, 70);
    assert.equal(r.yaCerrado, 30);
    assert.equal(r.pendiente.id, "pendiente");
  });

  it("y si la cuota BAJA a 60, el pendiente pasa a 30 (no se toca lo cobrado)", () => {
    const r = ajusteDelPendiente({ esperado: 60, filas: [cobrado(30), pendiente(50)] });
    assert.equal(r.accion, "actualizar");
    assert.equal(r.importe, 30);
  });

  it("EL «IMPORTANTE»: mes pagado entero y cuota que sube → no nace nada", () => {
    const r = ajusteDelPendiente({ esperado: 100, filas: [cobrado(80)] });
    assert.equal(r.accion, "sin-tocar");
    assert.equal(r.importe, null);
    assert.match(r.motivo, /ya está cobrado/);
  });

  it("tampoco con el mes pagado en dos veces (30 + 50) y la cuota subiendo", () => {
    const r = ajusteDelPendiente({ esperado: 100, filas: [cobrado(30, "a"), cobrado(50, "b")] });
    assert.equal(r.accion, "sin-tocar");
    assert.equal(r.yaCerrado, 80);
  });
});

describe("los casos de alrededor", () => {
  it("sin ninguna fila del mes se crea el cobro entero, como siempre", () => {
    const r = ajusteDelPendiente({ esperado: 190, filas: [] });
    assert.equal(r.accion, "crear");
    assert.equal(r.importe, 190);
  });

  it("sin nada cobrado, el pendiente se lleva la cuota entera", () => {
    const r = ajusteDelPendiente({ esperado: 190, filas: [pendiente(150)] });
    assert.equal(r.accion, "actualizar");
    assert.equal(r.importe, 190);
  });

  it("bajar la cuota por debajo de lo ya cobrado RETIRA el pendiente, no lo deja en negativo", () => {
    const r = ajusteDelPendiente({ esperado: 25, filas: [cobrado(30), pendiente(50)] });
    assert.equal(r.accion, "retirar");
    assert.equal(r.importe, null);
  });

  it("y justo cubierto (30 cobrados de una cuota de 30) también se retira", () => {
    const r = ajusteDelPendiente({ esperado: 30, filas: [cobrado(30), pendiente(50)] });
    assert.equal(r.accion, "retirar");
  });

  it("un céntimo de margen: 99,999 contra 100 no deja un pendiente fantasma", () => {
    const r = ajusteDelPendiente({ esperado: 100, filas: [cobrado(99.999), pendiente(0.01)] });
    assert.equal(r.accion, "retirar");
  });
});

describe("qué cuenta como «ya cerrado»", () => {
  it("una fila pendiente pero ya facturada NO se reescribe: cuenta como cerrada", () => {
    const facturado = { ...pendiente(50, "conFactura"), invoiceId: "f-1" };
    const r = ajusteDelPendiente({ esperado: 100, filas: [cobrado(30), facturado] });
    assert.equal(r.accion, "sin-tocar", "no queda ningún pendiente que se pueda tocar");
    assert.equal(r.yaCerrado, 80, "los 50 facturados ya son papel");
  });

  it("lo mismo con Stripe o con el banco detrás", () => {
    const conStripe = { ...pendiente(50, "stripe"), stripePaymentIntentId: "pi_1" };
    const conBanco = { ...pendiente(20, "banco"), bankTransactionId: "mov-1" };
    const r = repartoDelMes([conStripe, conBanco]);
    assert.equal(r.pendiente, null);
    assert.equal(r.yaCerrado, 70);
  });

  it("con varios pendientes (que el índice único no debería permitir) manda el primero", () => {
    const r = repartoDelMes([pendiente(50, "uno"), pendiente(20, "dos")]);
    assert.equal(r.pendiente.id, "uno");
  });
});

describe("un cobro devuelto no es dinero que haya entrado", () => {
  const devuelto = (amount, id = "devuelto") => ({ id, status: "refunded", amount: String(amount) });

  it("los 30 € devueltos vuelven a deberse: el pendiente se lleva la cuota entera", () => {
    const r = ajusteDelPendiente({ esperado: 100, filas: [devuelto(30), pendiente(50)] });
    assert.equal(r.yaCerrado, 0);
    assert.equal(r.accion, "actualizar");
    assert.equal(r.importe, 100);
  });

  it("y un cobro fallido tampoco cuenta", () => {
    const fallido = { id: "fallido", status: "failed", amount: "80.00" };
    assert.equal(repartoDelMes([fallido]).yaCerrado, 0);
  });

  it("pero la fila sigue ahí, así que no nace otra por detrás", () => {
    const r = ajusteDelPendiente({ esperado: 100, filas: [devuelto(80)] });
    assert.equal(r.accion, "sin-tocar");
    assert.match(r.motivo, /devuelto o fallido/);
  });
});

describe("y quien lo ejecuta lo usa de verdad", () => {
  const fuente = lee("../lib/billing/cobroDeCuota.js");

  it("sincronizarCobroDelMes carga TODAS las filas del mes, no una cualquiera", () => {
    assert.match(fuente, /const filasDelMes = await Payment\.findAll\(\{/);
    assert.doesNotMatch(
      fuente,
      /const cobro = await Payment\.findOne\(\{ where: \{ cuotaId: cuota\.id, periodMonth \} \}\);/,
      "el findOne sin estado es justo el fallo: con un pago parcial hay dos filas"
    );
  });

  it("y escribe en el pendiente el RESTO, no el importe de la cuota", () => {
    assert.match(fuente, /cambiosDelCobro\(cobro, \{ \.\.\.fila, importe: ajuste\.importe \}\)/);
  });

  it("con el mes ya cobrado no llega ni a plantearse crear otro", () => {
    assert.match(fuente, /if \(ajuste\.accion === "sin-tocar"\)/);
  });
});
