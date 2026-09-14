/**
 * lib/assistant/turno.js — lo que decide un turno del Salamandrobot antes de
 * contestar (14/09/2026, tarea del Registro «El Salamandrobot busca fichas de
 * clientes sin comprobar que el centro o la persona tengan Clientes»).
 *
 * (Fichero nuevo en /lib, regla #2: sale de `app/api/assistant/route.js` para
 * poder probarlo sin Next —`withTenant` y `aiAccess.js` arrastran
 * `next/server`—, y porque cada «si pasa X no hagas Y» es un `if` con nombre
 * en `lib/` y con prueba: `scripts/_smoke-salamandrobot-turno.mjs`.)
 *
 * ── LO QUE PASABA ──────────────────────────────────────────────────────────
 * El bot no tiene moduleKey: lo ve cualquiera con sesión. Pero buscaba en
 * `Client` por las palabras de la pregunta SIN mirar si el centro y la persona
 * tienen Clientes, y sin la regla de las consultas externas
 * (`lib/clients/consultaExterna.js`, que nombra «el buscador» entre los sitios
 * que la necesitan): un empleado recibía nombres y enlaces de fichas que en
 * `/clientes` no ve, y esos nombres iban además al prompt de la IA.
 *
 * ── EL ORDEN DE UN TURNO ───────────────────────────────────────────────────
 *   1. Fichas: solo con `hasModule("clients")` (cruza `tenant_modules` con
 *      `users.module_access`) y con el mismo filtro de consultas externas que
 *      `GET /api/clients`.
 *   2. Modo (`lib/ai/modoDeIa.js`): simulado en las cuatro demos o por
 *      entorno; si no, la clave del proveedor del centro.
 *   3. `vetoAi` SOLO si se va a gastar IA. Si dice que no (candado 403 o tope
 *      de gasto 429), el bot NO devuelve ese error: contesta sin IA y lleva la
 *      frase del servidor en `avisoIA`, el mismo campo que ya usa cuando la IA
 *      falla (13/09/2026) y que la pantalla pinta en ámbar. El bot «funciona
 *      con o sin IA» (cabecera de `answer.js`).
 *
 * `vetoAi` llega inyectado. Si hay que gastar IA y no llega, se lanza: nunca
 * IA sin candado.
 */
import { Op } from "sequelize";
import { filtroPorAtributos } from "../utils/busquedaDb.js";
import { filtroDeVisibilidad, veTodasLasExternas } from "../clients/consultaExterna.js";
import { resolveCurrentTeamMemberId } from "../team/currentTeamMember.js";
import { modoDeIa } from "../ai/modoDeIa.js";
import { fakeEnabled } from "./answer.js";
import { findRelevant } from "./knowledge.js";

export const ACCION_DEL_BOT = "el asistente Salamandrobot";

const NO_SON_NOMBRES = new Set(["como", "donde", "cuando", "para", "que", "los", "las", "una", "cliente", "clientes", "busca", "buscar"]);

/** Las palabras sueltas de la pregunta, sin tildes y sin las de relleno. */
export function palabrasDeLaPregunta(query) {
  return String(query ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\W+/)
    .filter((w) => w.length >= 3 && !NO_SON_NOMBRES.has(w));
}

/** ¿Puede ESTA persona buscar fichas? Centro ∩ persona: `hasModule` cruza los dos. */
export function puedeBuscarFichas(ctx) {
  return typeof ctx?.hasModule === "function" && !!ctx.hasModule("clients");
}

/**
 * Las fichas que casan con la pregunta y que esta persona puede ver: sin
 * Clientes, ninguna; y las consultas externas ajenas, fuera (mismo filtro que
 * `GET /api/clients`). Solo id y nombre, seis como mucho. Nunca lanza.
 */
export async function buscarFichasDelBot(ctx, query, request) {
  if (!puedeBuscarFichas(ctx)) return [];
  const Client = ctx.tenantModels?.Client;
  if (!Client) return [];
  const words = palabrasDeLaPregunta(query);
  if (!words.length) return [];
  try {
    // La pregunta ya venía sin tildes; el NOMBRE de la base sí las lleva, así
    // que «munoz» no encontraba a los Muñoz (10/09/2026). `filtroPorAtributos`
    // normaliza los dos lados. Sigue siendo un O entre palabras: aquí no se
    // busca un nombre, se pescan las palabras sueltas de una pregunta.
    const porPalabra = (await Promise.all(words.map((w) => filtroPorAtributos(Client, w, ["name"])))).filter(Boolean);
    if (!porPalabra.length) return [];

    // Rol fresco (withTenant reescribe la cabecera); sin él, el de `user`:
    // falla en cerrado.
    const rol = request?.headers?.get?.("x-user-role") ?? ctx.user?.role ?? "user";
    const soyDelEquipo =
      veTodasLasExternas(rol) || !request || !ctx.hasModule("team")
        ? null
        : await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    const externas = filtroDeVisibilidad(rol, soyDelEquipo);

    // `Op.and` y no un segundo `Op.or`: asignarlo dos veces pisa el primero en
    // silencio (aviso de `lib/utils/busquedaDb.js`).
    const rows = await Client.findAll({
      where: { [Op.and]: [{ [Op.or]: porPalabra }, externas].filter(Boolean) },
      attributes: ["id", "name"],
      limit: 6,
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  } catch {
    return [];
  }
}

const AVISO_POR_DEFECTO = "Ahora mismo no puedes usar la IA del asistente: te contesto con la ayuda del CRM, sin IA.";

/** La frase del veto (403 del candado o 429 del tope), o una genérica si no se lee. */
async function textoDelVeto(veto) {
  try {
    const j = await veto.json();
    if (typeof j?.error === "string" && j.error.trim()) return j.error.trim();
  } catch {
    /* sin cuerpo legible */
  }
  return AVISO_POR_DEFECTO;
}

/**
 * Prepara el turno: fichas → modo → clave → `vetoAi` solo si se gasta IA.
 * Con veto: `apiKey` a null (no se gasta) y la frase en `avisoIA`.
 *
 * @returns {{ query, relevant, clients, simulado, apiKey, model, avisoIA }}
 */
export async function prepararTurno({ ctx, request, messages }, { vetoAi } = {}) {
  const query = [...(messages || [])].reverse().find((m) => m.role === "user")?.content || "";
  const relevant = findRelevant(query);
  const clients = await buscarFichasDelBot(ctx, query, request);
  const ia = modoDeIa(ctx, { simuladoPorEntorno: fakeEnabled() });
  let apiKey = ia.apiKey;
  let avisoIA = null;
  if (ia.gastaIa) {
    if (typeof vetoAi !== "function") throw new Error("prepararTurno necesita vetoAi para gastar IA");
    const veto = await vetoAi(ctx, request, ACCION_DEL_BOT);
    if (veto) {
      apiKey = null;
      avisoIA = await textoDelVeto(veto);
    }
  }
  return { query, relevant, clients, simulado: ia.simulado, apiKey, model: ia.model, avisoIA };
}
