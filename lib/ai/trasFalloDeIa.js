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
 * ── LO QUE VIENE ───────────────────────────────────────────────────────────
 * Aquí es también donde se dejará el rastro de la llamada fallida (proveedor,
 * modelo, cuánto tardó), por eso llega `{ proveedor, modelo, ms }` aunque hoy
 * no se use: es el mismo punto y no hace falta volver a tocar los cuatro
 * clientes.
 */

import { esFalloDeCuenta } from "./errorLegible.js";
import { contextoDeUso } from "./usoDeIA.js";

/**
 * Nunca lanza y nunca sustituye al error original: quien llama hace `throw e`
 * justo después. `contexto` existe para las pruebas; por defecto es el de la
 * petición en curso (o `null` fuera de una, y entonces no se avisa a nadie).
 *
 * @param {unknown} err  El error tal como lo lanzó el cliente.
 * @param {{ proveedor?: "anthropic"|"openai", modelo?: string|null, ms?: number|null }} _llamada
 *   Qué llamada ha fallado. Hoy no se lee (ver «Lo que viene»).
 */
export async function trasFalloDeIa(err, _llamada = {}, { contexto = contextoDeUso() } = {}) {
  try {
    if (esFalloDeCuenta(err) && typeof contexto?.avisarFalloDeCuenta === "function") {
      await contexto.avisarFalloDeCuenta(err);
    }
  } catch (e) {
    console.warn("[ai:trasFallo] no se pudo avisar del fallo:", e?.message);
  }
}
