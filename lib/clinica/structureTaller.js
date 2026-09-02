/**
 * Estructuración de una SESIÓN DE TALLER con Claude (03/09/2026): dada la
 * transcripción del audio (o las notas) de la profesional, produce el registro
 * entero del taller —el cuerpo común, la nota de cada asistente y las notas
 * internas— repartido por los bloques que de verdad tiene ese taller.
 *
 * Gemelo de `structureSession.js` y por lo mismo: el prompt lo construye
 * `tallerCompleto.js`; aquí solo se llama al modelo y no se rompe con lo que
 * conteste.
 */

import { completeConParada } from "../outreach/analysis/anthropic.js";
import { leerRespuesta } from "./registroCompleto.js";
import {
  bloquesDelTaller,
  mensajeDeTaller,
  normalizarPropuestaDeTaller,
  promptDeTaller,
  repartirPropuestaDeTaller,
} from "./tallerCompleto.js";

/** Como en el registro normal: el registro entero de un audio largo no cabe en 4.000. */
const MAX_TOKENS = 12_000;

/**
 * @param {object} args
 * @param {string} args.transcription  El material (transcripción y/o notas).
 * @param {Array}  [args.apartados]    Los comunes de la plantilla del taller.
 * @param {Array}  [args.asistentes]   `[{ patientId, nombre }]` de los que vinieron.
 * @param {string} [args.etiquetaNota] Cómo se titula la nota individual.
 * @param {object} [args.escrito]      Lo ya tecleado, por clave de bloque.
 * @param {string} args.apiKey
 * @param {string} [args.model]
 * @returns {Promise<{ propuesta, reparto, bloques, incidencia }>}
 */
export async function structureTaller({ transcription, apartados, asistentes, etiquetaNota, escrito, apiKey, model }) {
  const bloques = bloquesDelTaller({ apartados, asistentes, etiquetaNota });

  const { texto: raw, parada } = await completeConParada({
    system: promptDeTaller(bloques),
    user: mensajeDeTaller({ transcription, escrito, bloques }),
    model,
    maxTokens: MAX_TOKENS,
    apiKey,
  });

  const { objeto, incidencia: comoVino } = leerRespuesta(raw);
  const incidencia = parada === "max_tokens" ? "cortada" : comoVino;
  if (incidencia) console.warn("[clinica:structure-taller] respuesta", incidencia, { parada, largo: raw.length });

  const propuesta = normalizarPropuestaDeTaller(objeto, bloques);
  return { propuesta, reparto: repartirPropuestaDeTaller(propuesta, bloques), bloques, incidencia };
}
