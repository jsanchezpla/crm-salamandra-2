// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-ia-respuesta.mjs — que la IA que falla lo DIGA, y que el JSON del
 * modelo se encuentre aunque venga envuelto (01/09/2026).
 *
 *   node scripts/_smoke-ia-respuesta.mjs
 *
 * Prueba las tres piezas que nacieron del «la IA de Proyectos no funciona»
 * (Rodrigo, 01/09/2026), que eran tres formas distintas de que un fallo
 * perfectamente explicable saliera por pantalla como «Error interno del
 * servidor» o como «la IA no ha devuelto un plan válido»:
 *
 *   · `lib/ai/errorLegible.js` — el error del SDK de Anthropic traducido a una
 *     frase que dice qué pasa y dónde se toca. Sin esto, clave caducada,
 *     modelo retirado, límite de la cuenta y saturación se veían todos igual.
 *   · `lib/projects/ai/parsePlan.js` (`extraerJson`) — el JSON que hay DENTRO
 *     de lo que escribe el modelo. Se le pide «solo JSON» y casi siempre
 *     obedece; el «casi» tiraba a la basura respuestas perfectamente válidas.
 *   · `lib/ai/respuestaConLatido.js` — la respuesta que empieza a viajar antes
 *     de terminar el trabajo, para que ningún proxy la dé por muerta. Aquí se
 *     comprueba lo único que importa de verdad: que lo que llega SIGUE siendo
 *     JSON parseable, latido incluido, y que el fallo viaja dentro del cuerpo
 *     (porque el código HTTP ya se mandó y no se puede cambiar).
 *
 * Ninguna de las tres llama a Anthropic: son funciones puras y un `ReadableStream`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./_abrir-lib-hooks.mjs", import.meta.url));
const { esErrorDeIa, mensajeDeErrorIa, esFalloDeSaldo, esFalloDeCuenta } = await import(
  "../lib/ai/errorLegible.js"
);
const { avisoDeCuenta, avisarAdminsDelFalloIa, idDelAviso } = await import("../lib/ai/avisoDeCuentaIa.js");
const { extraerJson } = await import("../lib/projects/ai/parsePlan.js");
const { respuestaConLatido } = await import("../lib/ai/respuestaConLatido.js");

/**
 * Un error del SDK, con la forma REAL del 0.110: la CLASE se llama como el
 * error y `err.name` se queda en "Error" (AnthropicError no lo sobreescribe).
 * Se reconoce por `status` y por `constructor.name`.
 */
function errorSdk(name, status) {
  const Clase = { [name]: class extends Error {} }[name];
  const err = new Clase(`${status ?? ""} lo que sea que diga el SDK`);
  if (status != null) err.status = status;
  return err;
}

/* ── errorLegible ─────────────────────────────────────────────────────────── */

describe("esErrorDeIa", () => {
  it("reconoce la falta de clave, los errores del SDK y cualquier status HTTP", () => {
    assert.equal(esErrorDeIa(Object.assign(new Error("x"), { code: "NO_API_KEY" })), true);
    assert.equal(esErrorDeIa(errorSdk("APIConnectionTimeoutError")), true);
    assert.equal(esErrorDeIa(errorSdk("AuthenticationError", 401)), true);
    assert.equal(esErrorDeIa(errorSdk("AnthropicError")), true);
  });

  it("NO se traga los errores nuestros: un fallo de Sequelize no es de la IA", () => {
    assert.equal(esErrorDeIa(null), false);
    assert.equal(esErrorDeIa(new Error("relation does not exist")), false);
    assert.equal(esErrorDeIa(new TypeError("x is not a function")), false);
  });
});

