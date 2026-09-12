// @prueba ligera
// Fija la elección de proveedor de la IA de texto del 12/09/2026: Claude o
// ChatGPT por tenant (lib/ai/proveedorIa.js), el catálogo de OpenAI
// (lib/ai/openaiModel.js), la petición y la lectura de la respuesta de OpenAI
// sin red (lib/ai/openai.js), los precios (lib/ai/precios.js), la contabilidad
// (lib/ai/usoDeIA.js) y los mensajes de error de los dos proveedores
// (lib/ai/errorLegible.js). Sin base de datos ni clave.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROVEEDOR_IA,
  esProveedorIa,
  getTenantIaKey,
  getTenantIaModel,
  getTenantProveedorIa,
  nombreDelProveedor,
  proveedorDelModelo,
  proveedorIaDe,
  sinClaveDeIa,
} from "../lib/ai/proveedorIa.js";
import { DEFAULT_ANTHROPIC_MODEL } from "../lib/ai/anthropicModel.js";
import { DEFAULT_OPENAI_MODEL, OPENAI_MODELS, getTenantOpenAIModel, isAllowedOpenAIModel, parametrosDeRazonamientoOpenAI } from "../lib/ai/openaiModel.js";
import { errorDeOpenAI, leerRespuestaDeOpenAI, paradaDe, peticionDeOpenAI, systemDeOpenAI, usageAnthropicDe } from "../lib/ai/openai.js";
import { PRECIOS_OPENAI, costeOpenAIUsd } from "../lib/ai/precios.js";
import { registrarUso } from "../lib/ai/usoDeIA.js";
import { esErrorDeIa, esFalloDeCuenta, esFalloDeSaldo, mensajeDeErrorIa } from "../lib/ai/errorLegible.js";
import { isAllowedModel } from "../lib/outreach/analysis/models.js";
import { completeConParada } from "../lib/outreach/analysis/anthropic.js";
import { chat } from "../lib/assistant/anthropic.js";

const ctxDe = (integrations) => ({ tenant: { settings: { integrations } } });

/* ── elección de proveedor ───────────────────────────────────────────────── */

test("sin nada elegido, el proveedor es Anthropic: los clientes de hoy no cambian", () => {
  assert.equal(DEFAULT_PROVEEDOR_IA, "anthropic");
  assert.equal(proveedorIaDe({}), "anthropic");
  assert.equal(proveedorIaDe(undefined), "anthropic");
  assert.equal(proveedorIaDe({ aiProvider: "gemini" }), "anthropic", "un valor desconocido no cuela");
  assert.equal(proveedorIaDe({ aiProvider: "openai" }), "openai");
  assert.ok(esProveedorIa("openai") && esProveedorIa("anthropic") && !esProveedorIa("OpenAI"));
  assert.equal(getTenantProveedorIa(ctxDe({ aiProvider: "openai" })), "openai");
  assert.equal(getTenantProveedorIa({}), "anthropic");
});

test("el modelo del tenant es el del proveedor elegido, cada uno con su defecto", () => {
  assert.equal(getTenantIaModel(ctxDe({})), DEFAULT_ANTHROPIC_MODEL);
  assert.equal(getTenantIaModel(ctxDe({ aiProvider: "openai" })), DEFAULT_OPENAI_MODEL);
  assert.equal(getTenantIaModel(ctxDe({ aiProvider: "openai", openaiModel: "gpt-5.6-sol" })), "gpt-5.6-sol");
  // Cambiar de proveedor no pierde el modelo del otro.
  const integ = { aiProvider: "openai", openaiModel: "gpt-5.6-terra", anthropicModel: "claude-sonnet-5" };
  assert.equal(getTenantIaModel(ctxDe(integ)), "gpt-5.6-terra");
  assert.equal(getTenantIaModel(ctxDe({ ...integ, aiProvider: "anthropic" })), "claude-sonnet-5");
});

test("la clave del tenant es la del proveedor elegido, y null si esa falta aunque esté la otra", () => {
  // Sin SETTINGS_ENCRYPTION_KEY los valores en claro se devuelven tal cual.
  const integ = { anthropicApiKey: "sk-ant-prueba", openaiApiKey: "sk-prueba" };
  assert.equal(getTenantIaKey(ctxDe(integ)), "sk-ant-prueba");
  assert.equal(getTenantIaKey(ctxDe({ ...integ, aiProvider: "openai" })), "sk-prueba");
  assert.equal(getTenantIaKey(ctxDe({ anthropicApiKey: "sk-ant-prueba", aiProvider: "openai" })), null);
  assert.equal(getTenantIaKey(ctxDe({ openaiApiKey: "sk-prueba" })), null);
});

