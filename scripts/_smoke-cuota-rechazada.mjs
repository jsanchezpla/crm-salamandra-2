// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cuota-rechazada.mjs — qué hace el CRM cuando el banco rechaza una
 * cuota del pago a plazos (07/09/2026).
 *
 *   node scripts/_smoke-cuota-rechazada.mjs
 *   node --test-name-pattern="motivo" scripts/_smoke-cuota-rechazada.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * El 07/09/2026 a las 12:03 el banco de una paciente de tunutrilaura rechazó
 * la 2.ª cuota de su plan de 3 × 130 € con `card_velocity_exceeded` (código de
 * red 61: la tarjeta había superado el límite que le pone su banco). Stripe
 * hizo UN intento y programó el siguiente para dos días después. El CRM no
 * tuvo nada que ver con el rechazo, pero tampoco supo contarlo: apuntó
 * «rechazada por el banco» leyendo `last_finalization_error` —el error de
 * EMITIR la factura, no el de cobrarla—, no avisó a nadie y, si la cuota
 * entraba al reintento, el rastro se quedaba puesto para siempre.
 *
 * Esta prueba fija lo que DEVUELVE `lib/payments/cuotaRechazada.js`: el rastro
 * que se apunta con la factura del evento, el motivo real leído de Stripe (con
 * un Stripe de mentira de tres líneas, sin red), el estado que enseñan la
 * ficha y el portal, los textos de la campana, y que el rastro se borra entero
 * cuando la cuota por fin entra.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CLAVES_RASTRO_RECHAZO,
  EXPLICACION_RECHAZO,
  avisoDeCuotaRechazada,
  avisoDePlanInterrumpido,
  estadoCuotasDe,
  explicarRechazo,
  motivoDeRechazoDeFactura,
  rastroDeRechazo,
  sinRastroDeRechazo,
} from "../lib/payments/cuotaRechazada.js";

/** La factura del 07/09/2026 tal como llegó en `invoice.payment_failed` (sin datos personales). */
const FACTURA_RECHAZADA = {
  id: "in_1UD0JOFYEInfvJrJxYncjvJw",
  billing_reason: "subscription_cycle",
  status: "open",
  amount_due: 13000,
  amount_paid: 0,
  attempt_count: 1,
  next_payment_attempt: 1788966180, // 2026-09-09 15:03 UTC (17:03 en Madrid)
  hosted_invoice_url: "https://invoice.stripe.com/i/acct_x/test_YWNjdF94?s=ap",
  last_finalization_error: null,
};

const AHORA = new Date("2026-09-07T10:03:14.856Z");

describe("explicarRechazo: del código de Stripe a una frase para el centro", () => {
  it("el caso real del 07/09: card_velocity_exceeded se explica y dice qué hacer", () => {
    const r = explicarRechazo({ code: "card_declined", decline_code: "card_velocity_exceeded", message: "Your card has exceeded its velocity limit." });
    assert.equal(r.codigo, "card_velocity_exceeded");
    assert.match(r.explicacion, /límite/);
    assert.match(r.explicacion, /otra tarjeta/);
  });

  it("el código del banco manda sobre el de Stripe", () => {
    const r = explicarRechazo({ code: "card_declined", decline_code: "insufficient_funds" });
    assert.equal(r.codigo, "insufficient_funds");
    assert.equal(r.explicacion, EXPLICACION_RECHAZO.insufficient_funds);
  });

  it("sin código del banco, vale el de Stripe", () => {
    const r = explicarRechazo({ code: "expired_card" });
    assert.equal(r.codigo, "expired_card");
    assert.equal(r.explicacion, EXPLICACION_RECHAZO.expired_card);
  });

  it("un código desconocido sale con el mensaje de Stripe, no con una frase inventada", () => {
    const r = explicarRechazo({ decline_code: "codigo_que_no_existe", message: "Lo que diga Stripe." });
    assert.equal(r.codigo, "codigo_que_no_existe");
    assert.equal(r.explicacion, "Lo que diga Stripe.");
  });

  it("sin nada, una frase genérica y sin reventar", () => {
    assert.deepEqual(explicarRechazo(null), { codigo: null, explicacion: "el banco ha rechazado el cargo" });
    assert.deepEqual(explicarRechazo({}), { codigo: null, explicacion: "el banco ha rechazado el cargo" });
  });

  it("toda explicación está escrita para una persona, no para un programador", () => {
    for (const [codigo, texto] of Object.entries(EXPLICACION_RECHAZO)) {
      assert.ok(texto.length > 15, `${codigo}: demasiado corta`);
      assert.doesNotMatch(texto, /_/, `${codigo}: parece un identificador, no una frase`);
    }
  });
});