describe("mensajeDeErrorIa", () => {
  it("el timeout dice que se ha cortado y qué hacer, no «error interno»", () => {
    const msg = mensajeDeErrorIa(errorSdk("APIConnectionTimeoutError"));
    assert.match(msg, /tardado demasiado/i);
    assert.match(msg, /menos detalle/i);
  });

  it("cada estado tiene su frase, y todas dicen dónde se arregla", () => {
    assert.match(mensajeDeErrorIa(errorSdk("AuthenticationError", 401)), /Configuración → IA/);
    assert.match(mensajeDeErrorIa(errorSdk("NotFoundError", 404)), /modelo/i);
    assert.match(mensajeDeErrorIa(errorSdk("NotFoundError", 404)), /Configuración → IA/);
    assert.match(mensajeDeErrorIa(errorSdk("RateLimitError", 429)), /límite/i);
    assert.match(mensajeDeErrorIa(errorSdk("InternalServerError", 529)), /saturada/i);
  });

  it("un 5xx desconocido cae en «ha fallado por su lado», no en el genérico", () => {
    assert.match(mensajeDeErrorIa(errorSdk("InternalServerError", 502)), /por su lado/i);
  });

  it("nunca enseña el mensaje crudo del SDK", () => {
    const err = errorSdk("AuthenticationError", 401);
    assert.notEqual(mensajeDeErrorIa(err), err.message);
    assert.equal(mensajeDeErrorIa(new Error("boom")), "La IA no ha podido responder. Vuelve a intentarlo.");
    assert.equal(mensajeDeErrorIa(null, "otra cosa"), "otra cosa");
  });
});

/* ── sin saldo en la cuenta de Anthropic (10/09/2026) ─────────────────────── */

/** Lo que llegó de verdad la tarde del 10/09/2026: un 400 cuyo único rasgo es el texto. */
function errorSinSaldo() {
  const texto =
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
  // Como el SDK de verdad: la CLASE es BadRequestError y `err.name` es "Error".
  const BadRequestError = { BadRequestError: class extends Error {} }.BadRequestError;
  const err = new BadRequestError(`400 {"type":"error","error":{"type":"invalid_request_error","message":"${texto}"}}`);
  err.status = 400;
  err.error = { type: "error", error: { type: "invalid_request_error", message: texto } };
  return err;
}

describe("sin saldo (esFalloDeSaldo / esFalloDeCuenta)", () => {
  it("se reconoce por el texto, porque el código es el mismo 400 de «petición mal hecha»", () => {
    assert.equal(esFalloDeSaldo(errorSinSaldo()), true);
    assert.equal(esFalloDeSaldo(errorSdk("BadRequestError", 400)), false);
    assert.equal(esFalloDeSaldo(errorSdk("AuthenticationError", 401)), false);
    assert.equal(esFalloDeSaldo(null), false);
  });

  it("y también cuando el texto solo viene en el cuerpo que guarda el SDK", () => {
    const err = Object.assign(new Error("400 status code (no body)"), {
      status: 400,
      error: { error: { message: "Your credit balance is too low" } },
    });
    assert.equal(esFalloDeSaldo(err), true);
  });

  it("la frase dice que es el SALDO y dónde se recarga, no «acorta el texto»", () => {
    const msg = mensajeDeErrorIa(errorSinSaldo());
    assert.match(msg, /sin saldo/i);
    assert.match(msg, /console\.anthropic\.com/);
    assert.match(msg, /No es un fallo del CRM/);
    assert.doesNotMatch(msg, /acortar/i);
    // Un 400 de verdad sigue con su frase de siempre.
    assert.match(mensajeDeErrorIa(errorSdk("BadRequestError", 400)), /acortar/i);
  });

  it("es fallo de la CUENTA, como clave mala, sin permiso o límite; un 5xx o un timeout no", () => {
    assert.equal(esFalloDeCuenta(errorSinSaldo()), true);
    assert.equal(esFalloDeCuenta(errorSdk("AuthenticationError", 401)), true);
    assert.equal(esFalloDeCuenta(errorSdk("PermissionDeniedError", 403)), true);
    assert.equal(esFalloDeCuenta(errorSdk("RateLimitError", 429)), true);
    assert.equal(esFalloDeCuenta(errorSdk("InternalServerError", 529)), false);
    assert.equal(esFalloDeCuenta(errorSdk("APIConnectionTimeoutError")), false);
    assert.equal(esFalloDeCuenta(new Error("boom")), false);
    assert.equal(esFalloDeCuenta(null), false);
  });
});

