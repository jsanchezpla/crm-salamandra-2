/**
 * Modelo de Claude (Anthropic) por-tenant. Fuente ÚNICA de verdad para TODO el CRM
 * (Outreach, resumen de sesiones clínicas, etc.). El cliente lo elige en
 * Configuración → IA; se guarda SIN cifrar (no es un secreto) en
 * `settings.integrations.anthropicModel`.
 *
 * ── POR DEFECTO HAIKU (11/09/2026) ─────────────────────────────────────────
 * Hasta hoy el modelo por defecto era Sonnet. Aumenta se quedó sin saldo de
 * Anthropic a los diez días de cargar la cuenta: cada registro dictado le
 * costaba entre 0,07 y 0,12 $, sobre todo porque Sonnet 5 RAZONA antes de
 * escribir si no se le dice lo contrario (ver `parametrosDeRazonamiento`), y
 * ese razonamiento se cobra como salida aunque no se vea. Con Haiku el mismo
 * registro sale a ~0,015 $, no razona salvo que se le pida, y las terapeutas
 * de Aumenta lo dieron por bueno al probarlo. Quien quiera más matiz en la
 * redacción puede subir a Sonnet u Opus desde Configuración.
 *
 * Los IDs de modelo cambian con el tiempo: verificar contra el catálogo de
 * Anthropic antes de añadir uno nuevo, y apuntar en `RAZONAN_POR_DEFECTO` si
 * el nuevo razona sin que se le pida (Opus 5 y Fable 5 lo hacen).
 */
export const ANTHROPIC_MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku", description: "Recomendado · el más rápido y económico" },
  { id: "claude-sonnet-5", label: "Claude Sonnet", description: "Más matiz al redactar · unas 3 veces más caro que Haiku" },
  { id: "claude-opus-4-8", label: "Claude Opus", description: "Máxima calidad · unas 7 veces más caro que Haiku" },
];

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

export function isAllowedAnthropicModel(id) {
  return typeof id === "string" && ANTHROPIC_MODELS.some((m) => m.id === id);
}

/**
 * Modelo efectivo del tenant: el configurado si es válido, o Haiku por defecto.
 * (Así, en cuanto el cliente mete su clave, el modelo por defecto ya es el
 * económico sin tener que tocar nada.)
 */
export function getTenantAnthropicModel(ctx) {
  const m = ctx?.tenant?.settings?.integrations?.anthropicModel;
  return isAllowedAnthropicModel(m) ? m : DEFAULT_ANTHROPIC_MODEL;
}

/**
 * Modelos que, si la petición no dice nada, razonan antes de contestar
 * («adaptive thinking» encendido de fábrica, con esfuerzo alto).
 *
 * Haiku 4.5 y Opus 4.8 no razonan salvo que se les pida; Sonnet 5 sí. El CRM
 * llevaba desde que Sonnet 5 fue el modelo por defecto pagando ese
 * razonamiento sin haberlo pedido: el comentario del cliente central decía
 * «se pide solo JSON, sin thinking», y era verdad con los modelos de antes.
 */
const RAZONAN_POR_DEFECTO = new Set(["claude-sonnet-5"]);

/**
 * Lo que hay que añadir a la petición para que el modelo NO razone antes de
 * escribir (11/09/2026). Vacío en los modelos que ya no lo hacen: mandarles
 * el parámetro no aporta nada y en Haiku el nombre del modo es otro.
 *
 * Por qué se apaga en todos los usos del CRM: ninguno de los 17 sitios que
 * llaman a Claude fue diseñado contando con él —todos piden un JSON o un texto
 * de una pasada, con las reglas escritas en el prompt—, y en un registro
 * clínico dictado pesaba más que la propia respuesta: entre 3.000 y 8.000
 * tokens de salida invisibles por llamada, frente a los ~1.300 del texto que
 * sí se ve. El razonamiento no añade información al resultado, solo tiempo y
 * coste; lo que el modelo tiene que saber viaja en el prompt y en el caso.
 */
export function parametrosDeRazonamiento(model) {
  return RAZONAN_POR_DEFECTO.has(model) ? { thinking: { type: "disabled" } } : {};
}
