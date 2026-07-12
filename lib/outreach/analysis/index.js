import { complete as anthropicComplete } from "./anthropic.js";
import { complete as fakeComplete } from "./fake.js";
import { buildSystemPrompt, buildUserMessage } from "./prompt.js";
import { parseAnalysis } from "./schema.js";
import { DEFAULT_MODEL, isAllowedModel } from "./models.js";

export { ALLOWED_MODELS, DEFAULT_MODEL, isAllowedModel } from "./models.js";

/**
 * Modo simulado: recorre todo el flujo sin llamar a la API de Claude.
 * Bloqueado en producción a propósito — nadie debe poder desactivar la IA real
 * en el VPS con una env var.
 */
function fakeProviderEnabled() {
  return process.env.OUTREACH_FAKE_AI === "1" && process.env.NODE_ENV !== "production";
}

/**
 * Analiza un lead contra las líneas de negocio activas del tenant.
 *
 * `complete` se inyecta para poder ejercitar el camino completo (prompt →
 * parseo → normalización) en tests sin gastar una llamada de API. Por defecto
 * usa Claude, o el proveedor simulado si OUTREACH_FAKE_AI=1 fuera de producción.
 *
 * Devuelve { model, results: { [businessLineKey]: { score, reasonWhy, needs,
 * pitch, emailDraft } } }.
 */
export async function analyzeLead({ lead, businessLines, settings, companyName, complete, apiKey, model: modelParam }) {
  const active = (businessLines ?? []).filter((l) => l.active !== false);
  if (active.length === 0) {
    const err = new Error("El tenant no tiene líneas de negocio activas");
    err.code = "NO_BUSINESS_LINES";
    throw err;
  }

  const fake = !complete && fakeProviderEnabled();
  const run = complete ?? (fake ? fakeComplete : anthropicComplete);
  // Modelo: el que pasa el caller (Configuración → IA del tenant) tiene prioridad;
  // si no, el histórico settings.aiModel; si nada vale, el default (Sonnet).
  const model = isAllowedModel(modelParam)
    ? modelParam
    : isAllowedModel(settings?.aiModel)
      ? settings.aiModel
      : DEFAULT_MODEL;

  const system = buildSystemPrompt({
    companyName,
    companyContext: settings?.companyContext,
    businessLines: active,
    chainingRule: settings?.chainingRule,
  });
  const user = buildUserMessage(lead);

  // Margen por línea: cada bloque trae análisis + correo completo. Si el JSON
  // se trunca, no parsea y perdemos la llamada entera.
  const maxTokens = Math.min(16000, 2000 + active.length * 2500);

  const raw = await run({ system, user, model, maxTokens, apiKey, businessLines: active });
  const results = parseAnalysis(raw, active);

  // El modelo se persiste: un análisis simulado NUNCA debe parecer real.
  return { model: fake ? "fake" : model, results };
}
