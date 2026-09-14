/**
 * lib/ai/trasFalloDeIa.js — lo que pasa CADA VEZ que el proveedor de IA
 * rechaza una llamada, esté donde esté quien la hizo (13/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: es el único sitio al que llaman los cuatro
 * clientes que hablan con un proveedor —`lib/outreach/analysis/anthropic.js`,
 * `lib/assistant/anthropic.js`, `lib/ai/openai.js` y `lib/clinica/whisper.js`—
 * cuando la llamada falla.)
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * El 10/09/2026 la cuenta de Anthropic de Aumenta se quedó sin saldo y nadie
 * que pudiera recargarla se enteró hasta el día siguiente. El 11/09 se puso la
 * campana `ai_cuenta` (`lib/ai/avisoDeCuentaIa.js`), pero la llamaba CADA RUTA
 * desde su catch: la pusieron 7 rutas clínicas y las otras 13 que gastan IA
 * (el bot, los huecos, la semana, soporte, Desempeño, mailing…) no avisaban.
 * Y Whisper no avisaba nunca, porque sus errores no llevaban `status` y
 * `esFalloDeCuenta` no los reconocía. Una ruta nueva tenía que acordarse; no
 * se acordaba ninguna.
 *
 * Desde hoy el aviso sale de donde nace el error: el cliente central llama
 * aquí y sigue lanzando el error de siempre. Con qué se avisa lo pone la
 * petición en su contexto (`avisarFalloDeCuenta`, que meten `withTenant` y
 * `withPublicTenant` con `datosDelContexto`): este fichero no sabe de tenants
 * ni de base de datos, y por eso se prueba sin ninguna de las dos cosas.
 *
 * ── Y EL RASTRO (14/09/2026, regla #2) ─────────────────────────────────────
 * Una llamada que fallaba no dejaba fila en `master.ai_uso`: el día que se
 * acabara el saldo no se sabría cuántas fueron ni por qué. Desde hoy, aquí
 * mismo, cada fallo deja la suya (`registrarFallo` de `lib/ai/usoDeIA.js`):
 * proveedor, modelo, cuánto tardó, la causa en una palabra y el estado HTTP,
 * a coste 0 y sin el mensaje del proveedor. Es TODO fallo, no solo los de la
 * cuenta: también el tiempo, la red o una respuesta ilegible. Los cuatro
 * clientes ya mandaban `{ proveedor, modelo, ms }` para esto y no se tocan.
 */

import { esFalloDeCuenta } from "./errorLegible.js";
import { contextoDeUso, registrarFallo } from "./usoDeIA.js";

/**
 * Nunca lanza y nunca sustituye al error original: quien llama hace `throw e`
 * justo después. `contexto` existe para las pruebas; por defecto es el de la
 * petición en curso (o `null` fuera de una, y entonces no se avisa a nadie y la
 * fila sale sin tenant).
 *
 * El rastro y el aviso corren a la vez y los dos terminan ANTES de volver: así
 * el orden de siempre (avisar, y después relanzar) no cambia, y un script que
 * sale justo después del error no pierde la fila.
 *
 * @param {unknown} err  El error tal como lo lanzó el cliente.
 * @param {{ proveedor?: "anthropic"|"openai", modelo?: string|null, ms?: number|null }} llamada
 *   Qué llamada ha fallado: va a la fila de `master.ai_uso`.
 */
export async function trasFalloDeIa(err, llamada = {}, { contexto = contextoDeUso() } = {}) {
  // `registrarFallo` nunca rechaza; el `catch` es por si alguien lo cambia.
  const rastro = registrarFallo({
    proveedor: llamada?.proveedor,
    modelo: llamada?.modelo ?? null,
    ms: llamada?.ms ?? null,
    err,
    tenantId: contexto?.tenantId,
    userId: contexto?.userId,
    accion: contexto?.accion ?? null,
  }).catch(() => false);
  try {
    if (esFalloDeCuenta(err) && typeof contexto?.avisarFalloDeCuenta === "function") {
      await contexto.avisarFalloDeCuenta(err);
    }
  } catch (e) {
    console.warn("[ai:trasFallo] no se pudo avisar del fallo:", e?.message);
  }
  await rastro;
}
