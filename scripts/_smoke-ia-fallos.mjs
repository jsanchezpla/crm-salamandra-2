// @prueba ligera — sustituye `fetch` y el destino de las filas; sin base, sin servidor, sin claves.
/**
 * _smoke-ia-fallos.mjs — las llamadas a la IA que FALLAN dejan rastro en
 * `master.ai_uso` (14/09/2026).
 *
 *   node scripts/_smoke-ia-fallos.mjs
 *
 * Hasta el 14/09/2026 solo apuntaba su fila la llamada que respondía: una
 * rechazada no dejaba nada, y el día que se acabara el saldo no se sabría
 * cuántas fueron ni por qué. Desde ese día `lib/ai/trasFalloDeIa.js` —por donde
 * pasan los cuatro clientes que hablan con un proveedor— deja una fila a coste
 * 0 con la causa en una palabra (`causaDelFallo`) y el estado HTTP, nunca el
 * mensaje del proveedor.
 *
 * Aquí se prueba lo que DEVUELVEN: la causa de cada error (con las clases
 * REALES del SDK de Anthropic —y con la forma minificada que tienen en el build
 * de producción— y los errores reales de OpenAI y Whisper), la
 * forma exacta de la fila y cuántas filas deja cada llamada, pasando por los
 * clientes de verdad con un `fetch` falso. Las filas van a un destino en
 * memoria (`destinoDeUsoParaPruebas`): ninguna prueba intenta escribir, y
 * DATABASE_URL apunta además a una base que no existe por si algo se escapara.
 *
 * Cada caso cuenta las filas EXACTAS tras dejar pasar 50 ms: un duplicado que
 * llegue un tick tarde, o una fila que no debía salir, no pasa en vacío. No se
 * prueban 429/5xx a través del SDK de Anthropic: reintenta (dos peticiones,
 * medio segundo) y deja igualmente UNA fila; esos estados van por `causaDelFallo`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

for (const k of ["CITAS_FAKE_AI", "ASSISTANT_FAKE_AI", "OUTREACH_FAKE_AI", "CALENDAR_FAKE_AI", "CLINICA_FAKE_AI"]) {
  delete process.env[k];
}
process.env.DATABASE_URL = "postgres://nadie:nada@127.0.0.1:1/ninguna";

register(new URL("./_abrir-lib-hooks.mjs", import.meta.url));
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const { conContextoDeUso, marcarAccion, registrarUso, registrarFallo, destinoDeUsoParaPruebas } = await import("../lib/ai/usoDeIA.js");
const { causaDelFallo, CAUSAS_DE_FALLO, esFalloDeSaldo, esErrorDeIa, mensajeDeErrorIa } = await import("../lib/ai/errorLegible.js");
const { trasFalloDeIa } = await import("../lib/ai/trasFalloDeIa.js");
const { completarConOpenAI, chatConOpenAI, errorDeOpenAI } = await import("../lib/ai/openai.js");
const { completeConParada } = await import("../lib/outreach/analysis/anthropic.js");
const { chat } = await import("../lib/assistant/anthropic.js");
const { transcribeAudio, transcribirVarios, errorDeWhisper, MAX_AUDIO_BYTES } = await import("../lib/clinica/whisper.js");

const GPT = "gpt-5.6-luna";
const HAIKU = "claude-haiku-4-5-20251001";

/* ── montaje ─────────────────────────────────────────────────────────────── */

const filas = [];
destinoDeUsoParaPruebas(async (fila) => {
  filas.push(fila);
});

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const unico = (texto) => `${texto} ${Math.random()}`; // que la caché de respuestas nunca conteste por el fetch

/** Corre `fn` con las filas vacías y devuelve lo que resolvió o rechazó y las filas, 50 ms después. */
async function capturar(fn) {
  filas.length = 0;
  let valor = null;
  let error = null;
  try {
    valor = await fn();
  } catch (e) {
    error = e;
  }
  await esperar(50);
  return { valor, error, filas: [...filas] };
}

