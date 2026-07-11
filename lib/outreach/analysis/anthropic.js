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
  // Clave del tenant si la trae; si no, la global del entorno. Así cada tenant
  // puede traer su propia key desde la configuración (BYOK) sin obligar a
  // configurar nada en el VPS, y el modo por env sigue funcionando igual.
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY no está configurada");
    err.code = "NO_API_KEY";
    throw err;
  }

  const client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 1 });

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
