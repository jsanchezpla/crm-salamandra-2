// @prueba ligera — funciones de /lib con el modelo Client y vetoAi sustituidos; sin base, sin servidor, sin .env.
/**
 * _smoke-salamandrobot-turno.mjs — el Salamandrobot solo busca las fichas que
 * la persona puede ver, y solo pasa por `vetoAi` cuando va a gastar IA
 * (14/09/2026, tarea del Registro «El Salamandrobot busca fichas de clientes
 * sin comprobar que el centro o la persona tengan Clientes»).
 *
 *   node scripts/_smoke-salamandrobot-turno.mjs
 *
 * ── LO QUE FIJA ─────────────────────────────────────────────────────────────
 *   · `buscarFichasDelBot`: sin Clientes (del centro o de la persona) no toca
 *     `Client`; con Clientes, id y nombre, seis como mucho, y el MISMO filtro de
 *     consultas externas que `GET /api/clients`, metido en `Op.and`.
 *   · `prepararTurno`: sin clave o en las cuatro demos no llama a `vetoAi` (ni
 *     `ai.uso` en master ni solicitud de permiso); con clave, una vez; si veta
 *     (candado 403 o tope 429), sin IA y con la frase en `avisoIA`; con clave y
 *     sin `vetoAi`, lanza.
 *   · `modoDeIa`: las cuatro demos y el simulado por entorno no dan clave; el
 *     proveedor elegido sin su clave cuenta como sin clave.
 *   · Por texto: las tres rutas usan esto y no queda `slug === "demo"`.
 *
 * `sequelize` aparece aquí como símbolo (`Op`) y en `sequelize: {}` del modelo
 * falso: por eso la marca de ligera va a mano.
 */

// `fakeEnabled()` lee el entorno en cada llamada y el runner hereda el del
// shell: con una de estas puestas, las aserciones de «sin simular» mentirían.
delete process.env.ASSISTANT_FAKE_AI;
delete process.env.OUTREACH_FAKE_AI;
delete process.env.CALENDAR_FAKE_AI;
delete process.env.CITAS_FAKE_AI;

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Op } from "sequelize";

import {
  prepararTurno,
  buscarFichasDelBot,
  palabrasDeLaPregunta,
  puedeBuscarFichas,
  ACCION_DEL_BOT,
} from "../lib/assistant/turno.js";
import { modoDeIa } from "../lib/ai/modoDeIa.js";
import { answerQuestion } from "../lib/assistant/answer.js";
import { filtroDeVisibilidad } from "../lib/clients/consultaExterna.js";
import { DEMO_SLUGS } from "../lib/demo/demos.js";
import { DEFAULT_ANTHROPIC_MODEL } from "../lib/ai/anthropicModel.js";
import { mensajeDeTopeAlcanzado, MOTIVO_TOPE } from "../lib/ai/topeDeGasto.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => readFileSync(join(RAIZ, rel), "utf8");

// ── Ayudantes ───────────────────────────────────────────────────────────────

function clienteFalso(filas = [], { lanza = false } = {}) {
  const llamadas = [];
  const modelo = {
    name: "Client",
    sequelize: {},
    getAttributes: () => ({ name: { field: "name" } }),
    llamadas,
    async findAll(o) {
      llamadas.push(o);
      if (lanza) throw new Error("relation does not exist");
      return filas;
    },
  };
  return modelo;
}

function equipoFalso(id) {
  const llamadas = [];
  return {
    llamadas,
    async findOne(o) {
      llamadas.push(o);
      return id ? { id } : null;
    },
  };
}

function ctxDe({ slug = "aumenta", modulos = [], integrations = {}, rol = "admin", Client, TeamMember } = {}) {
  return {
    slug,
    user: { id: "u1", role: rol },
    tenant: { name: "Centro", settings: { integrations } },
    hasModule: (k) => modulos.includes(k),
    tenantModels: { Client, TeamMember },
  };
}

