/**
 * Estructuración de una sesión clínica con Claude: dada la transcripción de la
 * nota de voz de la profesional, produce el REGISTRO ENTERO —de la preparación
 * a las notas internas—, repartido por los apartados que de verdad tiene ese
 * centro. Reutiliza el proveedor de Anthropic del módulo Outreach y el patrón de
 * "pedir SOLO JSON → parsear defensivo → normalizar → nunca romper".
 *
 * ── QUÉ CAMBIÓ EL 01/09/2026 ───────────────────────────────────────────────
 * Hasta hoy el prompt vivía aquí escrito a mano con SIETE campos fijos, que
 * eran el bloque «2 · Informe de la sesión» y solo los de fábrica. Todo lo demás
 * del registro —preparación, devolución de la familia, notas internas y los
 * apartados propios de la plantilla del centro— se quedaba en blanco siempre, y
 * había que teclearlo aunque estuviera dictado en el audio.
 *
 * Ahora el prompt lo CONSTRUYE `registroCompleto.js` a partir de los bloques de
 * ese registro. Este fichero se queda con lo que es suyo: llamar al modelo y no
 * romperse con lo que conteste.
 */

import { complete } from "../outreach/analysis/anthropic.js";
import {
  bloquesDelRegistro,
  estructuraHistorica,
  mensajeDeRegistro,
  normalizarPropuesta,
  promptDeRegistro,
} from "./registroCompleto.js";

/**
 * Holgado a propósito: la salida ya no son siete campos cortos sino el registro
 * entero, y un centro puede tener hasta 30 apartados en su plantilla
 * (`MAX_APARTADOS`). Si se trunca, el JSON no parsea y la propuesta sale vacía.
 */
const MAX_TOKENS = 4000;

/**
 * @param {object} args
 * @param {string} args.transcription  Lo que dijo la profesional.
 * @param {Array}  [args.apartados]    Los del bloque 2 (plantilla del centro o
 *                                     la foto del registro). Sin ellos se usan
 *                                     los siete de fábrica.
 * @param {object} [args.escrito]      Lo ya tecleado a mano, por clave: viaja
 *                                     como contexto para no contradecirlo.
 * @param {string} args.apiKey
 * @param {string} [args.model]
 * @returns {Promise<{ propuesta: Record<string,string>, structured: object, bloques: Array }>}
 */
export async function structureSession({ transcription, apartados, escrito, apiKey, model }) {
  const bloques = bloquesDelRegistro(apartados);

  const raw = await complete({
    system: promptDeRegistro(bloques),
    user: mensajeDeRegistro({ transcription, escrito, bloques }),
    model,
    maxTokens: MAX_TOKENS,
    apiKey,
  });

  const propuesta = normalizarPropuesta(raw, bloques);
  return { propuesta, structured: estructuraHistorica(propuesta), bloques };
}