describe("rastroDeRechazo: lo que se apunta con solo la factura del evento", () => {
  it("apunta fecha, factura, intento, importe, reintento y enlace de pago", () => {
    const r = rastroDeRechazo(FACTURA_RECHAZADA, AHORA);
    assert.equal(r.cuotaFallidaAt, "2026-09-07T10:03:14.856Z");
    assert.equal(r.cuotaFallidaFactura, "in_1UD0JOFYEInfvJrJxYncjvJw");
    assert.equal(r.cuotaFallidaIntentos, 1);
    assert.equal(r.cuotaFallidaImporte, 13000);
    assert.equal(r.proximoIntentoAt, "2026-09-09T15:03:00.000Z");
    assert.equal(r.enlacePagoCuota, FACTURA_RECHAZADA.hosted_invoice_url);
  });

  it("el motivo nace provisional: la factura no sabe por qué la rechazaron", () => {
    const r = rastroDeRechazo(FACTURA_RECHAZADA, AHORA);
    assert.equal(r.cuotaFallidaMotivo, "el banco ha rechazado el cargo");
    assert.equal(r.cuotaFallidaCodigo, null);
  });

  it("cuando Stripe se rinde (sin next_payment_attempt) no se promete ningún reintento", () => {
    const r = rastroDeRechazo({ ...FACTURA_RECHAZADA, next_payment_attempt: null, attempt_count: 4 }, AHORA);
    assert.equal(r.proximoIntentoAt, null);
    assert.equal(r.cuotaFallidaIntentos, 4);
  });

  it("una factura vacía no revienta", () => {
    const r = rastroDeRechazo(null, AHORA);
    assert.equal(r.cuotaFallidaFactura, null);
    assert.equal(r.cuotaFallidaIntentos, 1);
    assert.equal(r.enlacePagoCuota, null);
  });

  it("solo escribe las claves declaradas: son las que después se borran", () => {
    assert.deepEqual(Object.keys(rastroDeRechazo(FACTURA_RECHAZADA, AHORA)).sort(), [...CLAVES_RASTRO_RECHAZO].sort());
  });
});

describe("sinRastroDeRechazo: cuando la cuota por fin entra", () => {
  it("borra el rastro entero y respeta lo demás", () => {
    const antes = {
      instalmentMonths: 3,
      cuotasPagadas: 1,
      stripeSubscriptionId: "sub_x",
      ...rastroDeRechazo(FACTURA_RECHAZADA, AHORA),
    };
    const despues = sinRastroDeRechazo(antes);
    assert.deepEqual(despues, { instalmentMonths: 3, cuotasPagadas: 1, stripeSubscriptionId: "sub_x" });
    for (const clave of CLAVES_RASTRO_RECHAZO) assert.ok(!(clave in despues), clave);
  });

  it("no toca el objeto original ni revienta sin metadata", () => {
    const antes = { cuotaFallidaAt: "x", otra: 1 };
    sinRastroDeRechazo(antes);
    assert.equal(antes.cuotaFallidaAt, "x");
    assert.deepEqual(sinRastroDeRechazo(null), {});
  });
});