function peticionDe(rol) {
  const h = { "x-user-id": "u1" };
  if (rol) h["x-user-role"] = rol;
  return { headers: new Headers(h) };
}

function vetoEspia(respuesta = null) {
  const espia = async (...args) => {
    espia.llamadas.push(args);
    return typeof respuesta === "function" ? respuesta() : respuesta;
  };
  espia.llamadas = [];
  return espia;
}

const msgs = [{ role: "user", content: "busca el cliente Muñoz" }];

// ── Qué fichas puede ver ────────────────────────────────────────────────────

describe("buscarFichasDelBot", () => {
  it("sin Clientes (del centro o de la persona) no consulta Client", async () => {
    const Client = clienteFalso([{ id: 1, name: "Ana Muñoz" }]);
    const ctx = ctxDe({ modulos: ["team", "citas"], Client });
    assert.equal(puedeBuscarFichas(ctx), false);
    assert.deepEqual(await buscarFichasDelBot(ctx, "Muñoz", peticionDe("admin")), []);
    assert.equal(Client.llamadas.length, 0);

    const sinHasModule = { ...ctx, hasModule: undefined };
    assert.equal(puedeBuscarFichas(sinHasModule), false);
    assert.deepEqual(await buscarFichasDelBot(sinHasModule, "Muñoz", peticionDe("admin")), []);
    assert.equal(Client.llamadas.length, 0);
  });

  it("admin con Clientes: por palabra, solo id y nombre, seis, sin filtro de externas", async () => {
    const Client = clienteFalso([{ id: 1, name: "Ana Muñoz", email: "x@y.z" }]);
    const TeamMember = equipoFalso("tm-1");
    const ctx = ctxDe({ modulos: ["clients", "team"], Client, TeamMember });
    assert.equal(puedeBuscarFichas(ctx), true);
    assert.deepEqual(await buscarFichasDelBot(ctx, "busca a Muñoz", peticionDe("admin")), [{ id: 1, name: "Ana Muñoz" }]);
    const [o] = Client.llamadas;
    assert.equal(o.limit, 6);
    assert.deepEqual(o.attributes, ["id", "name"]);
    assert.equal(o.where[Op.or], undefined, "nada de Op.or suelto en el where: se pisaría");
    assert.equal(o.where[Op.and].length, 1);
    assert.equal(TeamMember.llamadas.length, 0, "a un admin no hace falta buscarle la ficha de equipo");
  });

  it("si la consulta revienta, []", async () => {
    const Client = clienteFalso([], { lanza: true });
    const ctx = ctxDe({ modulos: ["clients"], Client });
    assert.deepEqual(await buscarFichasDelBot(ctx, "Muñoz", peticionDe("admin")), []);
  });

  it("un empleado con Equipo solo ve sus consultas externas", async () => {
    const Client = clienteFalso([]);
    const TeamMember = equipoFalso("tm-1");
    const ctx = ctxDe({ rol: "user", modulos: ["clients", "team"], Client, TeamMember });
    await buscarFichasDelBot(ctx, "Muñoz", peticionDe("user"));
    const y = Client.llamadas[0].where[Op.and];
    assert.equal(y.length, 2);
    assert.deepEqual(y[1], filtroDeVisibilidad("user", "tm-1"));
    assert.equal(TeamMember.llamadas.length, 1);
  });

  it("un empleado sin Equipo: ninguna consulta externa, y sin preguntar a TeamMember", async () => {
    const Client = clienteFalso([]);
    const TeamMember = equipoFalso("tm-1");
    const ctx = ctxDe({ rol: "user", modulos: ["clients"], Client, TeamMember });
    await buscarFichasDelBot(ctx, "Muñoz", peticionDe("user"));
    const y = Client.llamadas[0].where[Op.and];
    assert.deepEqual(y[1], filtroDeVisibilidad("user", null));
    assert.equal(TeamMember.llamadas.length, 0);
  });

  it("manda el rol de la cabecera (fresco de BD), no el del contexto", async () => {
    const Client = clienteFalso([]);
    const ctx = ctxDe({ rol: "admin", modulos: ["clients"], Client });
    await buscarFichasDelBot(ctx, "Muñoz", peticionDe("user"));
    assert.equal(Client.llamadas[0].where[Op.and].length, 2);
  });

  it("sin rol en ningún sitio se filtra como a un empleado (falla en cerrado)", async () => {
    const Client = clienteFalso([]);
    const ctx = { ...ctxDe({ modulos: ["clients"], Client }), user: { id: "u1" } };
    await buscarFichasDelBot(ctx, "Muñoz", peticionDe(null));
    const y = Client.llamadas[0].where[Op.and];
    assert.equal(y.length, 2);
    assert.deepEqual(y[1], filtroDeVisibilidad("user", null));
  });
});