/** `responder(url, init)` hace de proveedor; se repone el fetch de verdad al salir. */
async function conFetch(responder, fn) {
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = async (url, init) => {
    llamadas += 1;
    return responder(url, init);
  };
  try {
    return await fn(() => llamadas);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (status, cuerpo) => () =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

/** Sin consola durante `fn` (los avisos de «no se pudo registrar» son esperados en algún caso). */
async function callado(fn) {
  const w = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = w;
  }
}

const audio = (nombre = "a.webm") => new File([new Uint8Array(16)], nombre, { type: "audio/webm" });
const sdk = (Clase, status, cuerpo) => new Clase(status, cuerpo, `${status} lo que diga el SDK`, new Headers());

const ANTHROPIC_SIN_SALDO = {
  type: "error",
  error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
};
const ANTHROPIC_401 = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };
const OPENAI_SIN_SALDO = {
  error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" },
};
const OPENAI_LIMITE = { error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } };

/** Los cuatro contadores de tokens y el audio de una fila fallida van a 0. */
function sinConsumo(fila) {
  assert.equal(fila.costeUsd, 0);
  assert.equal(fila.inputTokens, 0);
  assert.equal(fila.cacheWriteTokens, 0);
  assert.equal(fila.cacheReadTokens, 0);
  assert.equal(fila.outputTokens, 0);
  assert.equal(fila.segundosAudio, 0);
  assert.equal(fila.parada, null);
  assert.equal(fila.cacheado, false);
}

/* ── causaDelFallo ───────────────────────────────────────────────────────── */

describe("causaDelFallo con las clases REALES del SDK de Anthropic (0.110)", () => {
  it("sin saldo es un 400 que se reconoce por el texto; otro 400 es petición", () => {
    assert.equal(causaDelFallo(sdk(Anthropic.BadRequestError, 400, ANTHROPIC_SIN_SALDO)), "saldo");
    assert.equal(
      causaDelFallo(sdk(Anthropic.BadRequestError, 400, { type: "error", error: { type: "invalid_request_error", message: "messages: empty" } })),
      "peticion"
    );
  });

  it("cada estado con su causa", () => {
    assert.equal(causaDelFallo(sdk(Anthropic.AuthenticationError, 401, ANTHROPIC_401)), "clave");
    assert.equal(causaDelFallo(sdk(Anthropic.PermissionDeniedError, 403, {})), "permiso");
    assert.equal(causaDelFallo(sdk(Anthropic.NotFoundError, 404, {})), "modelo");
    assert.equal(causaDelFallo(sdk(Anthropic.RateLimitError, 429, {})), "limite");
    assert.equal(causaDelFallo(sdk(Anthropic.InternalServerError, 500, {})), "proveedor");
    assert.equal(causaDelFallo(sdk(Anthropic.APIError, 529, { type: "error", error: { type: "overloaded_error" } })), "proveedor");
  });

  it("tiempo y red, que llegan con name «Error» y solo la clase lo dice", () => {
    assert.equal(causaDelFallo(new Anthropic.APIConnectionTimeoutError()), "tiempo");
    assert.equal(causaDelFallo(new Anthropic.APIConnectionError({ message: "fetch failed" })), "red");
    assert.equal(causaDelFallo(new Anthropic.APIUserAbortError()), "red");
  });

  it("y con las clases MINIFICADAS del build de producción, donde ni la clase lo dice", () => {
    // La misma forma que el chunk de `next build` (Turbopack) del SDK 0.110:
    // clases `r`, `s`, `i` y el timeout y la cancelación como clases anónimas.
    class r extends Error {}
    class s extends r {
      constructor(e, t, m) {
        super(m);
        this.status = e;
        this.error = t;
      }
    }
    class i extends s {
      constructor({ message: e, cause: c } = {}) {
        super(undefined, undefined, e || "Connection error.");
        if (c) this.cause = c;
      }
    }
    const [T, U] = [
      class extends i {
        constructor() {
          super({ message: "Request timed out." });
        }
      },
      class extends s {
        constructor() {
          super(undefined, undefined, "Request was aborted.");
        }
      },
    ];
    assert.equal(causaDelFallo(new T()), "tiempo");
    assert.equal(causaDelFallo(new i({ cause: new TypeError("fetch failed") })), "red");
    assert.equal(causaDelFallo(new i({ cause: new DOMException("aborted", "AbortError") })), "tiempo");
    assert.equal(causaDelFallo(new U()), "red");
    // La frase para el usuario y la marca de «error de IA» salen de la misma lectura.
    assert.equal(esErrorDeIa(new T()), true);
    assert.equal(esErrorDeIa(new i()), true);
    assert.match(mensajeDeErrorIa(new T(), "DEF"), /tardado demasiado/);
    assert.match(mensajeDeErrorIa(new i(), "DEF"), /No se ha podido conectar/);
    // Con estado o cuerpo del proveedor, el texto no decide nada.
    assert.equal(causaDelFallo(new s(500, { type: "error" }, "Connection error.")), "proveedor");
    assert.equal(causaDelFallo(new s(undefined, { type: "error", error: { type: "overloaded_error" } }, "Connection error.")), "proveedor");
    // Y un Error cualquiera sin esos mensajes sigue siendo «desconocido».
    assert.equal(causaDelFallo(new s(undefined, undefined, "otra cosa")), "desconocido");
  });

  it("el error que llega por el stream (sin status) se lee por su tipo", () => {
    const sse = (type) => new Anthropic.APIError(undefined, { type: "error", error: { type } }, undefined, new Headers());
    assert.equal(causaDelFallo(sse("overloaded_error")), "proveedor");
    assert.equal(causaDelFallo(sse("rate_limit_error")), "limite");
    assert.equal(causaDelFallo(sse("authentication_error")), "clave");
  });
});

