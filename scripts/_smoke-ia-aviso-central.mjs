// @prueba ligera — sustituye `fetch` y monta el contexto a mano; sin base, sin servidor, sin claves.
/**
 * _smoke-ia-aviso-central.mjs — el aviso a dirección sale del CLIENTE que habla
 * con el proveedor, no de cada ruta (13/09/2026).
 *
 *   node scripts/_smoke-ia-aviso-central.mjs
 *
 * Hasta el 13/09/2026 la campana `ai_cuenta` («la cuenta de IA se ha quedado
 * sin saldo») la ponían 7 rutas de 20 desde su catch, y Whisper no avisaba
 * nunca porque sus errores no llevaban `status`. Desde ese día los cuatro
 * clientes —Anthropic de texto, el del bot, OpenAI y Whisper— pasan cada fallo
 * por `lib/ai/trasFalloDeIa.js`, que avisa con el gancho que la petición deja
 * en su contexto (`withTenant` / `withPublicTenant`).
 *
 * Aquí se prueba lo que DEVUELVEN: qué error sube (código, estado, frase),
 * cuántos avisos salen, qué contesta un sustituto sin IA, y que el envoltorio
 * público sigue devolviendo lo mismo con el contexto abierto. El proveedor es
 * un `fetch` falso: ninguna llamada sale de la máquina.
 *
 * Por qué se fija DATABASE_URL a una base que no existe: una llamada que SÍ
 * sale bien apunta su coste en `master.ai_uso` (best-effort). Con la variable
 * del shell de quien la lanza, una prueba «ligera» escribiría una fila en su
 * base local. Así falla al conectar, lo avisa por consola (`[ai:uso]`, es
 * esperado) y no escribe nada en ningún sitio.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

for (const k of ["CITAS_FAKE_AI", "ASSISTANT_FAKE_AI", "OUTREACH_FAKE_AI", "CALENDAR_FAKE_AI", "CLINICA_FAKE_AI"]) {
  delete process.env[k];
}
process.env.DATABASE_URL = "postgres://nadie:nada@127.0.0.1:1/ninguna";

register(new URL("./_abrir-lib-hooks.mjs", import.meta.url));
const { conContextoDeUso, contextoDeUso } = await import("../lib/ai/usoDeIA.js");
const { esFalloDeSaldo } = await import("../lib/ai/errorLegible.js");
const { datosDelContexto } = await import("../lib/ai/avisoDeCuentaIa.js");
const { trasFalloDeIa } = await import("../lib/ai/trasFalloDeIa.js");
const { transcribeAudio, transcribirVarios, errorDeWhisper } = await import("../lib/clinica/whisper.js");
const { completeConParada } = await import("../lib/outreach/analysis/anthropic.js");
const { chat } = await import("../lib/assistant/anthropic.js");
const { reorganizeWeek } = await import("../lib/calendar/reorganizeWeek.js");
const { chooseSlots } = await import("../lib/citas/suggestSlots.js");
const { answerQuestion } = await import("../lib/assistant/answer.js");
const { ticketAiClassify } = await import("../lib/support/ai.js");
const { withPublicTenant } = await import("../lib/tenant/publicTenantContext.js");
const { cacheSet } = await import("../lib/tenant/tenantCache.js");
const { AppError } = await import("../lib/utils/errors.js");

const GPT = "gpt-5.6-luna";
const HAIKU = "claude-haiku-4-5-20251001";

/** El proveedor responde siempre `status` + `cuerpo`; se repone el fetch de verdad al salir. */
async function conFetch({ status, cuerpo }, fn) {
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas += 1;
    return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
  };
  try {
    return await fn(() => llamadas);
  } finally {
    globalThis.fetch = original;
  }
}

/** Corre `fn` dentro de un contexto de petición cuyo gancho solo apunta los errores. */
async function conAvisos(fn) {
  const avisos = [];
  const r = await conContextoDeUso({ tenantId: "t1", userId: "u1", avisarFalloDeCuenta: async (e) => avisos.push(e) }, fn);
  return { avisos, r };
}

/** Lo que devuelve la promesa, sea resolución o rechazo. */
async function resultado(promesa) {
  try {
    return { valor: await promesa, error: null };
  } catch (error) {
    return { valor: null, error };
  }
}

const audio = (nombre = "a.webm") => new File([new Uint8Array(64)], nombre, { type: "audio/webm" });