describe("palabrasDeLaPregunta", () => {
  it("sin tildes y sin las de relleno", () => {
    assert.deepEqual(palabrasDeLaPregunta("busca el cliente Muñoz"), ["munoz"]);
    assert.deepEqual(palabrasDeLaPregunta("¿cómo hago una factura?"), ["hago", "factura"]);
    assert.deepEqual(palabrasDeLaPregunta(""), []);
    assert.deepEqual(palabrasDeLaPregunta(null), []);
  });
});

// ── Cuándo pasa por vetoAi ──────────────────────────────────────────────────

describe("prepararTurno", () => {
  it("sin clave y sin Clientes: ni consulta ni vetoAi, y contesta sin IA", async () => {
    const Client = clienteFalso([{ id: 1, name: "Ana Muñoz" }]);
    const veto = vetoEspia();
    const ctx = ctxDe({ Client });
    const t = await prepararTurno({ ctx, request: peticionDe("admin"), messages: msgs }, { vetoAi: veto });
    assert.equal(veto.llamadas.length, 0);
    assert.equal(Client.llamadas.length, 0);
    assert.equal(t.apiKey, null);
    assert.equal(t.simulado, false);
    assert.equal(t.avisoIA, null);
    assert.deepEqual(t.clients, []);
    const r = await answerQuestion({ messages: msgs, relevant: t.relevant, clients: t.clients, apiKey: t.apiKey, model: t.model, forceFake: t.simulado });
    assert.equal(r.model, "sin-ia");
    assert.ok(!r.answer.includes("Muñoz"));
  });

  it("con clave llama a vetoAi una vez y deja pasar la clave", async () => {
    const veto = vetoEspia(null);
    const ctx = ctxDe({ integrations: { anthropicApiKey: "sk-ant-prueba" } });
    const req = peticionDe("admin");
    const t = await prepararTurno({ ctx, request: req, messages: msgs }, { vetoAi: veto });
    assert.equal(veto.llamadas.length, 1);
    assert.equal(veto.llamadas[0][0], ctx);
    assert.equal(veto.llamadas[0][1], req);
    assert.equal(veto.llamadas[0][2], ACCION_DEL_BOT);
    assert.equal(t.apiKey, "sk-ant-prueba");
    assert.equal(t.model, DEFAULT_ANTHROPIC_MODEL);
    assert.equal(t.avisoIA, null);
  });

  it("con el candado (403): sin IA y con la frase, sin devolver el 403", async () => {
    const frase = "Usar la IA requiere permiso del administrador.";
    const veto = vetoEspia(() => Response.json({ ok: false, error: frase }, { status: 403 }));
    const ctx = ctxDe({ rol: "user", integrations: { anthropicApiKey: "sk-ant-prueba" } });
    const t = await prepararTurno({ ctx, request: peticionDe("user"), messages: msgs }, { vetoAi: veto });
    assert.equal(t.apiKey, null);
    assert.equal(t.avisoIA, frase);
    const r = await answerQuestion({ messages: msgs, relevant: t.relevant, clients: t.clients, apiKey: t.apiKey, model: t.model, forceFake: t.simulado });
    assert.equal(r.model, "sin-ia", "con veto no se llama a la IA");
  });

  it("con el tope de gasto (429): la frase de hasta cuándo llega igual", async () => {
    const frase = mensajeDeTopeAlcanzado(new Date());
    const veto = vetoEspia(() => Response.json({ ok: false, error: frase, motivo: MOTIVO_TOPE }, { status: 429 }));
    const ctx = ctxDe({ rol: "user", integrations: { anthropicApiKey: "sk-ant-prueba" } });
    const t = await prepararTurno({ ctx, request: peticionDe("user"), messages: msgs }, { vetoAi: veto });
    assert.equal(t.apiKey, null);
    assert.equal(t.avisoIA, frase);
  });

  it("un veto sin cuerpo legible deja un aviso genérico y sigue sin IA", async () => {
    const veto = vetoEspia(() => new Response("no json", { status: 403 }));
    const ctx = ctxDe({ rol: "user", integrations: { anthropicApiKey: "sk-ant-prueba" } });
    const t = await prepararTurno({ ctx, request: peticionDe("user"), messages: msgs }, { vetoAi: veto });
    assert.equal(t.apiKey, null);
    assert.equal(typeof t.avisoIA, "string");
    assert.ok(t.avisoIA.length > 0);
  });

  it("falla en cerrado: con clave y sin vetoAi, lanza; sin clave, no", async () => {
    const conClave = ctxDe({ integrations: { anthropicApiKey: "sk-ant-prueba" } });
    await assert.rejects(prepararTurno({ ctx: conClave, request: peticionDe("admin"), messages: msgs }));
    const sinClave = ctxDe();
    const t = await prepararTurno({ ctx: sinClave, request: peticionDe("admin"), messages: msgs });
    assert.equal(t.apiKey, null);
  });

  it("las cuatro demos simulan y no pasan por vetoAi aunque tuvieran clave", async () => {
    assert.equal(DEMO_SLUGS.length, 4);
    assert.ok(DEMO_SLUGS.includes("demo_clinica"));
    for (const slug of DEMO_SLUGS) {
      const ctx = ctxDe({ slug, integrations: { anthropicApiKey: "sk-ant-prueba" } });
      const ia = modoDeIa(ctx);
      assert.equal(ia.simulado, true, slug);
      assert.equal(ia.apiKey, null, slug);
      assert.equal(ia.gastaIa, false, slug);
      const veto = vetoEspia();
      const t = await prepararTurno({ ctx, request: peticionDe("admin"), messages: msgs }, { vetoAi: veto });
      assert.equal(veto.llamadas.length, 0, slug);
      assert.equal(t.simulado, true, slug);
      const r = await answerQuestion({ messages: msgs, relevant: t.relevant, clients: t.clients, apiKey: t.apiKey, model: t.model, forceFake: t.simulado });
      assert.equal(r.model, "fake", slug);
    }
  });
});

