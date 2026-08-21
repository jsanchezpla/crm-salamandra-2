// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-payments-fraccionado-autorizacion.mjs — el pago a plazos y la tarjeta
 * retenida: lo que decide cada función de `lib/payments/fraccionado.js` y de
 * `lib/payments/autorizacion.js` (19/08/2026).
 *
 *   node scripts/_smoke-payments-fraccionado-autorizacion.mjs
 *   node --test-name-pattern="tope" scripts/_smoke-payments-fraccionado-autorizacion.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Son los dos ficheros que mueven el dinero de una paciente sin que nadie mire:
 * el fraccionado cobra la tarjeta mes a mes (una suscripción de Stripe con
 * tope), y la retención aparta un importe al reservar y lo cobra días después,
 * cuando la profesional confirma. Los dos han fallado ya en producción y de la
 * misma manera, EN SILENCIO:
 *
 *   · 07/08/2026: dos suscripciones de tunutrilaura se quedaron sin tope
 *     (`end_behavior: release`, una sola fase): el calendario existía pero no
 *     frenaba, y el reintento del webhook se conformaba con «ya hay calendario».
 *     Desde entonces la pregunta es «¿está el TOPE puesto?», no «¿hay
 *     calendario?», y si falla queda el segundo cerrojo: contar las facturas
 *     pagadas y cancelar al llegar al total.
 *   · 10/08/2026: TODA cuota de la 2ª en adelante salía como «factura sin
 *     PaymentSession» porque la metadata se leía de donde la API ya no la deja
 *     (hoy cuelga de `parent.subscription_details`).
 *   · La caducidad de una retención no está en `charge.capture_before` sino en
 *     `charge.payment_method_details.card.capture_before`: leerla arriba daba
 *     `undefined` y la retención se perdía sin aviso.
 *   · Pedir otra tarjeta con la retención vieja VIVA deja a la paciente con el
 *     doble bloqueado; y un PaymentIntent que Stripe ya no encuentra (claves
 *     rotadas) no es «no lo sé», es «no hay nada que duplicar»: tratarlo como
 *     duda dejaba el botón muerto para siempre.
 *
 * Hasta hoy lo único con prueba ligera eran tres funciones puras
 * (`_smoke-fraccionado.mjs`); el resto solo se podía ver con una cuenta de
 * Stripe de prueba y base de datos. Esta prueba fija lo que DEVUELVE cada
 * función y lo que le PIDE a Stripe: qué fases manda, con qué duración, a quién
 * cancela, con qué clave de idempotencia, qué código de error da a la
 * profesional y qué hace con la fila de cobro.
 *
 * ── CÓMO SE HABLA CON STRIPE SIN STRIPE ────────────────────────────────────
 *
 * Igual que `_smoke-retencion-viva-o-muerta.mjs`: se falsea la LIBRERÍA, no
 * nuestro código. `getStripe` hace `import("stripe")` perezoso, así que aquí se
 * registra un gancho de resolución (node:module) que desvía ese nombre a un
 * módulo de dos líneas cuyo constructor devuelve el Stripe de mentira de la
 * prueba en curso. Todo lo demás —montar el cliente con la clave del tenant,
 * la versión de API clavada, las comprobaciones, los `update` de la fila— es el
 * código de producción tal cual. Ninguna prueba sale a la red: el de mentira
 * apunta cada llamada y contesta lo que diga su guion.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

import {
  topePuesto,
  ponerTopeDeCuotas,
  cuotasPagadasDe,
  frenarSiYaEstaPagado,
  sesionDeFactura,
  suscripcionDeFactura,
} from "../lib/payments/fraccionado.js";
import {
  VENTANA_TARJETA_MS,
  leerCaducidadAutorizacion,
  tenantPuedeAutorizar,
  autorizarPago,
  leerEstadoAutorizacion,
  capturarPago,
  liberarAutorizacion,
} from "../lib/payments/autorizacion.js";
import { STRIPE_API_VERSION } from "../lib/payments/stripeConfig.js";

/* ── El Stripe de mentira ─────────────────────────────────────────────────── */

// El gancho vive en una URL `data:` para que esta prueba sea UN fichero y se
// lance con `node scripts/…` a secas, sin `--import`. Solo intercepta "stripe".
const FABRICA = "__stripeDeMentiraSmokePayments";
const MODULO_FALSO =
  "data:text/javascript," +
  encodeURIComponent(
    `export default class StripeDeMentira { constructor(clave, opciones) { return globalThis.${FABRICA}(clave, opciones); } }`
  );
const GANCHO =
  "data:text/javascript," +
  encodeURIComponent(
    `export async function resolve(e, c, siguiente) { if (e === "stripe") return { url: ${JSON.stringify(MODULO_FALSO)}, shortCircuit: true }; return siguiente(e, c); }`
  );
register(GANCHO);

let fabricaActual = null;
let construccion = null;
globalThis[FABRICA] = (clave, opciones) => {
  construccion = { clave, opciones };
  if (typeof fabricaActual !== "function") {
    throw new Error("esta prueba no preparó un Stripe de mentira (conStripe)");
  }
  return fabricaActual(clave, opciones);
};

/**
 * Un Stripe de mentira con guion: `guion["paymentIntents.retrieve"]` es lo que
 * contesta (valor, función que lo calcula, o Error que lanza). Apunta cada
 * llamada en `llamadas` como `[método, ...argumentos]`.
 */
function stripeDeMentira(guion = {}) {
  const llamadas = [];
  const metodo =
    (nombre) =>
    async (...args) => {
      llamadas.push([nombre, ...args]);
      const r = guion[nombre];
      if (typeof r === "function") return r(...args);
      if (r instanceof Error) throw r;
      return r;
    };
  const grupo = (prefijo, ...nombres) =>
    Object.fromEntries(nombres.map((n) => [n, metodo(`${prefijo}.${n}`)]));
  return {
    llamadas,
    nombres: () => llamadas.map(([n]) => n),
    subscriptions: grupo("subscriptions", "retrieve", "cancel"),
    subscriptionSchedules: grupo("subscriptionSchedules", "retrieve", "create", "update", "cancel"),
    invoices: grupo("invoices", "list"),
    paymentIntents: grupo("paymentIntents", "retrieve", "create", "capture", "cancel"),
  };
}

/** Deja preparado el Stripe que `getStripe` montará en la siguiente llamada. */
function conStripe(guion = {}) {
  const stripe = stripeDeMentira(guion);
  fabricaActual = () => stripe;
  return stripe;
}

function errorDeStripe(message, { code, statusCode } = {}) {
  const e = new Error(message);
  e.code = code;
  e.statusCode = statusCode;
  return e;
}

/* ── Tenants y filas de mentira ───────────────────────────────────────────── */

const CLAVES = {
  stripeSecretKey: "sk_test_de_la_prueba",
  stripeWebhookSecret: "whsec_de_la_prueba",
  stripePublishableKey: "pk_test_de_la_prueba",
};

/** Un tenantContext mínimo: lo único que leen estos módulos es `slug`, `tenant.settings` y `tenantModels`. */
function ctxCon(integrations, { slug = "nutri_laura", tenantModels = {} } = {}) {
  return { slug, tenant: { slug, settings: { integrations } }, tenantModels };
}
const ctxConStripe = (extra) => ctxCon(CLAVES, extra);
const ctxSinStripe = (extra) => ctxCon({}, extra);

/** Una fila de cobro que recuerda cada `update`. */
function filaDeCobro(campos) {
  const fila = {
    actualizaciones: [],
    ...campos,
    async update(cambios) {
      fila.actualizaciones.push(cambios);
      Object.assign(fila, cambios);
      return fila;
    },
  };
  return fila;
}

/** Un modelo PaymentSession que solo sabe crear filas. */
function modeloPaymentSession() {
  const creadas = [];
  return {
    creadas,
    async create(datos) {
      const fila = filaDeCobro({ id: `ps-${creadas.length + 1}`, ...datos });
      creadas.push(fila);
      return fila;
    },
  };
}