const OPENAI_401 = { status: 401, cuerpo: { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } } };
const OPENAI_SIN_SALDO = { status: 429, cuerpo: { error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" } } };
const OPENAI_LIMITE = { status: 429, cuerpo: { error: { message: "Rate limit reached for whisper-1", type: "requests", code: "rate_limit_exceeded" } } };
const OPENAI_403 = { status: 403, cuerpo: { error: { message: "You do not have access", type: "invalid_request_error", code: null } } };
const OPENAI_500 = { status: 500, cuerpo: { error: { message: "The server had an error", type: "server_error", code: null } } };
const ANTHROPIC_401 = { status: 401, cuerpo: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } };

/* ── Whisper ─────────────────────────────────────────────────────────────── */

describe("Whisper habla el idioma de errorLegible y avisa", () => {
  it("401: BAD_KEY con status y proveedor, frase de clave caducada y un aviso", async () => {
    const { avisos, r } = await conAvisos(() => conFetch(OPENAI_401, () => resultado(transcribeAudio({ file: audio(), apiKey: "k" }))));
    assert.equal(r.error?.code, "BAD_KEY");
    assert.equal(r.error.status, 401);
    assert.equal(r.error.proveedor, "openai");
    assert.match(r.error.message, /La clave de OpenAI de este cliente no es válida o ha caducado/);
    assert.equal(avisos.length, 1);
  });

  it("429 sin saldo: QUOTA, es sin saldo, dice dónde se recarga y avisa", async () => {
    const { avisos, r } = await conAvisos(() => conFetch(OPENAI_SIN_SALDO, () => resultado(transcribeAudio({ file: audio(), apiKey: "k" }))));
    assert.equal(r.error?.code, "QUOTA");
    assert.equal(esFalloDeSaldo(r.error), true);
    assert.match(r.error.message, /sin saldo.*platform\.openai\.com/);
    assert.equal(avisos.length, 1);
  });

  it("429 de límite por minuto: NO es sin saldo, dice límite y también avisa", async () => {
    const { avisos, r } = await conAvisos(() => conFetch(OPENAI_LIMITE, () => resultado(transcribeAudio({ file: audio(), apiKey: "k" }))));
    assert.equal(r.error?.code, "QUOTA");
    assert.equal(esFalloDeSaldo(r.error), false);
    assert.match(r.error.message, /límite de uso/);
    assert.equal(avisos.length, 1);
  });

  it("403: BAD_KEY con su propia frase (el modelo de Whisper no lo elige el centro)", async () => {
    const { avisos, r } = await conAvisos(() => conFetch(OPENAI_403, () => resultado(transcribeAudio({ file: audio(), apiKey: "k" }))));
    assert.equal(r.error?.code, "BAD_KEY");
    assert.match(r.error.message, /transcribir audio/);
    assert.doesNotMatch(r.error.message, /modelo elegido/);
    assert.equal(avisos.length, 1);
  });

  it("500: ERROR y ningún aviso (no es la cuenta)", async () => {
    const { avisos, r } = await conAvisos(() => conFetch(OPENAI_500, () => resultado(transcribeAudio({ file: audio(), apiKey: "k" }))));
    assert.equal(r.error?.code, "ERROR");
    assert.equal(r.error.status, 500);
    assert.equal(avisos.length, 0);
  });

  it("sin clave no llega a OpenAI ni avisa: sigue siendo NO_OPENAI_KEY", async () => {
    const { avisos, r } = await conAvisos(() =>
      conFetch(OPENAI_401, async (llamadas) => ({ ...(await resultado(transcribeAudio({ file: audio(), apiKey: "" }))), n: llamadas() }))
    );
    assert.equal(r.error?.code, "NO_OPENAI_KEY");
    assert.equal(r.n, 0);
    assert.equal(avisos.length, 0);
  });

  it("transcribirVarios: cada audio recoge su BAD_KEY con la frase legible, y cada uno intentó avisar", async () => {
    const { avisos, r } = await conAvisos(() =>
      conFetch(OPENAI_401, () => transcribirVarios({ files: [audio("uno.webm"), audio("dos.webm")], apiKey: "k" }))
    );
    assert.equal(r.resultados.length, 2);
    assert.ok(r.resultados.every((x) => x.code === "BAD_KEY"));
    assert.ok(r.resultados.every((x) => /no es válida o ha caducado/.test(x.error)));
    // Dos errores distintos, dos intentos: la ventana de 12 h y el índice
    // único los dejan en una campana en la base.
    assert.equal(avisos.length, 2);
  });

  it("errorDeWhisper sin cuerpo: el estado basta", () => {
    const e = errorDeWhisper(429, null);
    assert.equal(e.code, "QUOTA");
    assert.equal(e.status, 429);
    assert.match(e.message, /límite de uso/);
  });
});

/* ── los clientes de texto ───────────────────────────────────────────────── */

describe("los clientes de texto avisan una sola vez y relanzan el MISMO error", () => {
  it("completeConParada con ChatGPT y 401: rechaza con el 401 y un aviso", async () => {
    const { avisos, r } = await conAvisos(() =>
      conFetch(OPENAI_401, () => resultado(completeConParada({ model: GPT, apiKey: "k", system: "s", user: "401 gpt" })))
    );
    assert.equal(r.error?.status, 401);
    assert.equal(r.error.code, "invalid_api_key");
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0], r.error);
  });

  it("completeConParada con Claude y 401: rechaza con el 401 y un aviso", async () => {
    const { avisos, r } = await conAvisos(() =>
      conFetch(ANTHROPIC_401, () => resultado(completeConParada({ model: HAIKU, apiKey: "k", system: "s", user: "401 claude" })))
    );
    assert.equal(r.error?.status, 401);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0], r.error);
  });

  it("el chat del bot con ChatGPT y 429 sin saldo: un aviso", async () => {
    const { avisos, r } = await conAvisos(() =>
      conFetch(OPENAI_SIN_SALDO, () => resultado(chat({ system: "s", messages: [{ role: "user", content: "hola" }], model: GPT, apiKey: "k" })))
    );
    assert.equal(r.error?.status, 429);
    assert.equal(avisos.length, 1);
  });

  it("el chat del bot con Claude y 401: un aviso", async () => {
    const { avisos, r } = await conAvisos(() =>
      conFetch(ANTHROPIC_401, () => resultado(chat({ system: "s", messages: [{ role: "user", content: "hola" }], model: HAIKU, apiKey: "k" })))
    );
    assert.equal(r.error?.status, 401);
    assert.equal(avisos.length, 1);
  });

  it("fuera de una petición el error sube igual y nada revienta por el gancho", async () => {
    const r = await conFetch(OPENAI_401, () => resultado(completeConParada({ model: GPT, apiKey: "k", system: "s", user: "sin contexto" })));
    assert.equal(r.error?.status, 401);
  });

  it("un gancho que LANZA no cambia el error: sube el 401 original", async () => {
    const r = await conContextoDeUso(
      {
        avisarFalloDeCuenta: async () => {
          throw new Error("la base se ha caído");
        },
      },
      () => conFetch(OPENAI_401, () => resultado(completeConParada({ model: GPT, apiKey: "k", system: "s", user: "gancho roto" })))
    );
    assert.equal(r.error?.status, 401);
    assert.doesNotMatch(r.error.message, /base se ha caído/);
  });

  it("un fallo que no es de la cuenta no despierta el gancho", async () => {
    const { avisos, r } = await conAvisos(() =>
      conFetch(OPENAI_500, () => resultado(completeConParada({ model: GPT, apiKey: "k", system: "s", user: "500" })))
    );
    assert.equal(r.error?.status, 500);
    assert.equal(avisos.length, 0);
  });

  it("trasFalloDeIa con un contexto sin gancho no hace nada y no lanza", async () => {
    await trasFalloDeIa(Object.assign(new Error("x"), { status: 401 }), {}, { contexto: { avisarFalloDeCuenta: null } });
    await trasFalloDeIa(Object.assign(new Error("x"), { status: 401 }), {}, { contexto: null });
  });
});

