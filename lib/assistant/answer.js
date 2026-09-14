/**
 * lib/assistant/answer.js — cerebro del Salamandrobot.
 *
 * Decide cómo responder según la disponibilidad de IA:
 *   - MODO SIMULADO (fake): dev/demo con ASSISTANT_FAKE_AI=1 o OUTREACH_FAKE_AI=1
 *     (bloqueado en producción, como Captación) → respuesta canned útil, 0 coste.
 *   - CON IA: el tenant tiene clave de Anthropic (BYOK) → Claude responde en
 *     lenguaje natural usando la base de conocimiento + los datos encontrados.
 *     Y si la IA falla (13/09/2026, regla #2): se contesta SIN IA y lo dice,
 *     con `avisoIA` y el motivo legible. Antes el fallo lo recogía la ruta y
 *     salía una respuesta sin IA como si nada: una cuenta sin saldo no se
 *     notaba en el bot.
 *   - SIN IA: no hay clave ni modo simulado → respuesta compuesta de la base de
 *     conocimiento + clientes encontrados (el asistente "funciona sin IA").
 *
 * NINGÚN NOMBRE DE FICHA SALE HACIA EL PROVEEDOR (14/09/2026, Jorge, opción a):
 * minimización de datos de salud —Aumenta es un centro de psicología y sus
 * fichas son familias de pacientes—. El prompt de sistema solo lleva CUÁNTAS
 * fichas han salido; los nombres los enseña la pantalla como enlaces (`links`
 * de la ruta), que no salen del CRM. Tampoco los lleva el texto de la
 * respuesta sin IA: la pantalla lo devuelve como historial en el turno
 * siguiente y, si ese va con IA, los nombres viajarían igual. El simulado sí
 * los nombra: solo corre en las demos (datos falsos) o fuera de producción, y
 * nunca llama a un proveedor.
 *
 * Puro: no toca la BD. El endpoint le pasa `relevant` (base de conocimiento) y
 * `clients` (búsqueda ya hecha con los modelos del tenant).
 */
import { chat } from "./anthropic.js";
import { fakeAnswer } from "./fake.js";
import { knowledgeForPrompt } from "./knowledge.js";
import { avisoSinIa } from "../ai/errorLegible.js";

export function fakeEnabled() {
  return (
    (process.env.ASSISTANT_FAKE_AI === "1" || process.env.OUTREACH_FAKE_AI === "1") &&
    process.env.NODE_ENV !== "production"
  );
}

/** Cuántas fichas enseña la ruta como enlaces (`clients.slice(0, FICHAS_EN_ENLACES)`). */
export const FICHAS_EN_ENLACES = 4;

function cuentaDeFichas(clients) {
  const n = clients?.length || 0;
  return n ? { n, visibles: Math.min(n, FICHAS_EN_ENLACES) } : null;
}

/** Prompt de sistema hacia el proveedor: sin nombres ni ids de fichas. */
export function buildSystem({ companyName, clients }) {
  const f = cuentaDeFichas(clients);
  const found = f
    ? `\n\nLa búsqueda por las palabras de la pregunta ha encontrado ${f.n} ${f.n === 1 ? "ficha" : "fichas"} en el CRM. ` +
      `La pantalla enseña ${f.n === f.visibles ? (f.n === 1 ? "esa ficha" : "esas fichas") : `las ${f.visibles} primeras`} como enlaces debajo de tu respuesta. ` +
      "No las nombres ni inventes nombres: di solo cuántas han salido y que se abren desde los enlaces."
    : "";
  return [
    `Eres "Salamandrobot", el asistente del CRM de ${companyName || "la empresa"} (Salamandra Solutions).`,
    "Ayudas a los usuarios a usar el CRM: encontrar cosas, explicar cómo se hace algo y orientarles por los módulos.",
    "Responde SIEMPRE en español, breve y concreto (2-4 frases). Si procede, di a qué pantalla ir.",
    "No te inventes datos que no tengas. Si te piden un dato concreto que no está en el contexto, di cómo encontrarlo en el CRM.",
    "",
    "Módulos y dónde está cada cosa:",
    knowledgeForPrompt(),
    found,
  ].join("\n");
}

/**
 * Respuesta compuesta sin IA (base de conocimiento + cuántas fichas). Sin
 * nombres: la pantalla la devuelve como historial y el turno siguiente puede
 * ir con IA.
 */
export function noAiAnswer({ query, relevant, clients }) {
  const parts = [];
  const f = cuentaDeFichas(clients);
  if (f) {
    parts.push(f.n === 1
      ? "Ha salido 1 ficha que coincide: ábrela desde el enlace de abajo."
      : `Han salido ${f.n} fichas que coinciden: ${f.n === f.visibles ? "ábrelas" : `abre las ${f.visibles} primeras`} desde los enlaces de abajo.`);
  }
  if (relevant && relevant.length) {
    parts.push(relevant[0].help);
    if (relevant.length > 1) parts.push(`Relacionado: ${relevant.slice(1, 3).map((r) => r.title).join(", ")}.`);
  }
  if (!parts.length) {
    parts.push("Puedo ayudarte a encontrar clientes, facturas, citas o pacientes y a orientarte por el CRM. Reformula la pregunta o usa los enlaces de los módulos.");
  }
  return parts.join(" ");
}

export async function answerQuestion({ messages, relevant, clients, apiKey, model, companyName, forceFake = false }) {
  const query = [...(messages || [])].reverse().find((m) => m.role === "user")?.content || "";

  // forceFake = demo pública: respuesta simulada, sin llamar a la API real.
  if (fakeEnabled() || forceFake) {
    return { model: "fake", answer: fakeAnswer({ query, relevant, clients }) };
  }
  if (apiKey) {
    const system = buildSystem({ companyName, clients });
    try {
      const text = await chat({ system, messages, model, maxTokens: 700, apiKey });
      return { model, answer: text };
    } catch (e) {
      // El aviso a dirección, si es la cuenta, ya ha salido del cliente central.
      console.error("[assistant] la IA no ha respondido:", e?.name, e?.status, e?.message);
      return {
        model: "sin-ia",
        answer: noAiAnswer({ query, relevant, clients }),
        avisoIA: avisoSinIa(e, "Mientras tanto te contesto con la ayuda del CRM, sin IA."),
      };
    }
  }
  return { model: "sin-ia", answer: noAiAnswer({ query, relevant, clients }) };
}
