import Anthropic from "@anthropic-ai/sdk";

/**
 * Proveedor Claude para el Salamandrobot (chat). BYOK: la clave es SIEMPRE la del
 * tenant (Configuración → IA); sin ella se corta (NO_API_KEY). Mismo patrón que
 * lib/outreach/analysis/anthropic.js pero conversacional (varios mensajes).
 */
const TIMEOUT_MS = 60_000;

export async function chat({ system, messages, model, maxTokens = 1024, apiKey }) {
  if (!apiKey) {
    const err = new Error("Falta la clave de Anthropic del tenant (Configuración → IA)");
    err.code = "NO_API_KEY";
    throw err;
  }
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    })),
  });
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
