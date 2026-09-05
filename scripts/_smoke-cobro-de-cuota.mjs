// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cobro-de-cuota.mjs — el cobro del mes en curso sigue a su cuota
 * (05/09/2026).
 *
 *   node scripts/_smoke-cobro-de-cuota.mjs
 *   node --test-name-pattern="intocable" scripts/_smoke-cobro-de-cuota.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Dos avisos de Aumenta del 04/09/2026, y son el mismo agujero:
 *
 *  - AV-0048: «hemos asociado una cuota pero no aparece en cobros». El mes se
 *    había generado el día 1 y la cuota se creó el día 4: en Cobros no salía
 *    nada, sin error ninguno.
 *  - AV-0046: «si un paciente tiene dos terapias en cuotas, eliminas una de
 *    ella, sigue apareciendo en cobros las dos terapias que tenía
 *    anteriormente». El cobro era una foto del día en que se generó.
 *
 * `lib/billing/cobroDeCuota.js` los pone al día, y la parte que se puede fijar
 * sin base de datos —si ese cobro se puede tocar y qué habría que cambiarle—
 * vive en `lib/billing/cuotas.js`. Lo que de verdad duele si se rompe:
 *
 *  - QUÉ NO SE TOCA: un cobro cobrado, facturado o con Stripe/banco detrás no
 *    se reescribe nunca porque alguien haya cambiado la cuota después. Un fallo
 *    aquí reescribe dinero que ya entró.
 *  - LA NOTA A MANO: si alguien explicó en Cobros por qué ese mes es distinto,
 *    rehacer el cobro no puede borrárselo.
 *  - NO TOCAR POR TOCAR: sin cambios reales no hay `update`, para no ensuciar
 *    el rastro ni el `updated_at` de 274 cobros.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cobroSePuedeRehacer,
  cambiosDelCobro,
  esNotaAutomatica,
} from "../lib/billing/cuotas.js";

/** Un cobro pendiente recién generado, como lo deja el lote. */
const cobroLimpio = (extra = {}) => ({
  id: "p1",
  status: "pending",
  amount: "190.00",
  conceptId: "c1",
  paidAt: new Date("2026-09-01T00:00:00.000Z"),
  method: "transfer",
  notes: "Cuota septiembre 2026 — Logopedia + Psicología",
  invoiceId: null,
  stripePaymentIntentId: null,
  bankTransactionId: null,
  paymentSessionId: null,
  ...extra,
});

/** La fila que devuelve `planDeCuotasDelMes` para esa cuota y ese mes. */
const filaDelPlan = (extra = {}) => ({
  cuotaId: "q1",
  importe: 190,
  conceptId: "c1",
  paidAt: "2026-09-01",
  method: "transfer",
  notes: "Cuota septiembre 2026 — Logopedia + Psicología",
  ...extra,
});

describe("cobroSePuedeRehacer — qué cobro se puede tocar", () => {
  it("el pendiente y limpio, sí", () => {
    assert.deepEqual(cobroSePuedeRehacer(cobroLimpio()), { ok: true, motivo: null });
  });

  it("uno ya cobrado es intocable", () => {
    const r = cobroSePuedeRehacer(cobroLimpio({ status: "completed" }));
    assert.equal(r.ok, false);
    assert.match(r.motivo, /pendiente/);
  });

  it("uno devuelto o fallido tampoco se toca", () => {
    assert.equal(cobroSePuedeRehacer(cobroLimpio({ status: "refunded" })).ok, false);
    assert.equal(cobroSePuedeRehacer(cobroLimpio({ status: "failed" })).ok, false);
  });

  it("uno ya facturado es intocable, aunque siga pendiente de pago", () => {
    const r = cobroSePuedeRehacer(cobroLimpio({ invoiceId: "f1" }));
    assert.equal(r.ok, false);
    assert.match(r.motivo, /factura/);
  });

  it("con Stripe, con el banco o con un pago en marcha detrás, tampoco", () => {
    assert.equal(cobroSePuedeRehacer(cobroLimpio({ stripePaymentIntentId: "pi_1" })).ok, false);
    assert.equal(cobroSePuedeRehacer(cobroLimpio({ bankTransactionId: "b1" })).ok, false);
    assert.equal(cobroSePuedeRehacer(cobroLimpio({ paymentSessionId: "s1" })).ok, false);
  });

  it("sin cobro no hay nada que rehacer", () => {
    assert.equal(cobroSePuedeRehacer(null).ok, false);
  });
});