/** Ejecuta `fn` tapando stderr y devuelve lo que escribió. */
async function capturandoStderr(fn) {
  const original = process.stderr.write;
  let texto = "";
  process.stderr.write = (trozo) => {
    texto += String(trozo);
    return true;
  };
  try {
    const resultado = await fn();
    return { resultado, texto };
  } finally {
    process.stderr.write = original;
  }
}

beforeEach(() => {
  fabricaActual = null;
  construccion = null;
});

describe("el Stripe de mentira está enchufado (si esto falla, lo demás hablaría con Stripe de verdad)", () => {
  it("import('stripe') da una clase cuyo constructor devuelve lo que prepare la prueba", async () => {
    const { default: Stripe } = await import("stripe");
    fabricaActual = (clave, opciones) => ({ soy: "falso", clave, opciones });
    assert.deepEqual(new Stripe("sk_test_canario", { apiVersion: "x" }), {
      soy: "falso",
      clave: "sk_test_canario",
      opciones: { apiVersion: "x" },
    });
    assert.deepEqual(construccion, { clave: "sk_test_canario", opciones: { apiVersion: "x" } });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * fraccionado.js
 * ═══════════════════════════════════════════════════════════════════════════ */

const FASE_EN_CURSO = {
  items: [{ price: "price_1", quantity: 1 }],
  start_date: 100,
  end_date: 200,
};
const FASE_RESTO = { items: [{ price: "price_1", quantity: 1 }], duration: { interval: "month" } };

describe("topePuesto: existir no es estar puesto", () => {
  it("sin calendario (null, undefined, {}), no hay tope", () => {
    assert.equal(topePuesto(null, 2), false);
    assert.equal(topePuesto(undefined, 2), false);
    assert.equal(topePuesto({}, 2), false);
  });

  it("recién creado por Stripe (release, una fase) NO es tope — el caso real del 07/08/2026", () => {
    assert.equal(topePuesto({ end_behavior: "release", phases: [FASE_EN_CURSO] }, 2), false);
  });

  it("release nunca es tope aunque tenga dos fases: lo que frena el cobro es el end_behavior", () => {
    assert.equal(
      topePuesto({ end_behavior: "release", phases: [FASE_EN_CURSO, FASE_RESTO] }, 2),
      false
    );
    assert.equal(topePuesto({ end_behavior: "release", phases: [FASE_EN_CURSO] }, 0), false);
  });

  it("cancela al final pero con una sola fase y cuotas por delante: le falta la fase que las cubre", () => {
    assert.equal(topePuesto({ end_behavior: "cancel", phases: [FASE_EN_CURSO] }, 2), false);
    assert.equal(topePuesto({ end_behavior: "cancel", phases: [FASE_EN_CURSO] }, 1), false);
    assert.equal(topePuesto({ end_behavior: "cancel" }, 1), false);
  });

  it("cancela y tiene dos fases: puesto (se cuentan fases, no meses)", () => {
    assert.equal(
      topePuesto({ end_behavior: "cancel", phases: [FASE_EN_CURSO, FASE_RESTO] }, 2),
      true
    );
    // Con cinco cuotas por delante sigue bastando con dos fases: la aritmética
    // de los meses no se rehace porque Stripe devuelve las fases ya resueltas.
    assert.equal(
      topePuesto({ end_behavior: "cancel", phases: [FASE_EN_CURSO, FASE_RESTO] }, 5),
      true
    );
  });

  it("plan de una sola cuota (nada por delante): con que cancele al terminar basta, aun sin fases", () => {
    assert.equal(topePuesto({ end_behavior: "cancel", phases: [FASE_EN_CURSO] }, 0), true);
    assert.equal(topePuesto({ end_behavior: "cancel", phases: [] }, 0), true);
    assert.equal(topePuesto({ end_behavior: "cancel" }, 0), true);
    assert.equal(topePuesto({ end_behavior: "cancel" }, -1), true);
  });
});

describe("sesionDeFactura: de quién es esta cuota (la 2ª en adelante)", () => {
  it("la encuentra donde la deja la API de hoy: colgando de parent.subscription_details", () => {
    assert.equal(
      sesionDeFactura({
        parent: { subscription_details: { metadata: { paymentSessionId: "ps-0" } } },
      }),
      "ps-0"
    );
  });

  it("y en los tres sitios viejos: raíz, primera línea, metadata de la factura", () => {
    assert.equal(
      sesionDeFactura({ subscription_details: { metadata: { paymentSessionId: "ps-1" } } }),
      "ps-1"
    );
    assert.equal(
      sesionDeFactura({ lines: { data: [{ metadata: { paymentSessionId: "ps-2" } }] } }),
      "ps-2"
    );
    assert.equal(sesionDeFactura({ metadata: { paymentSessionId: "ps-3" } }), "ps-3");
  });

  it("si está en varios, manda parent; luego la raíz; luego la línea; la factura, la última", () => {
    const todos = {
      parent: { subscription_details: { metadata: { paymentSessionId: "del-parent" } } },
      subscription_details: { metadata: { paymentSessionId: "de-la-raiz" } },
      lines: { data: [{ metadata: { paymentSessionId: "de-la-linea" } }] },
      metadata: { paymentSessionId: "de-la-factura" },
    };
    assert.equal(sesionDeFactura(todos), "del-parent");
    delete todos.parent;
    assert.equal(sesionDeFactura(todos), "de-la-raiz");
    delete todos.subscription_details;
    assert.equal(sesionDeFactura(todos), "de-la-linea");
    delete todos.lines;
    assert.equal(sesionDeFactura(todos), "de-la-factura");
  });

  it("solo mira la PRIMERA línea: una metadata en la segunda no cuenta", () => {
    assert.equal(
      sesionDeFactura({
        lines: { data: [{ metadata: {} }, { metadata: { paymentSessionId: "ps-2b" } }] },
      }),
      null
    );
  });

  it("una factura ajena, una vacía, null o undefined: null, sin reventar", () => {
    assert.equal(sesionDeFactura({ id: "in_x", metadata: {} }), null);
    assert.equal(sesionDeFactura({ parent: { subscription_details: null } }), null);
    assert.equal(sesionDeFactura({ lines: { data: [] } }), null);
    assert.equal(sesionDeFactura({}), null);
    assert.equal(sesionDeFactura(null), null);
    assert.equal(sesionDeFactura(undefined), null);
  });
});

describe("suscripcionDeFactura: la suscripción, venga como venga", () => {
  it("como texto, expandida, o donde la dejó la API nueva (parent), también expandida", () => {
    assert.equal(suscripcionDeFactura({ subscription: "sub_1" }), "sub_1");
    assert.equal(suscripcionDeFactura({ subscription: { id: "sub_2" } }), "sub_2");
    assert.equal(
      suscripcionDeFactura({ parent: { subscription_details: { subscription: "sub_3" } } }),
      "sub_3"
    );
    assert.equal(
      suscripcionDeFactura({ parent: { subscription_details: { subscription: { id: "sub_4" } } } }),
      "sub_4"
    );
  });

  it("la raíz manda sobre parent cuando vienen las dos", () => {
    assert.equal(
      suscripcionDeFactura({
        subscription: "sub_raiz",
        parent: { subscription_details: { subscription: "sub_parent" } },
      }),
      "sub_raiz"
    );
  });

  it("sin suscripción (factura suelta, objeto sin id, null): null", () => {
    assert.equal(suscripcionDeFactura({}), null);
    assert.equal(suscripcionDeFactura({ subscription: null }), null);
    assert.equal(suscripcionDeFactura({ subscription: {} }), null);
    assert.equal(suscripcionDeFactura({ parent: {} }), null);
    assert.equal(suscripcionDeFactura(null), null);
  });
});

/* ── ponerTopeDeCuotas ───────────────────────────────────────────────────── */

/** Una suscripción mensual recién creada por el checkout, sin calendario. */
function suscripcionMensual(extra = {}) {
  return {
    id: "sub_1",
    status: "active",
    schedule: null,
    items: {
      data: [{ price: { id: "price_1", recurring: { interval: "month", interval_count: 1 } } }],
    },
    ...extra,
  };
}

/** El calendario tal como lo devuelve `subscriptionSchedules.create`: release, una fase. */
function calendarioRecienCreado(extra = {}) {
  return {
    id: "sub_sched_1",
    end_behavior: "release",
    phases: [{ items: [{ price: "price_1", quantity: 1 }], start_date: 100, end_date: 200 }],
    ...extra,
  };
}

describe("ponerTopeDeCuotas: sin plan válido no se toca Stripe", () => {
  it("sin suscripción, null", async () => {
    const stripe = conStripe();
    assert.equal(
      await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: null, cuotas: 3 }),
      null
    );
    assert.equal(await ponerTopeDeCuotas(ctxConStripe(), { cuotas: 3 }), null);
    assert.deepEqual(stripe.llamadas, []);
  });

  it("cuotas 0, negativas, decimales, texto o ausentes: null", async () => {
    const stripe = conStripe();
    for (const cuotas of [0, -1, 2.5, "tres", NaN, undefined, null, ""]) {
      assert.equal(
        await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas }),
        null,
        `cuotas=${String(cuotas)}`
      );
    }
    assert.deepEqual(stripe.llamadas, []);
  });
});

