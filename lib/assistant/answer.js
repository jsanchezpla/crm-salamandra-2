/**
 * lib/assistant/answer.js — cerebro del Salamandrobot.
 *
 * Decide cómo responder según la disponibilidad de IA:
 *   - MODO SIMULADO (fake): dev/demo con ASSISTANT_FAKE_AI=1 o OUTREACH_FAKE_AI=1
 *     (bloqueado en producción, como Captación) → respuesta canned útil, 0 coste.
 *   - CON IA: el tenant tiene clave de Anthropic (BYOK) → Claude responde en
 *     lenguaje natural usando la base de conocimiento + los datos encontrados.
 *   - SIN IA: no hay clave ni modo simulado → respuesta compuesta de la base de
 *     conocimiento + clientes encontrados (el asistente "funciona sin IA").
 *
 * Puro: no toca la BD. El endpoint le pasa `relevant` (base de conocimiento) y
 * `clients` (búsqueda ya hecha con los modelos del tenant).
 */
import { chat } from "./anthropic.js";
import { fakeAnswer } from "./fake.js";
import { knowledgeForPrompt } from "./knowledge.js";

export function fakeEnabled() {
  return (
    (process.env.ASSISTANT_FAKE_AI === "1" || process.env.OUTREACH_FAKE_AI === "1") &&
    process.env.NODE_ENV !== "production"
  );
}

function buildSystem({ companyName, clients }) {
  const found =
    clients && clients.length
      ? `\n\nClientes que coinciden con la consulta del usuario (por si busca uno):\n${clients
          .slice(0, 8)
          .map((c) => `- ${c.name} (id ${c.id})`)
          .join("\n")}`
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

/** Respuesta compuesta sin IA (base de conocimiento + clientes). */
function noAiAnswer({ query, relevant, clients }) {
  const parts = [];
  if (clients && clients.length) {
    parts.push(`Clientes que coinciden: ${clients.slice(0, 5).map((c) => c.name).join(", ")}.`);
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

export async function answerQuestion({ messages, relevant, clients, apiKey, model, companyName }) {
  const query = [...(messages || [])].reverse().find((m) => m.role === "user")?.content || "";

  if (fakeEnabled()) {
    return { model: "fake", answer: fakeAnswer({ query, relevant, clients }) };
  }
  if (apiKey) {
    const system = buildSystem({ companyName, clients });
    const text = await chat({ system, messages, model, maxTokens: 700, apiKey });
    return { model, answer: text };
  }
  return { model: "sin-ia", answer: noAiAnswer({ query, relevant, clients }) };
}