describe("avisarAdminsDelFalloIa", () => {
  /**
   * `recientes`: [{ userId, title }] ya avisados en la ventana. `create` imita
   * el índice único (user_id, type, entity_id) de la tabla: la segunda fila
   * igual choca, como en Postgres.
   */
  function entorno({ admins = [{ id: "a1" }, { id: "a2" }], recientes = [] } = {}) {
    const creadas = [];
    const Notification = {
      async findOne({ where }) {
        return recientes.some((r) => r.userId === where.userId && r.title === where.title) ? { id: "x" } : null;
      },
      async create(fila) {
        if (creadas.some((c) => c.userId === fila.userId && c.type === fila.type && c.entityId === fila.entityId)) {
          throw Object.assign(new Error("duplicate key"), { name: "SequelizeUniqueConstraintError" });
        }
        creadas.push(fila);
        return fila;
      },
    };
    const ctx = { tenant: { id: "t1" }, tenantModels: { Notification } };
    return { ctx, creadas, buscarAdmins: async () => admins };
  }

  it("sin saldo: una campana a cada admin, con el título del saldo y la frase completa", async () => {
    const { ctx, creadas, buscarAdmins } = entorno();
    const n = await avisarAdminsDelFalloIa(ctx, errorSinSaldo(), { buscarAdmins });
    assert.equal(n, 2);
    assert.deepEqual(creadas.map((c) => c.userId), ["a1", "a2"]);
    assert.equal(creadas[0].type, "ai_cuenta");
    assert.equal(creadas[0].channel, "app");
    assert.match(creadas[0].title, /sin saldo/i);
    assert.match(creadas[0].body, /console\.anthropic\.com/);
  });

  it("no repite: al admin avisado hace poco no se le vuelve a avisar (129 intentos ≠ 129 campanas)", async () => {
    const { ctx, creadas, buscarAdmins } = entorno({ recientes: [{ userId: "a1", title: "La IA se ha quedado sin saldo" }] });
    const n = await avisarAdminsDelFalloIa(ctx, errorSinSaldo(), { buscarAdmins });
    assert.equal(n, 1);
    assert.deepEqual(creadas.map((c) => c.userId), ["a2"]);
  });

  it("pero una causa NUEVA sí entra: un 429 de hace un rato no tapa el sin saldo", async () => {
    const { ctx, creadas, buscarAdmins } = entorno({
      recientes: [{ userId: "a1", title: "La IA ha llegado a su límite de uso" }, { userId: "a2", title: "La IA ha llegado a su límite de uso" }],
    });
    assert.equal(await avisarAdminsDelFalloIa(ctx, errorSinSaldo(), { buscarAdmins }), 2);
    assert.ok(creadas.every((c) => /sin saldo/i.test(c.title)));
  });

  it("dos intentos a la vez no doblan la campana: el índice único frena al segundo", async () => {
    const { ctx, creadas, buscarAdmins } = entorno();
    const ahora = new Date("2026-09-10T16:26:00Z");
    // Los dos entran en el catch en el mismo instante: los dos miran antes de que
    // el otro inserte (findOne no ve nada), y solo uno de cada par puede crear.
    const [n1, n2] = await Promise.all([
      avisarAdminsDelFalloIa(ctx, errorSinSaldo(), { buscarAdmins, ahora }),
      avisarAdminsDelFalloIa(ctx, errorSinSaldo(), { buscarAdmins, ahora }),
    ]);
    assert.equal(n1 + n2, 2);
    assert.equal(creadas.length, 2);
    assert.deepEqual(creadas.map((c) => c.userId).sort(), ["a1", "a2"]);
    assert.ok(creadas.every((c) => c.entityId === idDelAviso("t1", "La IA se ha quedado sin saldo", ahora)));
  });

  it("un fallo que no es de la cuenta (saturación, timeout, bug nuestro) no molesta a nadie", async () => {
    const { ctx, creadas, buscarAdmins } = entorno();
    assert.equal(await avisarAdminsDelFalloIa(ctx, errorSdk("InternalServerError", 529), { buscarAdmins }), 0);
    assert.equal(await avisarAdminsDelFalloIa(ctx, errorSdk("APIConnectionTimeoutError"), { buscarAdmins }), 0);
    assert.equal(await avisarAdminsDelFalloIa(ctx, new TypeError("x is not a function"), { buscarAdmins }), 0);
    assert.equal(creadas.length, 0);
  });

  it("nunca lanza: sin modelo de notificaciones, o con la base caída, devuelve 0", async () => {
    const sinModelo = { tenant: { id: "t1" }, tenantModels: {} };
    assert.equal(await avisarAdminsDelFalloIa(sinModelo, errorSinSaldo(), { buscarAdmins: async () => [{ id: "a1" }] }), 0);
    const { ctx } = entorno();
    const caida = async () => {
      throw new Error("db caída");
    };
    assert.equal(await avisarAdminsDelFalloIa(ctx, errorSinSaldo(), { buscarAdmins: caida }), 0);
  });

  it("cada fallo de cuenta tiene su título: clave, permiso, límite; y lo demás, nada", () => {
    assert.match(avisoDeCuenta(errorSinSaldo()).title, /sin saldo/i);
    assert.match(avisoDeCuenta(errorSdk("AuthenticationError", 401)).title, /clave/i);
    assert.match(avisoDeCuenta(errorSdk("PermissionDeniedError", 403)).title, /permiso/i);
    assert.match(avisoDeCuenta(errorSdk("RateLimitError", 429)).title, /límite/i);
    assert.equal(avisoDeCuenta(errorSdk("InternalServerError", 500)), null);
  });
});