/* ── la cadena entera, con el gancho de verdad ───────────────────────────── */

describe("de la llamada a la campana, con datosDelContexto", () => {
  it("un 429 sin saldo de OpenAI deja UNA campana ai_cuenta que nombra la cuenta y dónde recargar", async () => {
    const creadas = [];
    const Notification = {
      async findOne() {
        return null;
      },
      async create(fila) {
        creadas.push(fila);
        return fila;
      },
    };
    const ctxFalso = { tenant: { id: "t1" }, tenantModels: { Notification } };
    const r = await conContextoDeUso(datosDelContexto(ctxFalso, {}, { buscarAdmins: async () => [{ id: "a1" }] }), () =>
      conFetch(OPENAI_SIN_SALDO, () => resultado(completeConParada({ model: GPT, apiKey: "k", system: "s", user: "cadena" })))
    );
    assert.equal(r.error?.status, 429);
    assert.equal(creadas.length, 1);
    assert.equal(creadas[0].type, "ai_cuenta");
    assert.equal(creadas[0].userId, "a1");
    assert.match(creadas[0].title, /OpenAI.*sin saldo/);
    assert.match(creadas[0].body, /platform\.openai\.com/);
  });

  it("un 403 de Whisper deja su propia campana, que no manda al modelo elegido ni se confunde con el 403 del chat", async () => {
    const creadas = [];
    const Notification = {
      async findOne({ where }) {
        return creadas.find((c) => c.userId === where.userId && c.title === where.title) ?? null;
      },
      async create(fila) {
        creadas.push(fila);
        return fila;
      },
    };
    const ctxFalso = { tenant: { id: "t1" }, tenantModels: { Notification } };
    const datos = datosDelContexto(ctxFalso, {}, { buscarAdmins: async () => [{ id: "a1" }] });
    const audio403 = await conContextoDeUso(datos, () =>
      conFetch(OPENAI_403, () => resultado(transcribeAudio({ file: audio(), apiKey: "k" })))
    );
    const chat403 = await conContextoDeUso(datos, () =>
      conFetch(OPENAI_403, () => resultado(completeConParada({ model: GPT, apiKey: "k", system: "s", user: "403 chat" })))
    );
    assert.equal(audio403.error?.status, 403);
    assert.equal(chat403.error?.status, 403);
    // Dos causas, dos campanas: la ventana de 12 h va por título.
    assert.equal(creadas.length, 2);
    assert.equal(creadas[0].title, "La clave de OpenAI no puede transcribir audio");
    assert.match(creadas[0].body, /transcribir audio/);
    assert.doesNotMatch(creadas[0].body, /modelo elegido/);
    // Lo que ve dirección es lo mismo que ve quien pulsa.
    assert.equal(creadas[0].body, audio403.error.message);
    assert.equal(creadas[1].title, "La clave de OpenAI no tiene permiso");
  });

  it("el contexto solo acepta una función como gancho", async () => {
    assert.equal(await conContextoDeUso({ avisarFalloDeCuenta: "no" }, () => contextoDeUso().avisarFalloDeCuenta), null);
    assert.equal(await conContextoDeUso({}, () => contextoDeUso().avisarFalloDeCuenta), null);
  });
});