describe("causaDelFallo con OpenAI, Whisper y lo que no salió", () => {
  it("OpenAI: el 429 sin saldo no es el 429 de límite", () => {
    assert.equal(causaDelFallo(errorDeOpenAI(429, OPENAI_SIN_SALDO)), "saldo");
    assert.equal(causaDelFallo(errorDeOpenAI(429, OPENAI_LIMITE)), "limite");
    assert.equal(causaDelFallo(errorDeOpenAI(400, { error: { message: "bad", type: "invalid_request_error" } })), "peticion");
    assert.equal(causaDelFallo(errorDeOpenAI(401, null)), "clave");
  });

  it("Whisper sin saldo se reconoce por el código del cuerpo, sin la frase en inglés", () => {
    const e = errorDeWhisper(429, { error: { code: "insufficient_quota", message: "cuota" } });
    assert.equal(e.code, "QUOTA");
    assert.doesNotMatch(JSON.stringify(e.error) + e.message, /exceeded your current quota/i);
    assert.equal(esFalloDeSaldo(e), true);
    assert.equal(causaDelFallo(e), "saldo");
    assert.equal(causaDelFallo(errorDeWhisper(403, null)), "permiso");
  });

  it("el corte de Whisper es tiempo o red según el error original, y el JSON roto es ilegible", () => {
    const unreachable = (cause) => Object.assign(new Error("x"), { code: "UNREACHABLE", proveedor: "openai", ...(cause ? { cause } : {}) });
    assert.equal(causaDelFallo(unreachable(new DOMException("This operation was aborted", "AbortError"))), "tiempo");
    assert.equal(causaDelFallo(unreachable(new TypeError("fetch failed"))), "red");
    assert.equal(causaDelFallo(unreachable(null)), "red");
    let roto;
    try {
      JSON.parse("no es json");
    } catch (e) {
      roto = e;
    }
    assert.equal(causaDelFallo(Object.assign(new Error("x"), { code: "ERROR", proveedor: "openai", cause: roto })), "ilegible");
    // El JSON roto de `lib/ai/openai.js` llega como error de red con la misma causa.
    assert.equal(causaDelFallo(Object.assign(new Error("x"), { name: "APIConnectionError", cause: roto })), "ilegible");
  });

  it("lo que no llegó a salir no tiene causa; lo que no se reconoce es «desconocido»", () => {
    for (const code of ["NO_API_KEY", "NO_OPENAI_KEY", "NO_FILE", "TOO_LARGE"]) {
      assert.equal(causaDelFallo(Object.assign(new Error("x"), { code })), null, code);
    }
    assert.equal(causaDelFallo(null), null);
    assert.equal(causaDelFallo(undefined), null);
    assert.equal(causaDelFallo("texto"), null);
    assert.equal(causaDelFallo(new Error("x")), "desconocido");
  });

  it("toda causa es una clave de CAUSAS_DE_FALLO, con etiqueta, y cabe en la columna", () => {
    const errores = [
      sdk(Anthropic.BadRequestError, 400, ANTHROPIC_SIN_SALDO),
      sdk(Anthropic.AuthenticationError, 401, {}),
      sdk(Anthropic.PermissionDeniedError, 403, {}),
      sdk(Anthropic.NotFoundError, 404, {}),
      sdk(Anthropic.RateLimitError, 429, {}),
      sdk(Anthropic.BadRequestError, 400, {}),
      new Anthropic.APIConnectionTimeoutError(),
      new Anthropic.APIConnectionError({ message: "x" }),
      Object.assign(new Error("x"), { cause: new SyntaxError("x") }),
      sdk(Anthropic.InternalServerError, 500, {}),
      new Error("x"),
    ];
    const vistas = new Set(errores.map(causaDelFallo));
    assert.deepEqual([...vistas].sort(), Object.keys(CAUSAS_DE_FALLO).sort());
    for (const [clave, etiqueta] of Object.entries(CAUSAS_DE_FALLO)) {
      assert.ok(clave.length <= 40 && typeof etiqueta === "string" && etiqueta.length > 0, clave);
    }
  });
});