describe("esNotaAutomatica — la del programa se pisa, la de una persona no", () => {
  it("reconoce la que escribe el lote", () => {
    assert.equal(esNotaAutomatica("Cuota septiembre 2026 — Logopedia"), true);
    assert.equal(esNotaAutomatica("Cuota enero 2027"), true);
    assert.equal(esNotaAutomatica("  Cuota marzo 2026 — desde el 13/03/2026 (18/30 días)"), true);
  });

  it("no confunde la que escribe una persona", () => {
    assert.equal(esNotaAutomatica("Este mes le descontamos la reserva de 30 €"), false);
    assert.equal(esNotaAutomatica("Cuota pactada con la familia"), false);
    assert.equal(esNotaAutomatica(""), false);
    assert.equal(esNotaAutomatica(null), false);
  });
});

describe("cambiosDelCobro — qué habría que cambiarle", () => {
  it("sin cambios reales, no devuelve nada", () => {
    assert.equal(cambiosDelCobro(cobroLimpio(), filaDelPlan()), null);
  });

  it("el importe en cadena de DECIMAL no cuenta como cambio", () => {
    assert.equal(cambiosDelCobro(cobroLimpio({ amount: "190.000" }), filaDelPlan()), null);
  });

  it("quitarle una terapia baja el importe y rehace la nota (AV-0046)", () => {
    const cambios = cambiosDelCobro(
      cobroLimpio(),
      filaDelPlan({ importe: 130, notes: "Cuota septiembre 2026 — Logopedia" })
    );
    assert.equal(cambios.amount, 130);
    assert.equal(cambios.notes, "Cuota septiembre 2026 — Logopedia");
  });

  it("la nota escrita a mano NO se pisa, pero el importe sí se corrige", () => {
    const cambios = cambiosDelCobro(
      cobroLimpio({ notes: "Le descontamos la reserva de 30 €" }),
      filaDelPlan({ importe: 130, notes: "Cuota septiembre 2026 — Logopedia" })
    );
    assert.equal(cambios.amount, 130);
    assert.equal("notes" in cambios, false);
  });

  it("cambiar el día de cobro mueve la fecha", () => {
    const cambios = cambiosDelCobro(cobroLimpio(), filaDelPlan({ paidAt: "2026-09-05" }));
    assert.deepEqual(cambios, { paidAt: "2026-09-05" });
  });

  it("de efectivo a domiciliación, el recibo pendiente sigue a la cuota", () => {
    const cambios = cambiosDelCobro(cobroLimpio({ method: "cash" }), filaDelPlan({ method: "direct_debit" }));
    assert.deepEqual(cambios, { method: "direct_debit" });
  });

  it("una cuota sin método no le impone nada al cobro", () => {
    assert.equal(cambiosDelCobro(cobroLimpio({ method: "cash" }), filaDelPlan({ method: null })), null);
  });

  it("pasar de una terapia a dos deja el cobro sin concepto suelto", () => {
    const cambios = cambiosDelCobro(cobroLimpio(), filaDelPlan({ conceptId: null, importe: 250 }));
    assert.equal(cambios.conceptId, null);
    assert.equal(cambios.amount, 250);
  });

  it("sin cobro o sin fila no hay cambios", () => {
    assert.equal(cambiosDelCobro(null, filaDelPlan()), null);
    assert.equal(cambiosDelCobro(cobroLimpio(), null), null);
  });
});
