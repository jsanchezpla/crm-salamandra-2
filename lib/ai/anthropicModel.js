/**
 * Modelo de Claude (Anthropic) por-tenant. Fuente ÚNICA de verdad para TODO el CRM
 * (Outreach, resumen de sesiones clínicas, etc.). El cliente lo elige en
 * Configuración → IA; se guarda SIN cifrar (no es un secreto) en
 * `settings.integrations.anthropicModel`.
 *
 * Por defecto **Sonnet**: mucho más barato que Opus con calidad muy similar para
 * estos usos (análisis y resúmenes). El cliente puede subir a Opus si quiere más
 * calidad, o bajar a Haiku para máximo ahorro.
 *
 * Los IDs de modelo cambian con el tiempo: verificar contra el catálogo de
 * Anthropic antes de añadir uno nuevo.
 */
export const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-5", label: "Claude Sonnet", description: "Recomendado · equilibrio calidad/coste" },
  { id: "claude-opus-4-8", label: "Claude Opus", description: "Máxima calidad · consume más tokens (más caro)" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku", description: "El más rápido y económico" },
];

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export function isAllowedAnthropicModel(id) {
  return typeof id === "string" && ANTHROPIC_MODELS.some((m) => m.id === id);
}

/**
 * Modelo efectivo del tenant: el configurado si es válido, o Sonnet por defecto.
 * (Así, en cuanto el cliente mete su clave, el modelo por defecto ya es Sonnet
 * sin tener que tocar nada.)
 */
export function getTenantAnthropicModel(ctx) {
  const m = ctx?.tenant?.settings?.integrations?.anthropicModel;
  return isAllowedAnthropicModel(m) ? m : DEFAULT_ANTHROPIC_MODEL;
}
