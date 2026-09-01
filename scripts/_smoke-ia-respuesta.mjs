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
const { esErrorDeIa, mensajeDeErrorIa } = await import("../lib/ai/errorLegible.js");
const { extraerJson } = await import("../lib/projects/ai/parsePlan.js");
const { respuestaConLatido } = await import("../lib/ai/respuestaConLatido.js");

/** Un error del SDK: lo que se reconoce de él es `name` y `status`. */
function errorSdk(name, status) {
  const err = new Error(`${status ?? ""} lo que sea que diga el SDK`);
  err.name = name;
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