describe("ponerTopeDeCuotas: pone el tope a una suscripción recién nacida", () => {
  it("3 cuotas: crea el calendario, repite la fase en curso y añade una de 2 meses con end_behavior cancel", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual(),
      "subscriptionSchedules.create": calendarioRecienCreado(),
      "subscriptionSchedules.update": {},
    });
    const id = await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 });
    assert.equal(id, "sub_sched_1");
    assert.deepEqual(stripe.nombres(), [
      "subscriptions.retrieve",
      "subscriptionSchedules.create",
      "subscriptionSchedules.update",
    ]);
    assert.deepEqual(stripe.llamadas[1], [
      "subscriptionSchedules.create",
      { from_subscription: "sub_1" },
      { idempotencyKey: "tope:sub_1" },
    ]);
    assert.deepEqual(stripe.llamadas[2], [
      "subscriptionSchedules.update",
      "sub_sched_1",
      {
        end_behavior: "cancel",
        phases: [
          { items: [{ price: "price_1", quantity: 1 }], start_date: 100, end_date: 200 },
          {
            items: [{ price: "price_1", quantity: 1 }],
            duration: { interval: "month", interval_count: 2 },
          },
        ],
      },
    ]);
  });

  it("las cuotas cuentan la primera (ya cobrada): con 3 quedan 2 por programar, nunca 3", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual(),
      "subscriptionSchedules.create": calendarioRecienCreado(),
      "subscriptionSchedules.update": {},
    });
    await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 });
    const [, , params] = stripe.llamadas[2];
    assert.equal(params.phases.length, 2);
    assert.equal(params.phases[1].duration.interval_count, 2);
  });

  it("la fase que falta se mide con duration, NO con iterations (lo que rompió el 07/08)", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual(),
      "subscriptionSchedules.create": calendarioRecienCreado(),
      "subscriptionSchedules.update": {},
    });
    await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 6 });
    const [, , params] = stripe.llamadas[2];
    for (const fase of params.phases) assert.equal("iterations" in fase, false);
    assert.deepEqual(params.phases[1].duration, { interval: "month", interval_count: 5 });
  });

  it("un plan de UNA cuota: solo la fase en curso y end_behavior cancel, sin segunda fase", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual(),
      "subscriptionSchedules.create": calendarioRecienCreado(),
      "subscriptionSchedules.update": {},
    });
    const id = await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 1 });
    assert.equal(id, "sub_sched_1");
    const [, , params] = stripe.llamadas[2];
    assert.equal(params.end_behavior, "cancel");
    assert.deepEqual(params.phases, [
      { items: [{ price: "price_1", quantity: 1 }], start_date: 100, end_date: 200 },
    ]);
  });

  it("las cuotas pueden venir como texto («3», de la metadata de Stripe)", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual(),
      "subscriptionSchedules.create": calendarioRecienCreado(),
      "subscriptionSchedules.update": {},
    });
    assert.equal(
      await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: "3" }),
      "sub_sched_1"
    );
    assert.equal(stripe.llamadas[2][2].phases[1].duration.interval_count, 2);
  });

  it("un precio bimensual: 3 cuotas son 4 meses de segunda fase, no 2 (duration cuenta meses, no ciclos)", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual({
        items: {
          data: [
            { price: { id: "price_bi", recurring: { interval: "month", interval_count: 2 } } },
          ],
        },
      }),
      "subscriptionSchedules.create": calendarioRecienCreado(),
      "subscriptionSchedules.update": {},
    });
    await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 });
    assert.deepEqual(stripe.llamadas[2][2].phases[1].duration, {
      interval: "month",
      interval_count: 4,
    });
  });

  it("un precio semanal se mide en semanas; sin recurrencia conocida se da por mensual", async () => {
    const semanal = conStripe({
      "subscriptions.retrieve": suscripcionMensual({
        items: {
          data: [{ price: { id: "price_w", recurring: { interval: "week", interval_count: 1 } } }],
        },
      }),
      "subscriptionSchedules.create": calendarioRecienCreado(),
      "subscriptionSchedules.update": {},
    });
    await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 4 });
    assert.deepEqual(semanal.llamadas[2][2].phases[1].duration, {
      interval: "week",
      interval_count: 3,
    });

    const sinRecurrencia = conStripe({
      "subscriptions.retrieve": suscripcionMensual({
        items: { data: [{ price: { id: "price_x" } }] },
      }),
      "subscriptionSchedules.create": calendarioRecienCreado(),
      "subscriptionSchedules.update": {},
    });
    await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 2 });
    assert.deepEqual(sinRecurrencia.llamadas[2][2].phases[1].duration, {
      interval: "month",
      interval_count: 1,
    });
  });

  it("las líneas de la fase se repiten tal cual: precio expandido → su id, cantidad conservada, sin cantidad → 1", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual(),
      "subscriptionSchedules.create": calendarioRecienCreado({
        phases: [
          {
            items: [{ price: { id: "price_exp" }, quantity: 2 }, { price: "price_txt" }],
            start_date: 10,
            end_date: 20,
          },
        ],
      }),
      "subscriptionSchedules.update": {},
    });
    await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 2 });
    const [, , params] = stripe.llamadas[2];
    const lineas = [
      { price: "price_exp", quantity: 2 },
      { price: "price_txt", quantity: 1 },
    ];
    assert.deepEqual(params.phases[0], { items: lineas, start_date: 10, end_date: 20 });
    assert.deepEqual(params.phases[1].items, lineas);
  });

  it("un calendario que nació sin líneas no se puede topar: lanza y no manda el update", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual(),
      "subscriptionSchedules.create": calendarioRecienCreado({
        phases: [{ items: [], start_date: 1, end_date: 2 }],
      }),
      "subscriptionSchedules.update": {},
    });
    await assert.rejects(
      () => ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 }),
      /sin líneas/
    );
    assert.equal(stripe.nombres().includes("subscriptionSchedules.update"), false);
  });
});