describe("motivoDeRechazoDeFactura: el motivo real, colgando de invoice_payments", () => {
  /** Un Stripe de mentira: apunta lo que se le pide y contesta lo que diga el guion. */
  function stripeDeMentira({ pagos, intents }) {
    const pedidos = [];
    return {
      pedidos,
      invoicePayments: {
        list: async (params) => {
          pedidos.push(["invoicePayments.list", params]);
          return { data: pagos };
        },
      },
      paymentIntents: {
        retrieve: async (id) => {
          pedidos.push(["paymentIntents.retrieve", id]);
          return intents[id];
        },
      },
    };
  }

  it("lee el último intento y devuelve el código del banco", async () => {
    const stripe = stripeDeMentira({
      pagos: [
        { created: 100, payment: { type: "payment_intent", payment_intent: "pi_viejo" } },
        { created: 200, payment: { type: "payment_intent", payment_intent: "pi_hoy" } },
      ],
      intents: {
        pi_viejo: { last_payment_error: { decline_code: "insufficient_funds" } },
        pi_hoy: { last_payment_error: { code: "card_declined", decline_code: "card_velocity_exceeded", message: "..." } },
      },
    });
    const r = await motivoDeRechazoDeFactura(stripe, "in_1");
    assert.equal(r.codigo, "card_velocity_exceeded");
    assert.deepEqual(stripe.pedidos[0], ["invoicePayments.list", { invoice: "in_1", limit: 10 }]);
    assert.deepEqual(stripe.pedidos[1], ["paymentIntents.retrieve", "pi_hoy"]);
  });

  it("el PaymentIntent puede venir expandido", async () => {
    const stripe = stripeDeMentira({
      pagos: [{ created: 1, payment: { type: "payment_intent", payment_intent: { id: "pi_exp" } } }],
      intents: { pi_exp: { last_payment_error: { decline_code: "expired_card" } } },
    });
    assert.equal((await motivoDeRechazoDeFactura(stripe, "in_2")).codigo, "expired_card");
  });

  it("sin intentos con error devuelve null: no se inventa un motivo", async () => {
    const stripe = stripeDeMentira({
      pagos: [{ created: 1, payment: { type: "payment_intent", payment_intent: "pi_ok" } }],
      intents: { pi_ok: { last_payment_error: null } },
    });
    assert.equal(await motivoDeRechazoDeFactura(stripe, "in_3"), null);
    assert.equal(await motivoDeRechazoDeFactura(stripeDeMentira({ pagos: [], intents: {} }), "in_4"), null);
  });

  it("con un SDK que no tenga invoice_payments, o sin factura, null y sin red", async () => {
    assert.equal(await motivoDeRechazoDeFactura({}, "in_5"), null);
    const stripe = stripeDeMentira({ pagos: [], intents: {} });
    assert.equal(await motivoDeRechazoDeFactura(stripe, null), null);
    assert.equal(stripe.pedidos.length, 0);
  });
});