/* ── registrarFallo y la fila ────────────────────────────────────────────── */

describe("registrarFallo: la fila de una llamada que falló", () => {
  it("lleva tenant, usuario y acción del contexto, a coste 0, con causa y estado", async () => {
    const r = await capturar(() =>
      conContextoDeUso({ tenantId: "t1", userId: "u1" }, async () => {
        marcarAccion("transcribir una sesión clínica");
        return registrarFallo({ proveedor: "anthropic", modelo: HAIKU, err: sdk(Anthropic.BadRequestError, 400, ANTHROPIC_SIN_SALDO), ms: 321 });
      })
    );
    assert.equal(r.valor, true);
    assert.equal(r.filas.length, 1);
    const [f] = r.filas;
    assert.equal(f.tenantId, "t1");
    assert.equal(f.userId, "u1");
    assert.equal(f.accion, "transcribir una sesión clínica");
    assert.equal(f.proveedor, "anthropic");
    assert.equal(f.modelo, HAIKU);
    assert.equal(f.ms, 321);
    sinConsumo(f);
    assert.equal(f.error, "saldo");
    assert.equal(f.errorHttp, 400);
  });

  it("NUNCA guarda el mensaje del proveedor (un 401 de OpenAI trae un trozo de la clave)", async () => {
    const err = errorDeOpenAI(401, { error: { message: "Incorrect API key provided: sk-proj-abcd1234", code: "invalid_api_key" } });
    const r = await capturar(() => registrarFallo({ proveedor: "openai", modelo: GPT, err, ms: 10 }));
    assert.equal(r.filas.length, 1);
    const texto = JSON.stringify(r.filas[0]);
    assert.doesNotMatch(texto, /sk-|Incorrect|abcd1234/);
    assert.equal(r.filas[0].error, "clave");
    assert.equal(r.filas[0].errorHttp, 401);
  });

  it("sin estado HTTP, errorHttp es null", async () => {
    const r = await capturar(() => registrarFallo({ proveedor: "anthropic", modelo: HAIKU, err: new Anthropic.APIConnectionTimeoutError(), ms: 120000 }));
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "tiempo");
    assert.equal(r.filas[0].errorHttp, null);
  });

  it("el MISMO error dos veces deja una sola fila", async () => {
    const err = errorDeOpenAI(500, null);
    const r = await capturar(async () => [
      await registrarFallo({ proveedor: "openai", modelo: GPT, err }),
      await registrarFallo({ proveedor: "openai", modelo: GPT, err }),
    ]);
    assert.deepEqual(r.valor, [true, false]);
    assert.equal(r.filas.length, 1);
  });

  it("lo que no salió hacia el proveedor no deja fila", async () => {
    const r = await capturar(() => registrarFallo({ proveedor: "openai", err: Object.assign(new Error("x"), { code: "NO_API_KEY" }) }));
    assert.equal(r.valor, false);
    assert.equal(r.filas.length, 0);
  });

  it("si guardar falla, devuelve false y no lanza", async () => {
    const r = await capturar(() =>
      callado(() =>
        registrarFallo(
          { proveedor: "openai", modelo: GPT, err: errorDeOpenAI(401, null) },
          {
            crear: async () => {
              throw new Error("sin columna error");
            },
          }
        )
      )
    );
    assert.equal(r.error, null);
    assert.equal(r.valor, false);
    assert.equal(r.filas.length, 0);
  });

  it("aunque le lleguen tokens, audio, caché o parada, la fila fallida va a 0", async () => {
    const r = await capturar(() =>
      registrarUso({
        proveedor: "openai",
        modelo: "whisper-1",
        segundosAudio: 60,
        usage: { input_tokens: 1000, output_tokens: 100 },
        cacheado: true,
        parada: "end_turn",
        error: "red",
        errorHttp: 1.5,
      })
    );
    assert.equal(r.filas.length, 1);
    sinConsumo(r.filas[0]);
    assert.equal(r.filas[0].error, "red");
    assert.equal(r.filas[0].errorHttp, null);
  });

  it("la fila de una llamada que RESPONDIÓ no lleva ni `error` ni `errorHttp`", async () => {
    const r = await capturar(() => registrarUso({ proveedor: "anthropic", modelo: HAIKU, usage: { input_tokens: 10, output_tokens: 5 }, ms: 3, parada: "end_turn" }));
    assert.equal(r.filas.length, 1);
    assert.ok(!("error" in r.filas[0]));
    assert.ok(!("errorHttp" in r.filas[0]));
    assert.ok(r.filas[0].costeUsd > 0);
  });
});