test("el id del modelo dice a quién llamar", () => {
  assert.equal(proveedorDelModelo("claude-haiku-4-5-20251001"), "anthropic");
  assert.equal(proveedorDelModelo("gpt-5.6-luna"), "openai");
  assert.equal(proveedorDelModelo("gpt-9-futuro"), "openai", "un gpt que aún no está en el catálogo sigue siendo de OpenAI");
  assert.equal(proveedorDelModelo("o4-mini"), "openai");
  assert.equal(proveedorDelModelo(undefined), "anthropic");
});

test("la frase de «falta la clave» nombra al proveedor elegido", () => {
  assert.equal(nombreDelProveedor("openai"), "OpenAI");
  assert.equal(sinClaveDeIa(ctxDe({ aiProvider: "openai" }), "para estructurar la sesión"), "Configura la clave de OpenAI en Configuración → Conexiones para estructurar la sesión.");
  assert.equal(sinClaveDeIa(ctxDe({})), "Configura la clave de Anthropic en Configuración → Conexiones para usar la IA.");
});

/* ── catálogo de OpenAI ──────────────────────────────────────────────────── */

test("el modelo de OpenAI por defecto es Luna, está en la lista y tiene precio", () => {
  assert.equal(DEFAULT_OPENAI_MODEL, "gpt-5.6-luna");
  assert.equal(OPENAI_MODELS[0].id, DEFAULT_OPENAI_MODEL);
  assert.ok(isAllowedOpenAIModel(DEFAULT_OPENAI_MODEL));
  assert.ok(!isAllowedOpenAIModel("gpt-4o"));
  for (const m of OPENAI_MODELS) assert.ok(PRECIOS_OPENAI[m.id], `${m.id} sin precio`);
  assert.equal(getTenantOpenAIModel(ctxDe({ openaiModel: "gpt-4o" })), DEFAULT_OPENAI_MODEL, "uno fuera de la lista cae al defecto");
});

test("a los modelos del catálogo se les apaga el razonamiento; a uno desconocido no se le manda nada", () => {
  assert.deepEqual(parametrosDeRazonamientoOpenAI("gpt-5.6-luna"), { reasoning_effort: "none" });
  assert.deepEqual(parametrosDeRazonamientoOpenAI("gpt-9-futuro"), {});
});

test("Captación acepta el modelo de OpenAI que manda Configuración", () => {
  assert.ok(isAllowedModel("gpt-5.6-luna"));
  assert.ok(isAllowedModel("claude-sonnet-5"));
  assert.ok(!isAllowedModel("gpt-4o"));
});

/* ── la petición y la respuesta de OpenAI, sin red ───────────────────────── */

test("el system cacheado va DELANTE del resto, en una sola cadena", () => {
  assert.equal(systemDeOpenAI("resto", "fijo"), "fijo\n\nresto");
  assert.equal(systemDeOpenAI("solo", null), "solo");
  assert.equal(systemDeOpenAI("", ""), "");
});

test("la petición de una pasada: system + user, tope con el nombre nuevo y sin razonar", () => {
  const p = peticionDeOpenAI({ system: "reglas", systemCacheado: "saber", user: "hola", model: "gpt-5.6-luna", maxTokens: 500 });
  assert.equal(p.model, "gpt-5.6-luna");
  assert.deepEqual(p.messages, [
    { role: "system", content: "saber\n\nreglas" },
    { role: "user", content: "hola" },
  ]);
  assert.equal(p.max_completion_tokens, 500);
  assert.equal(p.reasoning_effort, "none");
  assert.equal(p.max_tokens, undefined, "los modelos que razonan rechazan max_tokens");
  assert.equal(p.stream, undefined);
});

test("con streaming se pide el usage al final; en el chat los turnos conservan su papel", () => {
  const p = peticionDeOpenAI({ system: "s", user: "u", model: "gpt-5.6-luna", maxTokens: 10, stream: true });
  assert.equal(p.stream, true);
  assert.deepEqual(p.stream_options, { include_usage: true });
  const c = peticionDeOpenAI({
    system: "s",
    messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "raro", content: "c" }],
    model: "gpt-5.6-luna",
    maxTokens: 10,
  });
  assert.deepEqual(c.messages.slice(1).map((m) => m.role), ["user", "assistant", "user"]);
});

test("el usage de OpenAI se traduce a los cuatro contadores de Anthropic", () => {
  assert.deepEqual(usageAnthropicDe({ prompt_tokens: 3000, completion_tokens: 400, prompt_tokens_details: { cached_tokens: 2000 } }), {
    input_tokens: 1000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 2000,
    output_tokens: 400,
  });
  assert.deepEqual(usageAnthropicDe(null), { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 });
  // Lo cacheado nunca supera la entrada, venga lo que venga.
  assert.equal(usageAnthropicDe({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 50 } }).input_tokens, 0);
});