describe("modoDeIa", () => {
  it("ChatGPT elegido sin su clave cuenta como sin clave", async () => {
    const soloAnthropic = ctxDe({ integrations: { aiProvider: "openai", anthropicApiKey: "sk-ant" } });
    assert.equal(modoDeIa(soloAnthropic).gastaIa, false);
    const veto = vetoEspia();
    await prepararTurno({ ctx: soloAnthropic, request: peticionDe("admin"), messages: msgs }, { vetoAi: veto });
    assert.equal(veto.llamadas.length, 0);

    const conOpenAI = ctxDe({ integrations: { aiProvider: "openai", openaiApiKey: "sk-prueba" } });
    const ia = modoDeIa(conOpenAI);
    assert.equal(ia.gastaIa, true);
    assert.equal(ia.apiKey, "sk-prueba");
  });

  it("el simulado por entorno no da clave", () => {
    const ctx = ctxDe({ integrations: { anthropicApiKey: "sk-ant-prueba" } });
    assert.deepEqual(
      { ...modoDeIa(ctx, { simuladoPorEntorno: true }), model: undefined },
      { simulado: true, apiKey: null, gastaIa: false, model: undefined }
    );
    assert.equal(modoDeIa(ctx).gastaIa, true);
  });
});

// ── Cableado (texto: ¿sigue el `if` donde estaba?) ──────────────────────────

