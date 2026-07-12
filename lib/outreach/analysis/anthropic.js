import Anthropic from "@anthropic-ai/sdk";

/**
 * Proveedor Claude. Devuelve el texto crudo de la respuesta.
 *
 * Se pide solo JSON, sin thinking: la respuesta es corta y directa.
 * `max_tokens` holgado porque la salida incluye, por cada línea de negocio,
 * el análisis completo más un correo modelo; si se trunca, el JSON no parsea.
 *
 * Timeout explícito: un análisis colgado bloquearía el Route Handler, que
 * mantiene abierta una conexión del pool de Sequelize.
 */
const TIMEOUT_MS = 120_000;

export async function complete({ system, user, model, maxTokens = 8000, apiKey }) {
  // La clave es SIEMPRE la del tenant (Configuración → IA). NO hay fallback a
  // ANTHROPIC_API_KEY del entorno: cada cliente trae la suya (BYOK), así el coste
  // y el control quedan en su cuenta. Si el tenant no la ha puesto, se corta aquí.
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
    messages: [{ role: "user", content: user }],
  });

  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
