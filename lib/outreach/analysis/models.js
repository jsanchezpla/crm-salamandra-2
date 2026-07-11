/**
 * Modelos de Claude admitidos para el análisis de leads.
 *
 * Única fuente de verdad: la usan el endpoint de ajustes (para validar) y la
 * UI (para pintar el selector). Bajar de Opus a Sonnet o Haiku reduce el coste
 * por análisis sin tocar código.
 *
 * Los IDs de modelo cambian con el tiempo: verificar contra el catálogo de
 * Anthropic antes de añadir uno nuevo.
 */
export const ALLOWED_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
];

export const DEFAULT_MODEL = "claude-opus-4-8";

export function isAllowedModel(model) {
  return ALLOWED_MODELS.includes(model);
}
