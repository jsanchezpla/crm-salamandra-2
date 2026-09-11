// @prueba ligera
// Fija el ahorro de la IA del 11/09/2026: precios y coste estimado por llamada
// (lib/ai/precios.js), el razonamiento apagado según el modelo
// (lib/ai/anthropicModel.js), la caché de respuestas repetidas
// (lib/ai/cacheDeRespuestas.js) y la contabilidad por petición
// (lib/ai/usoDeIA.js), sin base de datos.
import test from "node:test";
import assert from "node:assert/strict";
import { costeAnthropicUsd, costeWhisperUsd, desgloseDeUsage, PRECIOS_ANTHROPIC } from "../lib/ai/precios.js";
import {
  ANTHROPIC_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  getTenantAnthropicModel,
  isAllowedAnthropicModel,
  parametrosDeRazonamiento,
} from "../lib/ai/anthropicModel.js";
import { crearCache } from "../lib/ai/cacheDeRespuestas.js";
import { conContextoDeUso, contextoDeUso, marcarAccion, registrarUso } from "../lib/ai/usoDeIA.js";
import { systemDeLaPeticion } from "../lib/outreach/analysis/anthropic.js";

/* ── precios ─────────────────────────────────────────────────────────────── */

test("un registro típico en Haiku: 4.000 de entrada, 22.000 de caché leída y 1.000 de salida ≈ 0,0112 $", () => {
  const usd = costeAnthropicUsd("claude-haiku-4-5-20251001", {
    input_tokens: 4000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 22000,
    output_tokens: 1000,
  });
  assert.equal(usd, 0.0112);
});

test("la escritura de caché a una hora se cobra al doble de la entrada", () => {
  const usd = costeAnthropicUsd("claude-sonnet-5", { cache_creation_input_tokens: 1_000_000 });
  assert.equal(usd, PRECIOS_ANTHROPIC["claude-sonnet-5"].escritura1h);
  assert.equal(usd, 2 * PRECIOS_ANTHROPIC["claude-sonnet-5"].entrada);
});

test("un modelo que no está en la tabla no tiene precio, pero no rompe", () => {
  assert.equal(costeAnthropicUsd("claude-futuro-9", { input_tokens: 10 }), null);
  assert.equal(costeAnthropicUsd(undefined, null), null);
});

test("el desglose limpia lo que no venga o venga raro", () => {
  assert.deepEqual(desgloseDeUsage(null), { entrada: 0, escritura: 0, lectura: 0, salida: 0 });
  assert.deepEqual(desgloseDeUsage({ input_tokens: "12", output_tokens: -3, cache_read_input_tokens: 2.6 }), {
    entrada: 12,
    escritura: 0,
    lectura: 3,
    salida: 0,
  });
});

test("Whisper: tres minutos de audio son 0,018 $, y sin audio 0", () => {
  assert.equal(costeWhisperUsd(180), 0.018);
  assert.equal(costeWhisperUsd(0), 0);
  assert.equal(costeWhisperUsd(null), 0);
});

/* ── modelo y razonamiento ───────────────────────────────────────────────── */

test("el modelo por defecto es Haiku y está en la lista permitida", () => {
  assert.equal(DEFAULT_ANTHROPIC_MODEL, "claude-haiku-4-5-20251001");
  assert.ok(isAllowedAnthropicModel(DEFAULT_ANTHROPIC_MODEL));
  assert.equal(ANTHROPIC_MODELS[0].id, DEFAULT_ANTHROPIC_MODEL);
  assert.equal(getTenantAnthropicModel({ tenant: { settings: { integrations: {} } } }), DEFAULT_ANTHROPIC_MODEL);
  assert.equal(getTenantAnthropicModel({ tenant: { settings: { integrations: { anthropicModel: "claude-sonnet-5" } } } }), "claude-sonnet-5");
});

test("a Sonnet 5 se le apaga el razonamiento; a Haiku y Opus 4.8 no se les manda nada", () => {
  assert.deepEqual(parametrosDeRazonamiento("claude-sonnet-5"), { thinking: { type: "disabled" } });
  assert.deepEqual(parametrosDeRazonamiento("claude-haiku-4-5-20251001"), {});
  assert.deepEqual(parametrosDeRazonamiento("claude-opus-4-8"), {});
  assert.deepEqual(parametrosDeRazonamiento(undefined), {});
});

test("el system cacheado sigue saliendo como antes: bloque marcado a una hora y resto detrás", () => {
  const s = systemDeLaPeticion("resto", "fijo");
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.equal(systemDeLaPeticion("solo", null), "solo");
});