describe("las tres rutas", () => {
  it("el bot decide el turno en lib/assistant/turno.js", () => {
    const ruta = leer("app/api/assistant/route.js");
    assert.match(ruta, /from "[^"]*lib\/assistant\/turno\.js"/);
    // Sin `{ vetoAi }` el turno lanza con clave (falla en cerrado): 500 en todos los centros con IA.
    assert.match(ruta, /prepararTurno\(\{[^}]*\}, \{ vetoAi \}\)/);
    assert.ok(ruta.includes("forceFake: turno.simulado"));
    assert.match(ruta, /avisoIA: turno\.avisoIA \?\? result\.avisoIA/);
    for (const viejo of ["Client.findAll", "searchClients", "getTenantIaKey", "vetoAi(ctx"]) {
      assert.ok(!ruta.includes(viejo), `la ruta del bot todavía tiene ${viejo}`);
    }
  });

  it("reorganize y suggest-slots solo llaman a vetoAi si gastan IA", () => {
    for (const rel of ["app/api/calendar/reorganize/route.js", "app/api/citas/bookings/[id]/suggest-slots/route.js"]) {
      const ruta = leer(rel);
      assert.ok(ruta.includes("modoDeIa(ctx, { simuladoPorEntorno:"), rel);
      // El veto va con su `return`, y ANTES de la llamada a la IA: si se mueve
      // detrás, la IA ya se ha gastado cuando el candado dice que no.
      assert.match(ruta, /if \(ia\.gastaIa[^)]*\)\s*\{\s*const veto = await vetoAi\([^)]*\);\s*if \(veto\) return veto;/, rel);
      assert.equal(ruta.split("vetoAi(").length - 1, 1, `${rel}: una sola llamada a vetoAi`);
      const llamadaIa = rel.includes("reorganize") ? "reorganizeWeek({" : "chooseSlots({";
      assert.ok(ruta.includes(llamadaIa), `${rel}: no encuentro ${llamadaIa}`);
      assert.ok(ruta.indexOf("vetoAi(") < ruta.indexOf(llamadaIa), `${rel}: vetoAi tiene que ir antes de ${llamadaIa}`);
      assert.ok(ruta.includes("forceFake: ia.simulado"), rel);
      assert.ok(!ruta.includes("getTenantIaKey"), rel);
    }
  });

  it("la pantalla del bot no tiene rama propia del 403/429: pinta avisoIA", () => {
    const bot = leer("components/assistant/Salamandrobot.jsx");
    assert.ok(!bot.includes("r.status === 429"));
    assert.match(bot, /aviso: j\.data\.avisoIA/);
  });

  it("no queda ninguna comparación a mano con el slug de la demo", () => {
    const mal = /\bslug\s*===\s*["']demo["']|["']demo["']\s*===\s*[\w$.]*slug\b/;
    const hallados = [];
    for (const dir of ["app", "components", "modules", "lib"]) {
      for (const f of readdirSync(join(RAIZ, dir), { recursive: true })) {
        const rel = `${dir}/${String(f).replace(/\\/g, "/")}`;
        if (!/\.jsx?$/.test(rel) || rel === "lib/demo/isDemo.js") continue; // isDemo.js lo cita en un comentario
        if (mal.test(leer(rel))) hallados.push(rel);
      }
    }
    assert.deepEqual(hallados, []);
  });
});