/* ── trasFalloDeIa: rastro y aviso ───────────────────────────────────────── */

describe("trasFalloDeIa deja el rastro de TODO fallo, y avisa solo de los de la cuenta", () => {
  it("un fallo de la cuenta: una fila y un aviso, y la fila ya está cuando vuelve", async () => {
    filas.length = 0;
    const avisos = [];
    const err = errorDeOpenAI(429, OPENAI_SIN_SALDO);
    await trasFalloDeIa(
      err,
      { proveedor: "openai", modelo: GPT, ms: 42 },
      { contexto: { tenantId: "t9", userId: "u9", accion: "pulir un informe", avisarFalloDeCuenta: async (e) => avisos.push(e) } }
    );
    // Sin esperar: el rastro termina antes de que quien llama relance.
    assert.equal(filas.length, 1);
    const [f] = filas;
    assert.equal(f.tenantId, "t9");
    assert.equal(f.userId, "u9");
    assert.equal(f.accion, "pulir un informe");
    assert.equal(f.proveedor, "openai");
    assert.equal(f.modelo, GPT);
    assert.equal(f.ms, 42);
    assert.equal(f.error, "saldo");
    assert.equal(f.errorHttp, 429);
    assert.deepEqual(avisos, [err]);
    await esperar(50);
    assert.equal(filas.length, 1);
  });

  it("un fallo de red: una fila y ningún aviso", async () => {
    const avisos = [];
    const r = await capturar(() =>
      trasFalloDeIa(
        new Anthropic.APIConnectionError({ message: "fetch failed" }),
        { proveedor: "anthropic", modelo: HAIKU, ms: 7 },
        { contexto: { tenantId: "t9", avisarFalloDeCuenta: async (e) => avisos.push(e) } }
      )
    );
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "red");
    assert.equal(avisos.length, 0);
  });

  it("un gancho de aviso que lanza no se lleva la fila", async () => {
    const r = await capturar(() =>
      callado(() =>
        trasFalloDeIa(
          errorDeOpenAI(401, null),
          { proveedor: "openai", modelo: GPT, ms: 1 },
          {
            contexto: {
              avisarFalloDeCuenta: async () => {
                throw new Error("la base se ha caído");
              },
            },
          }
        )
      )
    );
    assert.equal(r.error, null);
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "clave");
  });
});