test("finish_reason habla el idioma de stop_reason, que es lo que miran los llamantes", () => {
  assert.equal(paradaDe("stop"), "end_turn");
  assert.equal(paradaDe("length"), "max_tokens");
  assert.equal(paradaDe("content_filter"), "content_filter");
  assert.equal(paradaDe(undefined), null);
  const r = leerRespuestaDeOpenAI({ choices: [{ message: { content: "  {\"a\":1}  " }, finish_reason: "length" }], usage: { prompt_tokens: 1 } });
  assert.deepEqual(r, { texto: '{"a":1}', parada: "max_tokens", usage: { prompt_tokens: 1 } });
  assert.equal(leerRespuestaDeOpenAI({ choices: [] }).texto, "");
});

/* ── precios y contabilidad ──────────────────────────────────────────────── */

test("un registro típico en Luna: 4.000 de entrada, 22.000 cacheados y 1.000 de salida ≈ 0,00244 $", () => {
  const usd = costeOpenAIUsd("gpt-5.6-luna", { input_tokens: 4000, cache_read_input_tokens: 22000, output_tokens: 1000 });
  assert.equal(usd, 0.00244);
  assert.equal(costeOpenAIUsd("gpt-4o", { input_tokens: 10 }), null);
});

test("la contabilidad distingue Whisper de ChatGPT aunque los dos sean de OpenAI", async () => {
  const filas = [];
  const crear = async (f) => filas.push(f);
  await registrarUso({ proveedor: "openai", modelo: "whisper-1", segundosAudio: 120 }, { crear });
  await registrarUso({ proveedor: "openai", modelo: "gpt-5.6-luna", usage: { input_tokens: 1_000_000 } }, { crear });
  await registrarUso({ proveedor: "openai", modelo: "gpt-5.6-luna", cacheado: true, usage: { input_tokens: 1_000_000 } }, { crear });
  assert.equal(filas[0].costeUsd, 0.012);
  assert.equal(filas[1].costeUsd, PRECIOS_OPENAI["gpt-5.6-luna"].entrada);
  assert.equal(filas[1].inputTokens, 1_000_000);
  assert.equal(filas[2].costeUsd, 0);
});

/* ── errores de los dos proveedores ──────────────────────────────────────── */

test("el «sin saldo» de OpenAI es un 429 con insufficient_quota, y se dice dónde se recarga", () => {
  const err = errorDeOpenAI(429, { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } });
  assert.equal(err.proveedor, "openai");
  assert.ok(esErrorDeIa(err));
  assert.ok(esFalloDeSaldo(err));
  assert.ok(esFalloDeCuenta(err));
  assert.match(mensajeDeErrorIa(err), /cuenta de OpenAI.*sin saldo.*platform\.openai\.com/);
});

test("un 429 de límite por minuto de OpenAI NO es sin saldo, y nombra la cuenta que toca", () => {
  const err = errorDeOpenAI(429, { error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } });
  assert.ok(!esFalloDeSaldo(err));
  assert.match(mensajeDeErrorIa(err), /cuenta de OpenAI\.$/);
  const anthropic = Object.assign(new Error("rate"), { status: 429 });
  assert.match(mensajeDeErrorIa(anthropic), /cuenta de Anthropic\.$/);
});

test("el sin saldo de Anthropic sigue igual que el 11/09", () => {
  const err = Object.assign(new Error("Your credit balance is too low"), { status: 400 });
  assert.ok(esFalloDeSaldo(err));
  assert.match(mensajeDeErrorIa(err), /cuenta de Anthropic.*console\.anthropic\.com/);
});

test("los errores de red de OpenAI usan los nombres que ya entiende errorLegible", () => {
  const e = Object.assign(new Error("x"), { name: "APIConnectionTimeoutError", proveedor: "openai" });
  assert.ok(esErrorDeIa(e));
  assert.match(mensajeDeErrorIa(e), /tardado demasiado/);
  const sin = errorDeOpenAI(401, null);
  assert.match(mensajeDeErrorIa(sin), /no es válida o ha caducado/);
});

/* ── el despacho de los dos envoltorios ──────────────────────────────────── */

test("un modelo gpt sin clave de OpenAI se corta con NO_API_KEY y nombra a OpenAI", async () => {
  await assert.rejects(
    completeConParada({ system: "s", user: "u", model: "gpt-5.6-luna", apiKey: null }),
    (e) => e.code === "NO_API_KEY" && e.proveedor === "openai" && /OpenAI/.test(e.message)
  );
  await assert.rejects(chat({ system: "s", messages: [], model: "gpt-5.6-luna", apiKey: "" }), (e) => e.code === "NO_API_KEY" && e.proveedor === "openai");
  // Y un modelo de Claude sigue cortándose por Anthropic, como siempre.
  await assert.rejects(completeConParada({ system: "s", user: "u", model: "claude-haiku-4-5-20251001", apiKey: null }), (e) => e.code === "NO_API_KEY" && /Anthropic/.test(e.message));
});