/* ── los sustitutos sin IA lo dicen ──────────────────────────────────────── */

describe("los sustitutos sin IA siguen funcionando, pero lo dicen con avisoIA", () => {
  const weekDates = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"];
  const tasks = [
    { id: "t1", title: "Informe", priority: "high", startDate: "2026-09-14", teamMemberName: null },
    { id: "t2", title: "Llamadas", priority: "low", startDate: "2026-09-14", teamMemberName: null },
  ];

  it("reorganizeWeek con 429 sin saldo: tres propuestas sin IA y el motivo", async () => {
    const { avisos, r } = await conAvisos(() =>
      conFetch(OPENAI_SIN_SALDO, () => reorganizeWeek({ tasks, weekDates, apiKey: "k", model: GPT }))
    );
    assert.equal(r.model, "sin-ia");
    assert.equal(r.proposals.length, 3);
    assert.match(r.avisoIA, /sin saldo/);
    assert.match(r.avisoIA, /calculadas sin IA\.$/);
    assert.equal(avisos.length, 1);
  });

  it("chooseSlots con 401: tres huecos sin IA y la clave caducada dicha", async () => {
    const candidates = [1, 2, 3, 4].map((i) => ({
      slotId: `m1|2026-09-1${i}T08:00:00.000Z`,
      datetime: `2026-09-1${i}T08:00:00.000Z`,
      teamMemberId: "m1",
      teamMemberName: "Ana",
      label: `día ${i}`,
    }));
    const { r } = await conAvisos(() =>
      conFetch(OPENAI_401, () => chooseSlots({ candidates, context: { duration: 60 }, apiKey: "k", model: GPT }))
    );
    assert.equal(r.model, "sin-ia");
    assert.equal(r.suggestions.length, 3);
    assert.match(r.avisoIA, /no es válida o ha caducado/);
    assert.match(r.avisoIA, /sin IA\.$/);
  });

  it("answerQuestion con 500: contesta con la ayuda del CRM y dice que la IA ha fallado por su lado", async () => {
    const { avisos, r } = await conAvisos(() =>
      conFetch(OPENAI_500, () =>
        answerQuestion({ messages: [{ role: "user", content: "facturas" }], relevant: [], clients: [], apiKey: "k", model: GPT })
      )
    );
    assert.equal(r.model, "sin-ia");
    assert.ok(r.answer.length > 0);
    assert.match(r.avisoIA, /por su lado/);
    assert.equal(avisos.length, 0);
  });

  it("sin clave, los sustitutos no llevan aviso: no ha fallado nada", async () => {
    const r = await reorganizeWeek({ tasks, weekDates, apiKey: null, model: GPT });
    assert.equal(r.model, "sin-ia");
    assert.equal(r.avisoIA, undefined);
  });
});