/* ── los clientes de verdad, con un fetch falso ──────────────────────────── */

describe("OpenAI (lib/ai/openai.js): cada llamada fallida, UNA fila", () => {
  it("429 sin saldo en completarConOpenAI", async () => {
    const r = await conFetch(json(429, OPENAI_SIN_SALDO), () =>
      capturar(() => completarConOpenAI({ system: "s", user: unico("sin saldo"), model: GPT, apiKey: "sk-x", maxTokens: 5 }))
    );
    assert.equal(r.error?.status, 429);
    assert.equal(r.filas.length, 1);
    const [f] = r.filas;
    assert.equal(f.proveedor, "openai");
    assert.equal(f.modelo, GPT);
    assert.equal(f.error, "saldo");
    assert.equal(f.errorHttp, 429);
    assert.equal(typeof f.ms, "number");
    sinConsumo(f);
  });

  it("completeConParada con un modelo GPT pasa por el despacho y deja una sola fila", async () => {
    const r = await conFetch(json(429, OPENAI_LIMITE), () =>
      capturar(() => completeConParada({ system: "s", user: unico("despacho"), model: GPT, apiKey: "sk-x", maxTokens: 5 }))
    );
    assert.equal(r.error?.status, 429);
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "limite");
  });

  it("sin conexión en el chat: red, sin estado", async () => {
    const r = await conFetch(
      () => {
        throw new TypeError("fetch failed");
      },
      () => capturar(() => chatConOpenAI({ system: "s", messages: [{ role: "user", content: unico("red") }], model: GPT, apiKey: "sk-x" }))
    );
    assert.equal(r.error?.name, "APIConnectionError");
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "red");
    assert.equal(r.filas[0].errorHttp, null);
  });

  it("cortado por tiempo: tiempo", async () => {
    const r = await conFetch(
      () => {
        throw new DOMException("This operation was aborted", "AbortError");
      },
      () => capturar(() => completarConOpenAI({ system: "s", user: unico("tiempo"), model: GPT, apiKey: "sk-x", maxTokens: 5 }))
    );
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "tiempo");
  });

  it("un 200 que no es JSON: ilegible", async () => {
    const r = await conFetch(
      () => new Response("<html>no es json</html>", { status: 200, headers: { "content-type": "text/html" } }),
      () => capturar(() => completarConOpenAI({ system: "s", user: unico("ilegible"), model: GPT, apiKey: "sk-x", maxTokens: 5 }))
    );
    assert.ok(r.error);
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "ilegible");
  });

  it("sin clave no sale nada y no hay fila", async () => {
    const r = await conFetch(json(401, {}), async (llamadas) => ({
      ...(await capturar(() => completarConOpenAI({ system: "s", user: unico("sin clave"), model: GPT, apiKey: null }))),
      n: llamadas(),
    }));
    assert.equal(r.error?.code, "NO_API_KEY");
    assert.equal(r.n, 0);
    assert.equal(r.filas.length, 0);
  });

  it("y la que responde deja su fila de siempre, sin `error`", async () => {
    const r = await conFetch(
      json(200, { choices: [{ message: { content: "hola" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } }),
      () => capturar(() => completarConOpenAI({ system: "s", user: unico("bien"), model: GPT, apiKey: "sk-x", maxTokens: 5 }))
    );
    assert.equal(r.valor?.texto, "hola");
    assert.equal(r.filas.length, 1);
    assert.ok(!("error" in r.filas[0]));
  });
});

