// @prueba ligera — sustituye `fetch` y el destino de las filas de uso; sin base, sin servidor, sin claves.
/**
 * _smoke-salamandrobot-sin-nombres.mjs — ningún nombre ni id de ficha sale
 * hacia el proveedor de IA desde el Salamandrobot (14/09/2026, decisión de
 * Jorge en la tarea del Registro «¿Siguen viajando al proveedor de IA los
 * nombres de las familias que el Salamandrobot encuentra?», opción a).
 *
 *   node scripts/_smoke-salamandrobot-sin-nombres.mjs
 *
 * ── LO QUE FIJA ─────────────────────────────────────────────────────────────
 *   · `buildSystem`: con fichas lleva CUÁNTAS y la orden de no nombrarlas, sin
 *     nombre ni id; sin fichas no habla de fichas.
 *   · `noAiAnswer`: tampoco nombra (la pantalla la reenvía como historial y el
 *     turno siguiente puede ir con IA).
 *   · Lo que DE VERDAD sale por `fetch` hacia OpenAI y Anthropic con fichas
 *     encontradas: ni el apellido ni el id.
 *   · El simulado (demos, datos falsos, sin proveedor) sí puede nombrarlas.
 *   · La ruta enseña tantos enlaces como dice `FICHAS_EN_ENLACES`.
 *
 * Como en `_smoke-ia-aviso-central.mjs`: DATABASE_URL a una base que no existe
 * y filas de uso a un destino en memoria, para no escribir nada en ningún sitio.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

for (const k of ["CITAS_FAKE_AI", "ASSISTANT_FAKE_AI", "OUTREACH_FAKE_AI", "CALENDAR_FAKE_AI", "CLINICA_FAKE_AI"]) {
  delete process.env[k];
}
process.env.DATABASE_URL = "postgres://nadie:nada@127.0.0.1:1/ninguna";

register(new URL("./_abrir-lib-hooks.mjs", import.meta.url));
const { destinoDeUsoParaPruebas } = await import("../lib/ai/usoDeIA.js");
destinoDeUsoParaPruebas(async () => {});
const { buildSystem, noAiAnswer, answerQuestion, FICHAS_EN_ENLACES } = await import("../lib/assistant/answer.js");

const GPT = "gpt-5.6-luna";
const HAIKU = "claude-haiku-4-5-20251001";
const ID = "7f3c9a12-5b8e-4d21-9c44-aa01bb02cc03";
const FICHA = [{ id: ID, name: "Ana Muñoz" }];
const SEIS = Array.from({ length: 6 }, (_, i) => ({ id: `id-${i}-zz`, name: `Familia Apellidoraro${i}` }));
const msgs = [{ role: "user", content: "¿dónde está la ficha que busco?" }];

function sinNombres(texto, fichas) {
  for (const c of fichas) {
    assert.ok(!texto.includes(c.name), `lleva «${c.name}»`);
    assert.ok(!texto.includes(c.name.split(" ").pop()), `lleva el apellido de «${c.name}»`);
    assert.ok(!texto.includes(String(c.id)), `lleva el id ${c.id}`);
  }
}

/** Captura el cuerpo de cada petición al proveedor y contesta como uno de los dos. */
async function capturando(fn) {
  const original = globalThis.fetch;
  const cuerpos = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url?.url ?? url);
    const body = init?.body ?? (url instanceof Request ? await url.clone().text() : "");
    cuerpos.push(typeof body === "string" ? body : String(body));
    const respuesta = u.includes("openai")
      ? { id: "x", model: GPT, choices: [{ message: { role: "assistant", content: "Han salido fichas." }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
      : { id: "x", type: "message", role: "assistant", model: HAIKU, content: [{ type: "text", text: "Han salido fichas." }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
    return new Response(JSON.stringify(respuesta), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const r = await fn();
    return { r, cuerpos };
  } finally {
    globalThis.fetch = original;
  }
}

describe("buildSystem", () => {
  it("con una ficha: el número y la orden, ni nombre ni id", () => {
    const s = buildSystem({ companyName: "Centro", clients: FICHA });
    sinNombres(s, FICHA);
    assert.match(s, /encontrado 1 ficha/);
    assert.match(s, /No las nombres ni inventes nombres/);
    assert.match(s, /enlaces debajo de tu respuesta/);
  });

  it("con seis: dice seis y que se ven las cuatro primeras", () => {
    const s = buildSystem({ companyName: "Centro", clients: SEIS });
    sinNombres(s, SEIS);
    assert.match(s, /encontrado 6 fichas/);
    assert.match(s, new RegExp(`las ${FICHAS_EN_ENLACES} primeras`));
  });

  // La base de conocimiento ya dice «ficha» por su cuenta (dónde está cada
  // pantalla): lo que no puede salir es la frase de la búsqueda.
  it("sin fichas no menciona fichas encontradas", () => {
    const base = buildSystem({ companyName: "Centro", clients: [] });
    for (const clients of [undefined, null]) assert.equal(buildSystem({ companyName: "Centro", clients }), base);
    assert.ok(!/encontrado|enlaces debajo|No las nombres/.test(base), "habla de fichas encontradas sin haberlas");
    assert.ok(buildSystem({ companyName: "Centro", clients: FICHA }).startsWith(base));
  });
});

describe("noAiAnswer", () => {
  it("cuenta las fichas sin nombrarlas", () => {
    const uno = noAiAnswer({ query: "x", relevant: [], clients: FICHA });
    sinNombres(uno, FICHA);
    assert.match(uno, /1 ficha/);
    const seis = noAiAnswer({ query: "x", relevant: [], clients: SEIS });
    sinNombres(seis, SEIS);
    assert.match(seis, /6 fichas/);
  });
});

describe("lo que sale por la red", () => {
  for (const model of [GPT, HAIKU]) {
    it(`${model}: el cuerpo de la petición no lleva el nombre ni el id`, async () => {
      const { r, cuerpos } = await capturando(() =>
        answerQuestion({ messages: msgs, relevant: [], clients: [...FICHA, ...SEIS], apiKey: "k", model, companyName: "Centro" })
      );
      assert.equal(r.model, model, "tenía que contestar la IA (falsa)");
      assert.equal(cuerpos.length, 1);
      sinNombres(cuerpos[0], [...FICHA, ...SEIS]);
      assert.match(cuerpos[0], /encontrado 7 fichas/);
    });
  }

  it("una respuesta sin IA reenviada como historial tampoco los lleva", async () => {
    const previa = noAiAnswer({ query: "Muñoz", relevant: [], clients: FICHA });
    const historial = [{ role: "user", content: "busca" }, { role: "assistant", content: previa }, { role: "user", content: "¿y ahora?" }];
    const { cuerpos } = await capturando(() =>
      answerQuestion({ messages: historial, relevant: [], clients: [], apiKey: "k", model: GPT, companyName: "Centro" })
    );
    sinNombres(cuerpos[0], FICHA);
  });
});

describe("simulado y ruta", () => {
  it("el simulado (demos) sí puede nombrarlas y no toca la red", async () => {
    const { r, cuerpos } = await capturando(() =>
      answerQuestion({ messages: msgs, relevant: [], clients: FICHA, apiKey: null, model: GPT, forceFake: true })
    );
    assert.equal(r.model, "fake");
    assert.ok(r.answer.includes("Ana Muñoz"));
    assert.equal(cuerpos.length, 0);
  });

  it("la ruta enseña FICHAS_EN_ENLACES enlaces", () => {
    const ruta = readFileSync(new URL("../app/api/assistant/route.js", import.meta.url), "utf8");
    assert.ok(ruta.includes("clients.slice(0, FICHAS_EN_ENLACES)"));
    assert.equal(FICHAS_EN_ENLACES, 4);
  });
});