/* ── soporte: la clasificación ya no se traga el fallo del proveedor ────── */

describe("ticketAiClassify", () => {
  const ticket = { title: "No puedo entrar", description: "desde ayer" };
  const categories = [{ id: "c1", name: "Técnica" }];

  it("con un fallo del proveedor RECHAZA, para que quien llama lo cuente", async () => {
    const { avisos, r } = await conAvisos(() =>
      conFetch(OPENAI_401, () => resultado(ticketAiClassify({ ticket, categories, apiKey: "k", model: GPT })))
    );
    assert.equal(r.error?.status, 401);
    assert.equal(avisos.length, 1);
  });

  it("con una respuesta ilegible sigue devolviendo null", async () => {
    const r = await conFetch(
      { status: 200, cuerpo: { choices: [{ message: { content: "hola, no es JSON" }, finish_reason: "stop" }] } },
      () => ticketAiClassify({ ticket: { ...ticket, title: "ilegible" }, categories, apiKey: "k", model: GPT })
    );
    assert.equal(r, null);
  });
});

/* ── el envoltorio público con el contexto abierto ──────────────────────── */

describe("withPublicTenant: los 48 handlers públicos siguen devolviendo lo mismo", () => {
  const SLUG = "prueba_aviso_central";
  cacheSet(`tenant:${SLUG}`, {
    tenant: { id: "t-pub", slug: SLUG, name: "Centro de prueba", settings: {} },
    modules: [{ moduleKey: "citas", enabled: true }],
  });
  const rc = () => ({ params: Promise.resolve({ tenantSlug: SLUG }) });
  const peticion = () => new Request(`http://localhost/api/public/c/${SLUG}/reservar`, { method: "POST", body: "{}" });

  it("el handler recibe su contexto, corre dentro del de la petición y su respuesta pasa tal cual", async () => {
    const GET = withPublicTenant(
      async (request, _rc, tctx) => {
        const c = contextoDeUso();
        return Response.json(
          {
            slug: tctx.slug,
            citas: tctx.hasModule("citas"),
            cuerpo: await request.text(),
            tenantId: c?.tenantId,
            userId: c?.userId,
            impersonadorId: c?.impersonadorId,
            gancho: typeof c?.avisarFalloDeCuenta,
          },
          { status: 201, headers: { "x-marca": "si" } }
        );
      },
      { rateLimit: false }
    );
    const res = await GET(peticion(), rc());
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("x-marca"), "si");
    assert.deepEqual(await res.json(), {
      slug: SLUG,
      citas: true,
      cuerpo: "{}",
      tenantId: "t-pub",
      userId: null,
      impersonadorId: null,
      gancho: "function",
    });
    // El contexto no se queda pegado fuera de la petición.
    assert.equal(contextoDeUso(), null);
  });

  it("con el límite por IP de fábrica también llega al handler", async () => {
    const POST = withPublicTenant(async () => Response.json({ ok: true }));
    const res = await POST(peticion(), rc());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it("los errores siguen saliendo como antes: AppError con su código, lo demás 500, slug malo 404", async () => {
    const conAppError = withPublicTenant(async () => {
      throw new AppError("Ese hueco ya no está libre", 409);
    }, { rateLimit: false });
    const r1 = await conAppError(peticion(), rc());
    assert.equal(r1.status, 409);
    assert.deepEqual(await r1.json(), { ok: false, error: "Ese hueco ya no está libre" });

    const roto = withPublicTenant(async () => {
      throw new TypeError("x is not a function");
    }, { rateLimit: false });
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal((await roto(peticion(), rc())).status, 500);
    } finally {
      console.error = original;
    }

    const malo = withPublicTenant(async () => Response.json({ ok: true }), { rateLimit: false });
    const r3 = await malo(peticion(), { params: Promise.resolve({ tenantSlug: "NO-VALE" }) });
    assert.equal(r3.status, 404);
  });

  it("el gancho del contexto público no despierta con lo que no es de la cuenta", async () => {
    const GET = withPublicTenant(
      async () => Response.json({ n: await contextoDeUso().avisarFalloDeCuenta(new TypeError("bug nuestro")) }),
      { rateLimit: false }
    );
    assert.deepEqual(await (await GET(peticion(), rc())).json(), { n: 0 });
  });
});