describe("Anthropic (lib/outreach/analysis/anthropic.js y el bot): cada llamada fallida, UNA fila", () => {
  it("400 sin saldo en completeConParada", async () => {
    const r = await conFetch(json(400, ANTHROPIC_SIN_SALDO), () =>
      capturar(() => completeConParada({ system: "s", user: unico("sin saldo claude"), model: HAIKU, apiKey: "sk-ant-x", maxTokens: 5 }))
    );
    assert.equal(r.error?.status, 400);
    assert.equal(r.filas.length, 1);
    const [f] = r.filas;
    assert.equal(f.proveedor, "anthropic");
    assert.equal(f.modelo, HAIKU);
    assert.equal(f.error, "saldo");
    assert.equal(f.errorHttp, 400);
    assert.equal(typeof f.ms, "number");
    sinConsumo(f);
  });

  it("lo mismo por streaming: la otra rama del mismo try", async () => {
    const r = await conFetch(json(400, ANTHROPIC_SIN_SALDO), () =>
      capturar(() => completeConParada({ system: "s", user: unico("stream"), model: HAIKU, apiKey: "sk-ant-x", maxTokens: 5, stream: true }))
    );
    assert.equal(r.error?.status, 400);
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "saldo");
  });

  it("401 en el chat del bot", async () => {
    const r = await conFetch(json(401, ANTHROPIC_401), () =>
      capturar(() => chat({ system: "s", messages: [{ role: "user", content: unico("bot") }], model: HAIKU, apiKey: "sk-ant-x" }))
    );
    assert.equal(r.error?.status, 401);
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "clave");
    assert.equal(r.filas[0].errorHttp, 401);
  });

  it("sin clave no hay fila", async () => {
    const r = await capturar(() => completeConParada({ system: "s", user: unico("sin clave claude"), model: HAIKU, apiKey: "" }));
    assert.equal(r.error?.code, "NO_API_KEY");
    assert.equal(r.filas.length, 0);
  });
});

