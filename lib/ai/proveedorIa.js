/**
 * lib/ai/proveedorIa.js — con qué IA redacta este tenant: Claude (Anthropic)
 * o ChatGPT (OpenAI). Fuente ÚNICA de la elección para TODO el CRM (12/09/2026).
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Rodrigo, 12/09/2026: «un par de clientes me han pedido hacer el trabajo que
 * hace Claude en el CRM también con ChatGPT, con una clave de OpenAI». Hasta
 * hoy todo lo que ESCRIBE la IA —registros de sesión, informes, actas, correos
 * de Mailing, análisis de leads, propuestas de huecos, el asistente— iba a
 * Claude sin más opción, y la clave de OpenAI solo servía para Whisper.
 *
 * ── QUÉ DECIDE Y QUÉ NO ────────────────────────────────────────────────────
 * `settings.integrations.aiProvider` («anthropic» por defecto, o «openai»)
 * decide el proveedor de TODO lo que redacta. Cada proveedor conserva su clave
 * y su modelo (`anthropicApiKey` + `anthropicModel`, `openaiApiKey` +
 * `openaiModel`): cambiar de uno a otro y volver no pierde nada.
 *
 * Lo que NO decide: la transcripción de audio. Whisper es de OpenAI y sigue
 * pidiendo la clave de OpenAI se elija lo que se elija (`lib/clinica/whisper.js`
 * → `getTenantOpenAIKey`). Un centro con Claude para redactar sigue teniendo
 * las dos claves puestas, como hasta hoy.
 *
 * ── CÓMO LLEGA A LOS 20 SITIOS QUE LLAMAN A LA IA SIN TOCAR SU LÓGICA ──────
 * Las rutas ya pedían «la clave» y «el modelo» del tenant y se los pasaban a
 * `complete()` / `chat()`. Ahora piden `getTenantIaKey(ctx)` y
 * `getTenantIaModel(ctx)` —los del proveedor elegido— y los envoltorios miran
 * el id del modelo para saber a quién llamar (`proveedorDelModelo`): un
 * `gpt-…` va a OpenAI, un `claude-…` a Anthropic. El modelo lleva dentro a su
 * proveedor, así que no hace falta un tercer parámetro por toda la cadena.
 *
 * La lista de proveedores y lo que no necesita servidor vive en
 * `lib/ai/proveedores.js` (la pantalla lo importa desde el navegador).
 */

import { getTenantAnthropicKey } from "./anthropicKey.js";
import { getTenantAnthropicModel } from "./anthropicModel.js";
import { getTenantOpenAIKey } from "./openaiKey.js";
import { getTenantOpenAIModel, isAllowedOpenAIModel } from "./openaiModel.js";
import { nombreDelProveedor, proveedorIaDe } from "./proveedores.js";

export { PROVEEDORES_IA, DEFAULT_PROVEEDOR_IA, esProveedorIa, proveedorIaDe, nombreDelProveedor } from "./proveedores.js";

/** El proveedor con el que redacta este tenant: «anthropic» o «openai». */
export function getTenantProveedorIa(ctx) {
  return proveedorIaDe(ctx?.tenant?.settings?.integrations);
}

/** La clave del proveedor elegido, o `null` si ese proveedor no la tiene puesta. */
export function getTenantIaKey(ctx) {
  return getTenantProveedorIa(ctx) === "openai" ? getTenantOpenAIKey(ctx) : getTenantAnthropicKey(ctx);
}

/** El modelo del proveedor elegido (cada uno con su propio por defecto). */
export function getTenantIaModel(ctx) {
  return getTenantProveedorIa(ctx) === "openai" ? getTenantOpenAIModel(ctx) : getTenantAnthropicModel(ctx);
}

/**
 * A quién pertenece un id de modelo. Los de OpenAI empiezan por `gpt-` o son
 * de la serie `o` (o1, o3, o4-mini…); todo lo demás es Anthropic, que es lo
 * que había. Se mira el prefijo y no solo el catálogo para que un modelo de
 * OpenAI que aún no esté en `OPENAI_MODELS` no acabe pidiéndosele a Anthropic.
 */
export function proveedorDelModelo(model) {
  if (isAllowedOpenAIModel(model)) return "openai";
  return typeof model === "string" && /^(gpt-|o\d)/.test(model) ? "openai" : "anthropic";
}

/**
 * La frase que enseña una ruta cuando el proveedor elegido no tiene clave.
 * Nombra a ESE proveedor: un centro que ha elegido ChatGPT y solo tiene la
 * clave de Anthropic puesta necesita saber cuál de las dos le falta.
 *
 *   sinClaveDeIa(ctx, "para estructurar la sesión")
 *   → «Configura la clave de OpenAI en Configuración → Conexiones para estructurar la sesión.»
 */
export function sinClaveDeIa(ctx, paraQue = "para usar la IA") {
  const nombre = nombreDelProveedor(getTenantProveedorIa(ctx));
  return `Configura la clave de ${nombre} en Configuración → Conexiones ${paraQue}.`;
}