describe("con las clases REALES del SDK (@anthropic-ai/sdk)", () => {
  it("todas llegan con name «Error»: se reconocen por la clase, no por el nombre", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const timeout = new Anthropic.APIConnectionTimeoutError();
    assert.equal(timeout.name, "Error");
    assert.equal(esErrorDeIa(timeout), true);
    assert.match(mensajeDeErrorIa(timeout), /tardado demasiado/i);
    const red = new Anthropic.APIConnectionError({ message: "fetch failed" });
    assert.equal(esErrorDeIa(red), true);
    assert.match(mensajeDeErrorIa(red), /conectar/i);
    const cuerpo = {
      type: "error",
      error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
    };
    const sinSaldo = new Anthropic.BadRequestError(400, cuerpo, `400 ${JSON.stringify(cuerpo)}`, new Headers());
    assert.equal(sinSaldo.name, "Error");
    assert.equal(esFalloDeSaldo(sinSaldo), true);
    assert.equal(esFalloDeCuenta(sinSaldo), true);
    assert.match(mensajeDeErrorIa(sinSaldo), /sin saldo/i);
    const clave = new Anthropic.AuthenticationError(
      401,
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      "401 invalid x-api-key",
      new Headers()
    );
    assert.equal(esFalloDeCuenta(clave), true);
    assert.match(mensajeDeErrorIa(clave), /Configuración → IA/);
  });
});

describe("idDelAviso: mismo tenant, misma causa, mismo tramo → mismo id", () => {
  it("es un UUID, estable dentro del tramo y distinto por causa o por tramo", () => {
    const t0 = new Date("2026-09-10T16:26:00Z");
    const a = idDelAviso("t1", "La IA se ha quedado sin saldo", t0);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(idDelAviso("t1", "La IA se ha quedado sin saldo", new Date(t0.getTime() + 60_000)), a);
    assert.notEqual(idDelAviso("t1", "La IA ha llegado a su límite de uso", t0), a);
    assert.notEqual(idDelAviso("t2", "La IA se ha quedado sin saldo", t0), a);
    assert.notEqual(idDelAviso("t1", "La IA se ha quedado sin saldo", new Date(t0.getTime() + 13 * 3_600_000)), a);
  });
});