describe("ponerTopeDeCuotas: si ya hay calendario se REUTILIZA, y solo se sale si el tope está puesto", () => {
  it("tope ya puesto (cancel + 2 fases): devuelve su id sin crear ni actualizar nada (idempotente)", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual({ schedule: "sub_sched_ok" }),
      "subscriptionSchedules.retrieve": {
        id: "sub_sched_ok",
        end_behavior: "cancel",
        phases: [FASE_EN_CURSO, FASE_RESTO],
      },
    });
    const id = await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 });
    assert.equal(id, "sub_sched_ok");
    assert.deepEqual(stripe.nombres(), [
      "subscriptions.retrieve",
      "subscriptionSchedules.retrieve",
    ]);
    assert.deepEqual(stripe.llamadas[1], ["subscriptionSchedules.retrieve", "sub_sched_ok"]);
  });

  it("calendario en release (el estado del 07/08): NO se sale, se le pone el tope a ESE calendario sin crear otro", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual({ schedule: "sub_sched_roto" }),
      "subscriptionSchedules.retrieve": calendarioRecienCreado({ id: "sub_sched_roto" }),
      "subscriptionSchedules.update": {},
    });
    const id = await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 });
    assert.equal(id, "sub_sched_roto");
    assert.deepEqual(stripe.nombres(), [
      "subscriptions.retrieve",
      "subscriptionSchedules.retrieve",
      "subscriptionSchedules.update",
    ]);
    const [, idActualizado, params] = stripe.llamadas[2];
    assert.equal(idActualizado, "sub_sched_roto");
    assert.equal(params.end_behavior, "cancel");
    assert.equal(params.phases.length, 2);
  });

  it("calendario con cancel pero sin la fase de las cuotas: también se arregla", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual({ schedule: "sub_sched_medio" }),
      "subscriptionSchedules.retrieve": calendarioRecienCreado({
        id: "sub_sched_medio",
        end_behavior: "cancel",
      }),
      "subscriptionSchedules.update": {},
    });
    await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 });
    assert.equal(stripe.nombres().at(-1), "subscriptionSchedules.update");
  });

  it("el calendario puede venir expandido (objeto con id) en la suscripción", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual({
        schedule: { id: "sub_sched_obj", end_behavior: "release" },
      }),
      "subscriptionSchedules.retrieve": {
        id: "sub_sched_obj",
        end_behavior: "cancel",
        phases: [FASE_EN_CURSO, FASE_RESTO],
      },
    });
    assert.equal(
      await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 2 }),
      "sub_sched_obj"
    );
    assert.deepEqual(stripe.llamadas[1], ["subscriptionSchedules.retrieve", "sub_sched_obj"]);
  });

  it("plan de una cuota con calendario que ya cancela: nada que hacer aunque tenga una sola fase", async () => {
    const stripe = conStripe({
      "subscriptions.retrieve": suscripcionMensual({ schedule: "sub_sched_1c" }),
      "subscriptionSchedules.retrieve": calendarioRecienCreado({
        id: "sub_sched_1c",
        end_behavior: "cancel",
      }),
    });
    assert.equal(
      await ponerTopeDeCuotas(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 1 }),
      "sub_sched_1c"
    );
    assert.equal(stripe.nombres().includes("subscriptionSchedules.update"), false);
  });
});

/* ── cuotasPagadasDe / frenarSiYaEstaPagado ──────────────────────────────── */

const facturas = (...estados) => ({
  data: estados.map((status, i) => ({ id: `in_${i}`, status })),
});

describe("cuotasPagadasDe: se cuentan las cobradas de verdad", () => {
  it("pide a Stripe solo las paid de esa suscripción, la página entera (100), y las cuenta", async () => {
    const stripe = conStripe({ "invoices.list": facturas("paid", "paid", "paid") });
    assert.equal(await cuotasPagadasDe(ctxConStripe(), "sub_1"), 3);
    assert.deepEqual(stripe.llamadas, [
      ["invoices.list", { subscription: "sub_1", status: "paid", limit: 100 }],
    ]);
  });

  it("una factura abierta o rechazada que se colara no es una cuota pagada", async () => {
    conStripe({ "invoices.list": facturas("paid", "open", "uncollectible", "void", "draft") });
    assert.equal(await cuotasPagadasDe(ctxConStripe(), "sub_1"), 1);
  });

  it("sin facturas (lista vacía o sin data): 0", async () => {
    conStripe({ "invoices.list": { data: [] } });
    assert.equal(await cuotasPagadasDe(ctxConStripe(), "sub_1"), 0);
    conStripe({ "invoices.list": {} });
    assert.equal(await cuotasPagadasDe(ctxConStripe(), "sub_1"), 0);
  });
});

