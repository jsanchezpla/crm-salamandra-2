/**
 * Modelos de Claude admitidos para el análisis de leads.
 *
 * Reexporta la fuente ÚNICA de verdad (`lib/ai/anthropicModel.js`), compartida
 * con el resto del CRM y con Configuración → IA. El modelo por defecto es Sonnet.
 */
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL, isAllowedAnthropicModel } from "../../ai/anthropicModel.js";

export const ALLOWED_MODELS = ANTHROPIC_MODELS.map((m) => m.id);
export const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL;
export const isAllowedModel = isAllowedAnthropicModel;