describe("estadoCuotasDe: lo que enseñan la ficha y el portal", () => {
  it("una compra que no era a plazos no tiene estado", () => {
    assert.equal(estadoCuotasDe({}), null);
    assert.equal(estadoCuotasDe(null), null);
    assert.equal(estadoCuotasDe({ instalmentMonths: "no" }), null);
  });

  it("recién comprado: 1 de 3, sin rechazo", () => {
    const e = estadoCuotasDe({ instalmentMonths: 3, cuotasPagadas: 1 });
    assert.equal(e.pagadas, 1);
    assert.equal(e.total, 3);
    assert.equal(e.completo, false);
    assert.equal(e.rechazada, null);
    assert.equal(e.interrumpido, null);
    assert.equal(e.resumen, "1 de 3 cuotas cobradas");
  });

  it("sin contador (una compra anterior al 05/08) cuenta la primera cuota, que es la del checkout", () => {
    assert.equal(estadoCuotasDe({ instalmentMonths: 3 }).pagadas, 1);
  });

  it("el caso real del 07/09: 1 cobrada, la 2.ª rechazada, reintento el 09/09", () => {
    const e = estadoCuotasDe({
      instalmentMonths: 3,
      cuotasPagadas: 1,
      ...rastroDeRechazo(FACTURA_RECHAZADA, AHORA),
      cuotaFallidaMotivo: EXPLICACION_RECHAZO.card_velocity_exceeded,
      cuotaFallidaCodigo: "card_velocity_exceeded",
    });
    assert.equal(e.rechazada.cuota, 2);
    assert.equal(e.rechazada.codigo, "card_velocity_exceeded");
    assert.equal(e.rechazada.importe, 13000);
    assert.equal(e.rechazada.proximoIntento, "2026-09-09T15:03:00.000Z");
    assert.equal(e.rechazada.enlacePago, FACTURA_RECHAZADA.hosted_invoice_url);
    assert.equal(e.completo, false);
  });

  it("la cuota rechazada nunca pasa del total, ni las pagadas", () => {
    const e = estadoCuotasDe({ instalmentMonths: 3, cuotasPagadas: 3, cuotaFallidaAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(e.rechazada.cuota, 3);
    assert.equal(estadoCuotasDe({ instalmentMonths: 3, cuotasPagadas: 7 }).pagadas, 3);
  });

  it("plan completo e interrumpido se distinguen", () => {
    assert.equal(estadoCuotasDe({ instalmentMonths: 3, cuotasPagadas: 3 }).completo, true);
    const e = estadoCuotasDe({ instalmentMonths: 3, cuotasPagadas: 1, planInterrumpidoAt: "2026-09-20T00:00:00.000Z" });
    assert.deepEqual(e.interrumpido, { fecha: "2026-09-20T00:00:00.000Z" });
    assert.equal(e.completo, false);
  });
});

describe("Los textos de la campana", () => {
  const estado = estadoCuotasDe({
    instalmentMonths: 3,
    cuotasPagadas: 1,
    ...rastroDeRechazo(FACTURA_RECHAZADA, AHORA),
    cuotaFallidaMotivo: EXPLICACION_RECHAZO.card_velocity_exceeded,
    cuotaFallidaCodigo: "card_velocity_exceeded",
  });

  it("la cuota rechazada: quién, cuál, por qué, qué hará Stripe y que el bono sigue", () => {
    const a = avisoDeCuotaRechazada({ nombre: "M. Z.", programa: "Acompañamiento mensual", estado });
    assert.match(a.title, /rechazada/);
    assert.match(a.body, /M\. Z\. · Acompañamiento mensual/);
    assert.match(a.body, /cuota 2 de 3/);
    assert.match(a.body, /130,00/);
    assert.match(a.body, /límite/);
    assert.match(a.body, /volverá a intentar el 9 sept, 17:03/);
    assert.match(a.body, /bono sigue activo/);
  });

  it("si Stripe se rindió, lo dice y pide hablar con la paciente", () => {
    const sinReintento = { ...estado, rechazada: { ...estado.rechazada, proximoIntento: null } };
    const a = avisoDeCuotaRechazada({ nombre: "M. Z.", programa: null, estado: sinReintento });
    assert.match(a.body, /no va a reintentarlo/);
    assert.match(a.body, /hablar con la paciente/);
    assert.doesNotMatch(a.body, /volverá a intentar/);
  });

  it("sin nombre ni programa no queda un hueco raro", () => {
    const a = avisoDeCuotaRechazada({ nombre: null, programa: null, estado });
    assert.match(a.body, /^Una paciente: /);
  });

  it("el plan interrumpido: cuántas van, que el bono sigue entero y que decide ella", () => {
    const a = avisoDePlanInterrumpido({ nombre: "M. Z.", programa: "Acompañamiento mensual", estado });
    assert.match(a.title, /sin completar/);
    assert.match(a.body, /1 de 3 cuotas cobradas/);
    assert.match(a.body, /bono sigue entero/);
    assert.match(a.body, /Quitar bono/);
  });
});