describe("frenarSiYaEstaPagado: el segundo cerrojo, por si el calendario no llegó a ponerse", () => {
  it("sin datos del plan (sin suscripción, cuotas 0, texto, null) no pregunta nada a Stripe", async () => {
    const stripe = conStripe();
    assert.equal(
      await frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: null, cuotas: 3 }),
      "sin datos del plan"
    );
    assert.equal(
      await frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 0 }),
      "sin datos del plan"
    );
    assert.equal(
      await frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: null }),
      "sin datos del plan"
    );
    assert.equal(
      await frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: "x" }),
      "sin datos del plan"
    );
    assert.equal(
      await frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 2.5 }),
      "sin datos del plan"
    );
    assert.deepEqual(stripe.llamadas, []);
  });

  it("a mitad de plan (2 de 3) solo informa y no cancela nada", async () => {
    const stripe = conStripe({ "invoices.list": facturas("paid", "paid") });
    assert.equal(
      await frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 }),
      "cuota 2 de 3"
    );
    assert.deepEqual(stripe.nombres(), ["invoices.list"]);
  });

  it("plan completo y la suscripción ya cancelada (lo normal: el calendario hizo su trabajo): no se toca", async () => {
    const stripe = conStripe({
      "invoices.list": facturas("paid", "paid", "paid"),
      "subscriptions.retrieve": { id: "sub_1", status: "canceled", schedule: "sub_sched_1" },
    });
    assert.equal(
      await frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 }),
      "plan completo (3/3), ya estaba cancelado"
    );
    assert.deepEqual(stripe.nombres(), ["invoices.list", "subscriptions.retrieve"]);
  });

  it("plan completo, suscripción viva y CON calendario: cancela el calendario (no la suscripción) y lo deja escrito", async () => {
    const stripe = conStripe({
      "invoices.list": facturas("paid", "paid", "paid"),
      "subscriptions.retrieve": { id: "sub_1", status: "active", schedule: "sub_sched_1" },
      "subscriptionSchedules.cancel": {},
    });
    const { resultado, texto } = await capturandoStderr(() =>
      frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 })
    );
    assert.equal(resultado, "plan completo (3/3) — cancelado");
    assert.deepEqual(stripe.nombres(), [
      "invoices.list",
      "subscriptions.retrieve",
      "subscriptionSchedules.cancel",
    ]);
    assert.deepEqual(stripe.llamadas[2], ["subscriptionSchedules.cancel", "sub_sched_1"]);
    assert.match(texto, /cerrojo de seguridad/);
    assert.match(texto, /nutri_laura/);
    assert.match(texto, /sub_1/);
  });

  it("con el calendario expandido, cancela por su id", async () => {
    const stripe = conStripe({
      "invoices.list": facturas("paid", "paid"),
      "subscriptions.retrieve": {
        id: "sub_1",
        status: "active",
        schedule: { id: "sub_sched_obj" },
      },
      "subscriptionSchedules.cancel": {},
    });
    await capturandoStderr(() =>
      frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 2 })
    );
    assert.deepEqual(stripe.llamadas[2], ["subscriptionSchedules.cancel", "sub_sched_obj"]);
  });

  it("plan completo SIN calendario (la llamada falló el día del checkout): cancela la suscripción", async () => {
    const stripe = conStripe({
      "invoices.list": facturas("paid", "paid", "paid"),
      "subscriptions.retrieve": { id: "sub_1", status: "active", schedule: null },
      "subscriptions.cancel": {},
    });
    const { resultado } = await capturandoStderr(() =>
      frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 })
    );
    assert.equal(resultado, "plan completo (3/3) — cancelado");
    assert.deepEqual(stripe.llamadas[2], ["subscriptions.cancel", "sub_1"]);
    assert.equal(stripe.nombres().includes("subscriptionSchedules.cancel"), false);
  });

  it("si ya se cobró de MÁS (4 de 3), también frena: el recuento es >=, no ==", async () => {
    const stripe = conStripe({
      "invoices.list": facturas("paid", "paid", "paid", "paid"),
      "subscriptions.retrieve": { id: "sub_1", status: "past_due", schedule: null },
      "subscriptions.cancel": {},
    });
    const { resultado } = await capturandoStderr(() =>
      frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: 3 })
    );
    assert.equal(resultado, "plan completo (4/3) — cancelado");
    assert.equal(stripe.nombres().at(-1), "subscriptions.cancel");
  });

  it("las cuotas como texto («3») valen igual que el número", async () => {
    conStripe({ "invoices.list": facturas("paid") });
    assert.equal(
      await frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_1", cuotas: "3" }),
      "cuota 1 de 3"
    );
  });

  // Este borde existió al revés (arreglado el 21/08/2026): el recuento pedía
  // `limit: 24` «porque un fraccionado real son 3-6», pero el modelo admite
  // planes de hasta 36 meses (`EventType.instalmentMonths`, min 2 max 36, y la
  // API de tipos de cita valida lo mismo: lo mete un admin desde la pantalla).
  // Con 25 cuotas o más Y el calendario sin poner, este segundo cerrojo no
  // llegaba nunca al total: contestaba «cuota 24 de 25» en cada webhook y no
  // cancelaba, o sea que se le seguía cobrando a la paciente pasado el plan.
  // Ahora se pide la página entera de Stripe (100), que cubre el máximo del
  // modelo con margen. Lo que esto fija es el `limit` que se le pide a Stripe:
  // si alguien vuelve a bajarlo, se pone rojo. Lo que NO puede ver es el máximo
  // del modelo (leer `EventType` arrastraría Sequelize y esta prueba dejaría de
  // ser ligera): el 36 de aquí abajo es una copia a mano, así que subir ese
  // máximo por encima de 100 —que obligaría a paginar— no lo canta nadie. Está
  // dicho también en `cuotasPagadasDe`.
  it("con un plan de más de 24 cuotas y sin calendario, el recuento llega al total y SÍ frena", async () => {
    const treintaPagadas = Array.from({ length: 30 }, (_, i) => ({
      id: `in_${i}`,
      status: "paid",
    }));
    // Un Stripe que respeta el `limit`, como el de verdad.
    const paginado = ({ limit }) => ({ data: treintaPagadas.slice(0, limit) });

    const stripe = conStripe({
      "invoices.list": paginado,
      "subscriptions.retrieve": { id: "sub_30", status: "active", schedule: null },
      "subscriptions.cancel": {},
    });
    const { resultado } = await capturandoStderr(() =>
      frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_30", cuotas: 25 })
    );
    assert.equal(resultado, "plan completo (30/25) — cancelado");
    assert.deepEqual(stripe.llamadas[2], ["subscriptions.cancel", "sub_30"]);

    // A mitad de un plan del máximo del modelo (36) informa con el número de
    // verdad, 30, no con el del límite.
    conStripe({ "invoices.list": paginado });
    assert.equal(
      await frenarSiYaEstaPagado(ctxConStripe(), { subscriptionId: "sub_30", cuotas: 36 }),
      "cuota 30 de 36"
    );

    // Y lo que se le pide a Stripe es la página entera: 100, no 24.
    const contando = conStripe({ "invoices.list": paginado });
    assert.equal(await cuotasPagadasDe(ctxConStripe(), "sub_30"), 30);
    assert.deepEqual(contando.llamadas, [
      ["invoices.list", { subscription: "sub_30", status: "paid", limit: 100 }],
    ]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * autorizacion.js
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("VENTANA_TARJETA_MS: el reloj del HUECO, no el del dinero", () => {
  it("son 20 minutos exactos", () => {
    assert.equal(VENTANA_TARJETA_MS, 20 * 60 * 1000);
    assert.equal(VENTANA_TARJETA_MS, 1_200_000);
  });
});

describe("leerCaducidadAutorizacion: dónde vive capture_before, que no es donde parece", () => {
  // En SEGUNDOS, como lo da Stripe; escrito en UTC para que dé igual la zona horaria.
  const EPOCH = Date.UTC(2026, 7, 26, 10, 0, 0) / 1000;

  it("lo lee de payment_method_details.card.capture_before y lo pasa de segundos a Date", () => {
    const caduca = leerCaducidadAutorizacion({
      payment_method_details: { card: { capture_before: EPOCH } },
    });
    assert.ok(caduca instanceof Date);
    assert.equal(caduca.getTime(), EPOCH * 1000);
    assert.equal(caduca.toISOString(), "2026-08-26T10:00:00.000Z");
  });

  it("un charge.capture_before en la raíz (la ruta equivocada de la primera versión) NO cuenta: null", () => {
    assert.equal(leerCaducidadAutorizacion({ capture_before: EPOCH }), null);
    assert.equal(
      leerCaducidadAutorizacion({ capture_before: EPOCH, payment_method_details: { card: {} } }),
      null
    );
  });

  it("sin cargo, sin tarjeta o sin el campo: null (nunca se inventa un plazo)", () => {
    assert.equal(leerCaducidadAutorizacion(null), null);
    assert.equal(leerCaducidadAutorizacion(undefined), null);
    assert.equal(leerCaducidadAutorizacion({}), null);
    assert.equal(leerCaducidadAutorizacion({ payment_method_details: {} }), null);
    assert.equal(leerCaducidadAutorizacion({ payment_method_details: { sepa_debit: {} } }), null);
    assert.equal(
      leerCaducidadAutorizacion({ payment_method_details: { card: { capture_before: null } } }),
      null
    );
  });

  it("si no es un número finito (texto, NaN, Infinity): null, aunque el texto parezca un epoch", () => {
    assert.equal(
      leerCaducidadAutorizacion({
        payment_method_details: { card: { capture_before: String(EPOCH) } },
      }),
      null
    );
    assert.equal(
      leerCaducidadAutorizacion({ payment_method_details: { card: { capture_before: NaN } } }),
      null
    );
    assert.equal(
      leerCaducidadAutorizacion({ payment_method_details: { card: { capture_before: Infinity } } }),
      null
    );
  });
});

describe("tenantPuedeAutorizar: hacen falta LAS TRES claves, no dos", () => {
  it("con secreta, webhook y publicable: sí", () => {
    assert.equal(tenantPuedeAutorizar(ctxConStripe()), true);
  });

  it("sin la publicable no se puede pintar el formulario: no (aunque el checkout redirigido sí podría cobrar)", () => {
    assert.equal(
      tenantPuedeAutorizar(
        ctxCon({ stripeSecretKey: "sk_test_x", stripeWebhookSecret: "whsec_x" })
      ),
      false
    );
    assert.equal(
      tenantPuedeAutorizar(ctxCon({ ...CLAVES, stripePublishableKey: "   " })),
      false,
      "una publicable en blanco cuenta como ausente"
    );
  });

  it("sin el secreto del webhook no está configurado (el cobro se quedaría sin confirmar): no", () => {
    assert.equal(
      tenantPuedeAutorizar(
        ctxCon({ stripeSecretKey: "sk_test_x", stripePublishableKey: "pk_test_x" })
      ),
      false
    );
  });

  it("sin la secreta, sin integraciones, sin settings o sin tenant: no", () => {
    assert.equal(
      tenantPuedeAutorizar(
        ctxCon({ stripeWebhookSecret: "whsec_x", stripePublishableKey: "pk_test_x" })
      ),
      false
    );
    assert.equal(tenantPuedeAutorizar(ctxSinStripe()), false);
    assert.equal(tenantPuedeAutorizar({ slug: "x", tenant: { settings: {} } }), false);
    assert.equal(tenantPuedeAutorizar({ slug: "x" }), false);
    assert.equal(tenantPuedeAutorizar(null), false);
  });
});

/* ── autorizarPago ───────────────────────────────────────────────────────── */

const OPTS_OK = {
  entityType: "booking",
  entityId: "b-1",
  amount: 4550,
  description: "Sesión de nutrición",
  customerEmail: "paciente@example.com",
  metadata: { origen: "widget" },
};

describe("autorizarPago: lo que frena ANTES de tocar nada", () => {
  it("en las cuatro demos públicas está cortado (403), aun con todo bien y antes de validar nada", async () => {
    for (const slug of ["demo", "demo_clinica", "demo_nutricion", "demo_agencia"]) {
      const modelo = modeloPaymentSession();
      const stripe = conStripe();
      await assert.rejects(
        () =>
          autorizarPago(ctxConStripe({ slug, tenantModels: { PaymentSession: modelo } }), OPTS_OK),
        (e) => e.statusCode === 403 && /desactivada en la demo/.test(e.message),
        slug
      );
      // Ni siquiera con datos inválidos se llega a la validación: manda el guard.
      await assert.rejects(
        () => autorizarPago(ctxConStripe({ slug }), {}),
        (e) => e.statusCode === 403,
        `${slug} con opts vacíos`
      );
      assert.deepEqual(modelo.creadas, []);
      assert.deepEqual(stripe.llamadas, []);
    }
  });

  it("un cliente que no es demo (p. ej. «demo_de_verdad») no está cortado por el guard", async () => {
    await assert.rejects(
      () => autorizarPago(ctxSinStripe({ slug: "demo_de_verdad" }), OPTS_OK),
      (e) => e.statusCode === 422 && /cobro online/.test(e.message)
    );
  });

  it("sin entityType o sin entityId: 422", async () => {
    for (const opts of [
      { ...OPTS_OK, entityType: undefined },
      { ...OPTS_OK, entityType: "" },
      { ...OPTS_OK, entityId: null },
      undefined,
    ]) {
      await assert.rejects(
        () => autorizarPago(ctxConStripe(), opts),
        (e) => e.statusCode === 422 && /entityType y entityId/.test(e.message)
      );
    }
  });

  it("el importe tiene que ser un entero de céntimos mayor que cero: 0, negativo, decimal, texto, null → 422", async () => {
    for (const amount of [0, -100, 45.5, "4550", null, undefined, NaN]) {
      await assert.rejects(
        () => autorizarPago(ctxConStripe(), { ...OPTS_OK, amount }),
        (e) => e.statusCode === 422 && /entero de céntimos/.test(e.message),
        `amount=${String(amount)}`
      );
    }
  });

  it("sin Stripe configurado: 422 «no tiene configurado el cobro online», y no se crea fila", async () => {
    const modelo = modeloPaymentSession();
    await assert.rejects(
      () => autorizarPago(ctxSinStripe({ tenantModels: { PaymentSession: modelo } }), OPTS_OK),
      (e) => e.statusCode === 422 && /cobro online/.test(e.message)
    );
    assert.deepEqual(modelo.creadas, []);
  });

  it("con secretos pero sin clave publicable: 422 «Falta la clave publicable», y no se crea fila", async () => {
    const modelo = modeloPaymentSession();
    const ctx = ctxCon(
      { stripeSecretKey: "sk_test_x", stripeWebhookSecret: "whsec_x" },
      { tenantModels: { PaymentSession: modelo } }
    );
    await assert.rejects(
      () => autorizarPago(ctx, OPTS_OK),
      (e) => e.statusCode === 422 && /clave publicable/.test(e.message)
    );
    assert.deepEqual(modelo.creadas, []);
  });
});

describe("autorizarPago: la retención bien hecha", () => {
  it("crea la fila PRIMERO (authorizing), luego el PaymentIntent con captura manual y solo tarjeta, y devuelve el clientSecret", async () => {
    const modelo = modeloPaymentSession();
    const stripe = conStripe({
      "paymentIntents.create": {
        id: "pi_nuevo",
        client_secret: "pi_nuevo_secret",
        status: "requires_payment_method",
      },
    });
    const ctx = ctxConStripe({ tenantModels: { PaymentSession: modelo } });

    const r = await autorizarPago(ctx, OPTS_OK);

    assert.equal(modelo.creadas.length, 1);
    const fila = modelo.creadas[0];
    assert.equal(r.paymentSession, fila);
    assert.equal(r.clientSecret, "pi_nuevo_secret");
    assert.equal(r.publishableKey, "pk_test_de_la_prueba");

    // La fila, tal como nace.
    const { actualizaciones, update, ...nacida } = fila;
    assert.equal(typeof update, "function");
    assert.deepEqual(nacida, {
      id: "ps-1",
      entityType: "booking",
      entityId: "b-1",
      amount: 4550,
      currency: "eur",
      description: "Sesión de nutrición",
      status: "authorizing",
      metadata: { origen: "widget" },
      stripePaymentIntentId: "pi_nuevo",
    });
    assert.deepEqual(actualizaciones, [{ stripePaymentIntentId: "pi_nuevo" }]);

    // Lo que se le pide a Stripe.
    assert.deepEqual(stripe.llamadas, [
      [
        "paymentIntents.create",
        {
          amount: 4550,
          currency: "eur",
          capture_method: "manual",
          payment_method_types: ["card"],
          description: "Sesión de nutrición",
          receipt_email: "paciente@example.com",
          metadata: {
            paymentSessionId: "ps-1",
            tenantSlug: "nutri_laura",
            entityType: "booking",
            entityId: "b-1",
          },
        },
        { idempotencyKey: "auth:ps-1" },
      ],
    ]);
  });

  it("el cliente de Stripe se monta con la clave DEL TENANT y la versión de API clavada", async () => {
    const modelo = modeloPaymentSession();
    conStripe({ "paymentIntents.create": { id: "pi_x", client_secret: "s" } });
    await autorizarPago(ctxConStripe({ tenantModels: { PaymentSession: modelo } }), OPTS_OK);
    assert.deepEqual(construccion, {
      clave: "sk_test_de_la_prueba",
      opciones: { apiVersion: STRIPE_API_VERSION },
    });
  });

  it("sin descripción ni correo: la fila guarda null y a Stripe no se le mandan esos campos; la moneda por defecto es eur", async () => {
    const modelo = modeloPaymentSession();
    const stripe = conStripe({ "paymentIntents.create": { id: "pi_x", client_secret: "s" } });
    await autorizarPago(ctxConStripe({ tenantModels: { PaymentSession: modelo } }), {
      entityType: "order",
      entityId: "o-1",
      amount: 100,
    });
    assert.equal(modelo.creadas[0].description, null);
    assert.equal(modelo.creadas[0].currency, "eur");
    assert.deepEqual(modelo.creadas[0].metadata, {});
    const [, params] = stripe.llamadas[0];
    assert.equal(params.description, undefined);
    assert.equal(params.receipt_email, undefined);
    assert.equal(params.currency, "eur");
  });

  it("otra moneda pasa tal cual a la fila y a Stripe", async () => {
    const modelo = modeloPaymentSession();
    const stripe = conStripe({ "paymentIntents.create": { id: "pi_x", client_secret: "s" } });
    await autorizarPago(ctxConStripe({ tenantModels: { PaymentSession: modelo } }), {
      ...OPTS_OK,
      currency: "usd",
    });
    assert.equal(modelo.creadas[0].currency, "usd");
    assert.equal(stripe.llamadas[0][1].currency, "usd");
  });

  it("si Stripe falla al crear el intent: la fila queda failed con el error recortado a 300 letras, y el error se relanza", async () => {
    const modelo = modeloPaymentSession();
    const largo = "x".repeat(400);
    conStripe({ "paymentIntents.create": new Error(largo) });
    await assert.rejects(
      () => autorizarPago(ctxConStripe({ tenantModels: { PaymentSession: modelo } }), OPTS_OK),
      (e) => e.message === largo
    );
    const fila = modelo.creadas[0];
    assert.equal(fila.status, "failed");
    assert.equal(fila.metadata.origen, "widget");
    assert.equal(fila.metadata.error, "x".repeat(300));
    assert.equal(fila.stripePaymentIntentId, undefined);
  });
});

/* ── leerEstadoAutorizacion ──────────────────────────────────────────────── */

describe("leerEstadoAutorizacion: ¿sigue viva la retención? (una lectura, nunca lanza)", () => {
  it("sin fila o sin PaymentIntent: no hay nada que pueda estar vivo, y eso SÍ se sabe", async () => {
    const esperado = { viva: false, estado: null, sePudoPreguntar: true };
    assert.deepEqual(await leerEstadoAutorizacion(ctxConStripe(), null), esperado);
    assert.deepEqual(await leerEstadoAutorizacion(ctxConStripe(), {}), esperado);
    assert.deepEqual(
      await leerEstadoAutorizacion(ctxConStripe(), { stripePaymentIntentId: null }),
      esperado
    );
  });

  it("requires_capture → VIVA: hay dinero apartado y pedir otra tarjeta lo duplicaría", async () => {
    conStripe({ "paymentIntents.retrieve": { id: "pi_1", status: "requires_capture" } });
    assert.deepEqual(
      await leerEstadoAutorizacion(ctxConStripe(), { stripePaymentIntentId: "pi_1" }),
      {
        viva: true,
        estado: "requires_capture",
        sePudoPreguntar: true,
      }
    );
  });

  it("canceled (muerta), succeeded (cobrada) o sin tarjeta aún: no viva, y se sabe", async () => {
    for (const status of [
      "canceled",
      "succeeded",
      "requires_payment_method",
      "processing",
      "requires_action",
    ]) {
      conStripe({ "paymentIntents.retrieve": { id: "pi_1", status } });
      assert.deepEqual(
        await leerEstadoAutorizacion(ctxConStripe(), { stripePaymentIntentId: "pi_1" }),
        { viva: false, estado: status, sePudoPreguntar: true },
        status
      );
    }
  });

  it("Stripe no lo encuentra (resource_missing o 404): «inexistente», y NO es una duda — claves rotadas, no hay nada que duplicar", async () => {
    conStripe({
      "paymentIntents.retrieve": errorDeStripe("No such payment_intent", {
        code: "resource_missing",
        statusCode: 404,
      }),
    });
    assert.deepEqual(
      await leerEstadoAutorizacion(ctxConStripe(), { stripePaymentIntentId: "pi_viejo" }),
      {
        viva: false,
        estado: "inexistente",
        sePudoPreguntar: true,
      }
    );
    conStripe({ "paymentIntents.retrieve": errorDeStripe("gone", { statusCode: 404 }) });
    assert.equal(
      (await leerEstadoAutorizacion(ctxConStripe(), { stripePaymentIntentId: "pi_viejo" })).estado,
      "inexistente"
    );
  });

  it("Stripe no contesta (red caída): NO SE SABE (sePudoPreguntar false), que el llamante debe tratar como peligro", async () => {
    conStripe({
      "paymentIntents.retrieve": errorDeStripe("connect ETIMEDOUT", { code: "ETIMEDOUT" }),
    });
    const { resultado, texto } = await capturandoStderr(() =>
      leerEstadoAutorizacion(ctxConStripe(), { stripePaymentIntentId: "pi_1" })
    );
    assert.deepEqual(resultado, { viva: false, estado: null, sePudoPreguntar: false });
    assert.match(texto, /no se pudo leer la retención pi_1/);
  });

  it("sin Stripe configurado en el tenant: tampoco se sabe", async () => {
    assert.deepEqual(
      await leerEstadoAutorizacion(ctxSinStripe(), { stripePaymentIntentId: "pi_1" }),
      {
        viva: false,
        estado: null,
        sePudoPreguntar: false,
      }
    );
  });

  it("si montar el cliente de Stripe revienta (clave mal formada), se queda dentro: no lanza, «no se sabe»", async () => {
    fabricaActual = () => {
      throw new Error("clave mal formada");
    };
    const { resultado } = await capturandoStderr(() =>
      leerEstadoAutorizacion(ctxConStripe(), { stripePaymentIntentId: "pi_1" })
    );
    assert.deepEqual(resultado, { viva: false, estado: null, sePudoPreguntar: false });
  });

  it("es una lectura: en la demo también contesta (no lleva el guard de dinero)", async () => {
    conStripe({ "paymentIntents.retrieve": { id: "pi_1", status: "requires_capture" } });
    const r = await leerEstadoAutorizacion(ctxConStripe({ slug: "demo" }), {
      stripePaymentIntentId: "pi_1",
    });
    assert.equal(r.viva, true);
  });
});

/* ── capturarPago ────────────────────────────────────────────────────────── */

const filaRetenida = (extra = {}) =>
  filaDeCobro({
    id: "ps-7",
    amount: 4550,
    status: "authorized",
    stripePaymentIntentId: "pi_7",
    metadata: { origen: "widget" },
    ...extra,
  });

describe("capturarPago: el cobro de verdad, con la verdad de Stripe y no la de nuestra fila", () => {
  it("en la demo está cortado (403) antes de mirar nada", async () => {
    const stripe = conStripe();
    await assert.rejects(
      () => capturarPago(ctxConStripe({ slug: "demo_nutricion" }), filaRetenida()),
      (e) => e.statusCode === 403
    );
    assert.deepEqual(stripe.llamadas, []);
  });

  it("sin PaymentIntent en la fila: SIN_RETENCION, sin preguntar a Stripe", async () => {
    const stripe = conStripe();
    await assert.rejects(
      () => capturarPago(ctxConStripe(), filaRetenida({ stripePaymentIntentId: null })),
      (e) => e.code === "SIN_RETENCION"
    );
    await assert.rejects(
      () => capturarPago(ctxConStripe(), null),
      (e) => e.code === "SIN_RETENCION"
    );
    assert.deepEqual(stripe.llamadas, []);
  });

  it("sin Stripe configurado: 422", async () => {
    await assert.rejects(
      () => capturarPago(ctxSinStripe(), filaRetenida()),
      (e) => e.statusCode === 422 && /no está configurado/.test(e.message)
    );
  });

  it("ya cobrado en Stripe (succeeded): YA_CAPTURADO con el intent, y no se captura otra vez", async () => {
    const actual = { id: "pi_7", status: "succeeded", amount_received: 4550 };
    const stripe = conStripe({ "paymentIntents.retrieve": actual });
    const fila = filaRetenida();
    await assert.rejects(
      () => capturarPago(ctxConStripe(), fila),
      (e) => e.code === "YA_CAPTURADO" && e.intent === actual
    );
    assert.deepEqual(stripe.nombres(), ["paymentIntents.retrieve"]);
    assert.deepEqual(fila.actualizaciones, []);
  });

  it("cancelado (caducó sola o desde el panel): CADUCADA — hay que volver a pedir la tarjeta", async () => {
    const stripe = conStripe({ "paymentIntents.retrieve": { id: "pi_7", status: "canceled" } });
    await assert.rejects(
      () => capturarPago(ctxConStripe(), filaRetenida()),
      (e) => e.code === "CADUCADA" && /volver a pedir la tarjeta/.test(e.message)
    );
    assert.deepEqual(stripe.nombres(), ["paymentIntents.retrieve"]);
  });

  it("cualquier otro estado (nunca llegó a retenerse): SIN_RETENCION con el estado dentro", async () => {
    for (const status of [
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "processing",
    ]) {
      const stripe = conStripe({ "paymentIntents.retrieve": { id: "pi_7", status } });
      await assert.rejects(
        () => capturarPago(ctxConStripe(), filaRetenida()),
        (e) => e.code === "SIN_RETENCION" && e.estado === status && e.message.includes(status),
        status
      );
      assert.equal(stripe.nombres().includes("paymentIntents.capture"), false);
    }
  });

  it("requires_capture: captura SIN amount_to_capture (lo autorizado, entero), con idempotencia por fila, y la fila pasa a paid", async () => {
    const stripe = conStripe({
      "paymentIntents.retrieve": { id: "pi_7", status: "requires_capture" },
      "paymentIntents.capture": { id: "pi_7", status: "succeeded", amount_received: 4550 },
    });
    const fila = filaRetenida();
    const antes = Date.now();
    const r = await capturarPago(ctxConStripe(), fila, { porQuien: "laura" });

    assert.deepEqual(stripe.llamadas, [
      ["paymentIntents.retrieve", "pi_7"],
      ["paymentIntents.capture", "pi_7", {}, { idempotencyKey: "capture:ps-7" }],
    ]);
    assert.equal(r.importe, 4550);
    assert.equal(r.intent.status, "succeeded");

    assert.equal(fila.actualizaciones.length, 1);
    const cambios = fila.actualizaciones[0];
    assert.equal(cambios.status, "paid");
    assert.ok(cambios.paidAt instanceof Date);
    assert.ok(cambios.paidAt.getTime() >= antes && cambios.paidAt.getTime() <= Date.now());
    assert.deepEqual(cambios.metadata, { origen: "widget", capturadoPor: "laura" });
  });

  it("el importe es lo que Stripe dice haber recibido; si no lo dice, el de la fila", async () => {
    conStripe({
      "paymentIntents.retrieve": { id: "pi_7", status: "requires_capture" },
      "paymentIntents.capture": { id: "pi_7", status: "succeeded", amount_received: 4000 },
    });
    assert.equal((await capturarPago(ctxConStripe(), filaRetenida())).importe, 4000);

    conStripe({
      "paymentIntents.retrieve": { id: "pi_7", status: "requires_capture" },
      "paymentIntents.capture": { id: "pi_7", status: "succeeded" },
    });
    assert.equal((await capturarPago(ctxConStripe(), filaRetenida())).importe, 4550);
  });

  it("sin quién ni metadata previa: capturadoPor null y no revienta", async () => {
    conStripe({
      "paymentIntents.retrieve": { id: "pi_7", status: "requires_capture" },
      "paymentIntents.capture": { id: "pi_7", status: "succeeded", amount_received: 4550 },
    });
    const fila = filaRetenida({ metadata: null });
    await capturarPago(ctxConStripe(), fila);
    assert.deepEqual(fila.actualizaciones[0].metadata, { capturadoPor: null });
  });

  it("el banco dice que no al capturar: RECHAZADA con el código de Stripe aparte, y la fila NO cambia", async () => {
    conStripe({
      "paymentIntents.retrieve": { id: "pi_7", status: "requires_capture" },
      "paymentIntents.capture": errorDeStripe("Your card was declined.", { code: "card_declined" }),
    });
    const fila = filaRetenida();
    await assert.rejects(
      () => capturarPago(ctxConStripe(), fila),
      (e) =>
        e.code === "RECHAZADA" &&
        e.stripeCode === "card_declined" &&
        e.message === "Your card was declined."
    );
    assert.deepEqual(fila.actualizaciones, []);
    assert.equal(fila.status, "authorized");
  });

  it("un rechazo sin mensaje ni código: texto genérico y stripeCode null", async () => {
    conStripe({
      "paymentIntents.retrieve": { id: "pi_7", status: "requires_capture" },
      "paymentIntents.capture": new Error(""),
    });
    await assert.rejects(
      () => capturarPago(ctxConStripe(), filaRetenida()),
      (e) =>
        e.code === "RECHAZADA" && e.message === "El banco rechazó el cobro" && e.stripeCode === null
    );
  });
});

/* ── liberarAutorizacion ─────────────────────────────────────────────────── */

describe("liberarAutorizacion: soltar el dinero sin cobrar, sin drama si ya estaba suelto", () => {
  it("en la demo está cortado (403)", async () => {
    await assert.rejects(
      () => liberarAutorizacion(ctxConStripe({ slug: "demo_agencia" }), filaRetenida()),
      (e) => e.statusCode === 403
    );
  });

  it("sin PaymentIntent: no hay nada que soltar", async () => {
    const stripe = conStripe();
    assert.deepEqual(
      await liberarAutorizacion(ctxConStripe(), filaRetenida({ stripePaymentIntentId: null })),
      {
        liberada: false,
        motivo: "sin retención",
      }
    );
    assert.deepEqual(await liberarAutorizacion(ctxConStripe(), null), {
      liberada: false,
      motivo: "sin retención",
    });
    assert.deepEqual(stripe.llamadas, []);
  });

  it("sin Stripe configurado: tampoco, y lo dice", async () => {
    assert.deepEqual(await liberarAutorizacion(ctxSinStripe(), filaRetenida()), {
      liberada: false,
      motivo: "Stripe no configurado",
    });
  });

  it("ya estaba cancelada en Stripe (caducó sola): no lanza, deja la fila en void y lo dice", async () => {
    const stripe = conStripe({ "paymentIntents.retrieve": { id: "pi_7", status: "canceled" } });
    const fila = filaRetenida();
    assert.deepEqual(await liberarAutorizacion(ctxConStripe(), fila), {
      liberada: false,
      motivo: "ya estaba liberada",
    });
    assert.deepEqual(fila.actualizaciones, [{ status: "void" }]);
    assert.deepEqual(stripe.nombres(), ["paymentIntents.retrieve"]);
  });

  it("ya se cobró: eso no se suelta, se devuelve → YA_CAPTURADO, y la fila no se toca", async () => {
    const stripe = conStripe({ "paymentIntents.retrieve": { id: "pi_7", status: "succeeded" } });
    const fila = filaRetenida();
    await assert.rejects(
      () => liberarAutorizacion(ctxConStripe(), fila),
      (e) => e.code === "YA_CAPTURADO"
    );
    assert.deepEqual(fila.actualizaciones, []);
    assert.equal(stripe.nombres().includes("paymentIntents.cancel"), false);
  });

  it("retención viva: cancela el intent (abandoned por defecto, idempotente por fila), la fila pasa a void con el motivo", async () => {
    const stripe = conStripe({
      "paymentIntents.retrieve": { id: "pi_7", status: "requires_capture" },
      "paymentIntents.cancel": { id: "pi_7", status: "canceled" },
    });
    const fila = filaRetenida();
    assert.deepEqual(
      await liberarAutorizacion(ctxConStripe(), fila, { motivo: "cita rechazada" }),
      { liberada: true }
    );
    assert.deepEqual(stripe.llamadas, [
      ["paymentIntents.retrieve", "pi_7"],
      [
        "paymentIntents.cancel",
        "pi_7",
        { cancellation_reason: "abandoned" },
        { idempotencyKey: "void:ps-7" },
      ],
    ]);
    assert.deepEqual(fila.actualizaciones, [
      { status: "void", metadata: { origen: "widget", motivoLiberacion: "cita rechazada" } },
    ]);
  });

  it("la razón para Stripe se puede elegir; sin motivo ni metadata previa queda motivoLiberacion null", async () => {
    const stripe = conStripe({
      "paymentIntents.retrieve": { id: "pi_7", status: "requires_capture" },
      "paymentIntents.cancel": {},
    });
    const fila = filaRetenida({ metadata: null });
    await liberarAutorizacion(ctxConStripe(), fila, { razonStripe: "requested_by_customer" });
    assert.deepEqual(stripe.llamadas[1][2], { cancellation_reason: "requested_by_customer" });
    assert.deepEqual(fila.actualizaciones[0].metadata, { motivoLiberacion: null });
  });

  it("un intent que nunca llegó a tener tarjeta (requires_payment_method) también se cancela: no hay dinero, pero se cierra", async () => {
    const stripe = conStripe({
      "paymentIntents.retrieve": { id: "pi_7", status: "requires_payment_method" },
      "paymentIntents.cancel": {},
    });
    assert.deepEqual(await liberarAutorizacion(ctxConStripe(), filaRetenida()), { liberada: true });
    assert.equal(stripe.nombres().at(-1), "paymentIntents.cancel");
  });
});
