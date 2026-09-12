/**
 * Modelos admitidos para el análisis de leads.
 *
 * Reexporta la fuente ÚNICA de verdad (`lib/ai/anthropicModel.js`), compartida
 * con el resto del CRM y con Configuración → IA.
 *
 * `ALLOWED_MODELS` es la lista del desplegable HISTÓRICO de Ajustes de
 * Captación (`settings.aiModel`), que sigue siendo de Claude. Pero el modelo
 * que manda es el de Configuración → Conexiones, que desde el 12/09/2026 puede
 * ser de OpenAI (`lib/ai/proveedorIa.js`): `isAllowedModel` lo acepta también,
 * o `analyzeLead` lo descartaría y pediría un modelo de Claude con una clave
 * de OpenAI.
 */
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL, isAllowedAnthropicModel } from "../../ai/anthropicModel.js";
import { isAllowedOpenAIModel } from "../../ai/openaiModel.js";

export const ALLOWED_MODELS = ANTHROPIC_MODELS.map((m) => m.id);
export const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL;
export const isAllowedModel = (id) => isAllowedAnthropicModel(id) || isAllowedOpenAIModel(id);