/* ── caché de respuestas ─────────────────────────────────────────────────── */

test("la misma petición se recuerda un día y una letra distinta es otra petición", () => {
  let t = 1_000;
  const c = crearCache({ ttlMs: 100, ahora: () => t });
  const k1 = c.clave({ model: "m", params: { user: "hola" } });
  const k2 = c.clave({ model: "m", params: { user: "hola." } });
  assert.notEqual(k1, k2);
  assert.equal(c.recuperar(k1), null);
  c.recordar(k1, { texto: "respuesta", parada: "end_turn" });
  assert.deepEqual(c.recuperar(k1), { texto: "respuesta", parada: "end_turn" });
  assert.equal(c.recuperar(k2), null);
  t += 101;
  assert.equal(c.recuperar(k1), null, "caducada");
});

test("la caché tiene tope: al llenarse cae la entrada más vieja", () => {
  const c = crearCache({ max: 2, ahora: () => 5 });
  c.recordar("a", 1);
  c.recordar("b", 2);
  c.recordar("c", 3);
  assert.equal(c.tamano(), 2);
  assert.equal(c.recuperar("a"), null);
  assert.equal(c.recuperar("c"), 3);
});

test("la clave es estable para el mismo objeto", () => {
  const c = crearCache();
  assert.equal(c.clave({ a: 1, b: [1, 2] }), c.clave({ a: 1, b: [1, 2] }));
});

/* ── contabilidad por petición ───────────────────────────────────────────── */

function recolector() {
  const filas = [];
  return { filas, crear: async (f) => { filas.push(f); } };
}

test("dentro de una petición la fila lleva tenant, usuario y la acción que puso vetoAi", async () => {
  const r = recolector();
  await conContextoDeUso({ tenantId: "t1", userId: "u1" }, async () => {
    marcarAccion("transcribir una sesión clínica");
    await new Promise((res) => setTimeout(res, 1)); // el contexto sobrevive a un await
    assert.equal(contextoDeUso().accion, "transcribir una sesión clínica");
    await registrarUso(
      { proveedor: "anthropic", modelo: "claude-haiku-4-5-20251001", usage: { input_tokens: 1000, cache_read_input_tokens: 20000, output_tokens: 500 }, ms: 1234, parada: "end_turn" },
      { crear: r.crear }
    );
  });
  assert.equal(r.filas.length, 1);
  const f = r.filas[0];
  assert.equal(f.tenantId, "t1");
  assert.equal(f.userId, "u1");
  assert.equal(f.accion, "transcribir una sesión clínica");
  assert.equal(f.inputTokens, 1000);
  assert.equal(f.cacheReadTokens, 20000);
  assert.equal(f.outputTokens, 500);
  assert.equal(f.costeUsd, 0.0055);
  assert.equal(f.ms, 1234);
  assert.equal(f.parada, "end_turn");
  assert.equal(f.cacheado, false);
});

test("fuera de una petición se guarda igual, sin tenant", async () => {
  const r = recolector();
  assert.equal(contextoDeUso(), null);
  await registrarUso({ proveedor: "anthropic", modelo: "claude-sonnet-5", usage: { output_tokens: 100 } }, { crear: r.crear });
  assert.equal(r.filas[0].tenantId, null);
  assert.equal(r.filas[0].accion, null);
  assert.equal(r.filas[0].costeUsd, 0.001);
});

test("una respuesta reutilizada cuenta como llamada a coste cero y sin tokens", async () => {
  const r = recolector();
  await registrarUso({ proveedor: "anthropic", modelo: "claude-haiku-4-5-20251001", cacheado: true, usage: { output_tokens: 999 } }, { crear: r.crear });
  assert.equal(r.filas[0].cacheado, true);
  assert.equal(r.filas[0].costeUsd, 0);
  assert.equal(r.filas[0].outputTokens, 0);
});

test("Whisper se apunta por segundos de audio y con su precio por minuto", async () => {
  const r = recolector();
  await registrarUso({ proveedor: "openai", modelo: "whisper-1", segundosAudio: 120 }, { crear: r.crear });
  assert.equal(r.filas[0].proveedor, "openai");
  assert.equal(r.filas[0].segundosAudio, 120);
  assert.equal(r.filas[0].costeUsd, 0.012);
});

test("si la base falla, registrar devuelve false y NO lanza", async () => {
  const ok = await registrarUso({ proveedor: "anthropic", modelo: "claude-sonnet-5" }, { crear: async () => { throw new Error("sin tabla"); } });
  assert.equal(ok, false);
});