/* ── extraerJson ──────────────────────────────────────────────────────────── */

describe("extraerJson", () => {
  it("el caso normal: el modelo devuelve solo el JSON", () => {
    assert.deepEqual(extraerJson('{"name":"Web"}'), { name: "Web" });
  });

  it("con valla de markdown, esté sola o con texto alrededor", () => {
    assert.deepEqual(extraerJson('```json\n{"name":"Web"}\n```'), { name: "Web" });
    assert.deepEqual(
      extraerJson('Aquí tienes el plan:\n\n```json\n{"name":"Web"}\n```\n\n¿Te encaja?'),
      { name: "Web" }
    );
  });

  it("sin valla pero con una frase delante (lo que rompía antes)", () => {
    assert.deepEqual(extraerJson('Claro. {"name":"Web","phases":[]}'), { name: "Web", phases: [] });
  });

  it("una llave dentro de un texto no cierra el objeto", () => {
    const raw = 'Nota previa. {"name":"El plan {definitivo}","phases":[{"name":"Fase 1"}]} y ya está.';
    assert.deepEqual(extraerJson(raw), { name: "El plan {definitivo}", phases: [{ name: "Fase 1" }] });
  });

  it("una comilla escapada dentro de un texto tampoco", () => {
    assert.deepEqual(extraerJson('x {"name":"Dice \\"hola\\" y }"} y', ), { name: 'Dice "hola" y }' });
  });

  it("devuelve null —y no lanza— cuando no hay JSON que valga", () => {
    assert.equal(extraerJson(""), null);
    assert.equal(extraerJson(null), null);
    assert.equal(extraerJson("Lo siento, no puedo ayudarte con eso."), null);
    assert.equal(extraerJson('{"name": incompleto'), null);
  });
});

/* ── respuestaConLatido ───────────────────────────────────────────────────── */

describe("respuestaConLatido", () => {
  it("lo que llega sigue siendo JSON parseable, con latidos delante", async () => {
    const res = respuestaConLatido(async () => ({ ok: true, data: { plan: "algo" } }), { intervaloMs: 5 });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/json/);
    // Que nginx no acumule: sin esto el latido llegaría al final.
    assert.equal(res.headers.get("x-accel-buffering"), "no");
    const texto = await res.text();
    assert.deepEqual(JSON.parse(texto), { ok: true, data: { plan: "algo" } });
  });

  it("el trabajo largo late mientras tanto y el JSON sigue parseando", async () => {
    const res = respuestaConLatido(
      async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true, data: 1 };
      },
      { intervaloMs: 5 }
    );
    const texto = await res.text();
    assert.ok(texto.startsWith(" "), "tenía que haber salido algún latido antes del cuerpo");
    assert.deepEqual(JSON.parse(texto), { ok: true, data: 1 });
  });

  it("el fallo viaja DENTRO del cuerpo: el 200 ya se mandó y no se puede cambiar", async () => {
    const res = respuestaConLatido(async () => ({ ok: false, error: "la clave no vale" }));
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(await res.text()), { ok: false, error: "la clave no vale" });
  });

  it("si el trabajo lanza, el cliente recibe un ok:false, nunca una respuesta a medias", async () => {
    const res = respuestaConLatido(async () => {
      throw new Error("boom");
    });
    const cuerpo = JSON.parse(await res.text());
    assert.equal(cuerpo.ok, false);
    assert.match(cuerpo.error, /Vuelve a intentarlo/);
    assert.equal(/boom/.test(cuerpo.error), false); // el motivo se queda en el servidor
  });
});
