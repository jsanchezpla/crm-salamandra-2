import Anthropic from "@anthropic-ai/sdk";
import { parametrosDeRazonamiento } from "../ai/anthropicModel.js";
import { chatConOpenAI } from "../ai/openai.js";
import { proveedorDelModelo } from "../ai/proveedorIa.js";
import { registrarUso } from "../ai/usoDeIA.js";

/**
 * Proveedor Claude para el Salamandrobot (chat). BYOK: la clave es SIEMPRE la del
 * tenant (Configuración → IA); sin ella se corta (NO_API_KEY). Mismo patrón que
 * lib/outreach/analysis/anthropic.js pero conversacional (varios mensajes).
 *
 * Desde el 12/09/2026 despacha por el id del modelo, como aquel: si el tenant
 * ha elegido ChatGPT (`lib/ai/proveedorIa.js`), la conversación va a
 * `lib/ai/openai.js` y vuelve el mismo texto.
 */
const TIMEOUT_MS = 60_000;

export async function chat({ system, messages, model, maxTokens = 1024, apiKey }) {
  if (proveedorDelModelo(model) === "openai") {
    return chatConOpenAI({ system, messages, model, maxTokens, apiKey, timeoutMs: TIMEOUT_MS });
  }
  if (!apiKey) {
    const err = new Error("Falta la clave de Anthropic del tenant (Configuración → IA)");
    err.code = "NO_API_KEY";
    throw err;
  }
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const t0 = Date.now();
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    // Sin razonamiento previo (11/09/2026): ver `parametrosDeRazonamiento`.
    ...parametrosDeRazonamiento(model),
    system,
    messages: messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    })),
  });
  // Contabilidad (best-effort): qué costó este turno del chat.
  void registrarUso({ proveedor: "anthropic", modelo: model, usage: msg.usage, ms: Date.now() - t0, parada: msg.stop_reason ?? null });
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