describe("Whisper (lib/clinica/whisper.js): el código de siempre para las rutas, y la fila con su causa", () => {
  it("429 sin saldo: QUOTA con status, es sin saldo, y una fila saldo/429", async () => {
    const r = await conFetch(json(429, OPENAI_SIN_SALDO), () => capturar(() => transcribeAudio({ file: audio(), apiKey: "sk-x" })));
    assert.equal(r.error?.code, "QUOTA");
    assert.equal(r.error.status, 429);
    assert.equal(esFalloDeSaldo(r.error), true);
    assert.equal(r.filas.length, 1);
    const [f] = r.filas;
    assert.equal(f.proveedor, "openai");
    assert.equal(f.modelo, "whisper-1");
    assert.equal(f.error, "saldo");
    assert.equal(f.errorHttp, 429);
    sinConsumo(f);
  });

  it("401: BAD_KEY y una fila clave/401", async () => {
    const r = await conFetch(json(401, { error: { message: "Incorrect API key provided: sk-1234", code: "invalid_api_key" } }), () =>
      capturar(() => transcribeAudio({ file: audio(), apiKey: "sk-x" }))
    );
    assert.equal(r.error?.code, "BAD_KEY");
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "clave");
    assert.equal(r.filas[0].errorHttp, 401);
    assert.doesNotMatch(JSON.stringify(r.filas[0]), /sk-|Incorrect/);
  });

  it("cortado por tiempo: sigue siendo UNREACHABLE con su frase, y la fila dice tiempo", async () => {
    const r = await conFetch(
      () => {
        throw new DOMException("This operation was aborted", "AbortError");
      },
      () => capturar(() => transcribeAudio({ file: audio(), apiKey: "sk-x" }))
    );
    assert.equal(r.error?.code, "UNREACHABLE");
    assert.equal(r.error.message, "La transcripción tardó demasiado");
    assert.equal(r.error.name, "Error");
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "tiempo");
    assert.equal(r.filas[0].errorHttp, null);
  });

  it("sin conexión: UNREACHABLE y la fila dice red", async () => {
    const r = await conFetch(
      () => {
        throw new TypeError("fetch failed");
      },
      () => capturar(() => transcribeAudio({ file: audio(), apiKey: "sk-x" }))
    );
    assert.equal(r.error?.code, "UNREACHABLE");
    assert.equal(r.error.message, "No se pudo contactar con OpenAI");
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "red");
  });

  it("un 200 que no es JSON: ERROR y la fila dice ilegible", async () => {
    const r = await conFetch(
      () => new Response("no es json", { status: 200, headers: { "content-type": "text/plain" } }),
      () => capturar(() => transcribeAudio({ file: audio(), apiKey: "sk-x" }))
    );
    assert.equal(r.error?.code, "ERROR");
    assert.equal(r.error.message, "OpenAI no devolvió JSON válido");
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].error, "ilegible");
  });

  it("demasiado grande o sin clave: no sale nada y no hay fila", async () => {
    const r = await conFetch(json(200, { text: "x" }), async (llamadas) => {
      const grande = await capturar(() => transcribeAudio({ file: { size: MAX_AUDIO_BYTES + 1, name: "grande.webm" }, apiKey: "sk-x" }));
      const sinClave = await capturar(() => transcribeAudio({ file: audio(), apiKey: "" }));
      return { grande, sinClave, n: llamadas() };
    });
    assert.equal(r.grande.error?.code, "TOO_LARGE");
    assert.equal(r.grande.filas.length, 0);
    assert.equal(r.sinClave.error?.code, "NO_OPENAI_KEY");
    assert.equal(r.sinClave.filas.length, 0);
    assert.equal(r.n, 0);
  });

  it("la transcripción que sale bien lleva ya `ms`, y ni `error` ni `errorHttp`", async () => {
    const r = await conFetch(json(200, { text: " hola ", duration: 12.4 }), () => capturar(() => transcribeAudio({ file: audio(), apiKey: "sk-x" })));
    assert.deepEqual(r.valor, { text: "hola", durationSec: 12 });
    assert.equal(r.filas.length, 1);
    const [f] = r.filas;
    assert.equal(f.segundosAudio, 12);
    assert.equal(typeof f.ms, "number");
    assert.ok(!("error" in f));
    assert.ok(!("errorHttp" in f));
  });

  it("transcribirVarios con uno bien y otro mal: dos filas, la buena y la fallida", async () => {
    const r = await conFetch(
      (_url, init) => {
        const cuerpo = new TextDecoder("latin1").decode(init.body);
        return cuerpo.includes('filename="dos.webm"')
          ? json(500, { error: { message: "The server had an error", type: "server_error" } })()
          : json(200, { text: "hola", duration: 12 })();
      },
      () => capturar(() => transcribirVarios({ files: [audio("uno.webm"), audio("dos.webm")], apiKey: "sk-x" }))
    );
    assert.equal(r.error, null);
    assert.deepEqual(
      r.valor.resultados.map((x) => [x.nombre, x.code]),
      [
        ["uno.webm", null],
        ["dos.webm", "ERROR"],
      ]
    );
    assert.equal(r.filas.length, 2);
    const buena = r.filas.filter((f) => !("error" in f));
    const fallida = r.filas.filter((f) => "error" in f);
    assert.equal(buena.length, 1);
    assert.equal(buena[0].segundosAudio, 12);
    assert.equal(typeof buena[0].ms, "number");
    assert.equal(fallida.length, 1);
    assert.equal(fallida[0].error, "proveedor");
    assert.equal(fallida[0].errorHttp, 500);
  });
});
