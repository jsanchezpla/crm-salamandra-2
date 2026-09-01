/**
 * lib/reuniones/redactarActa.js — llamar a Claude para que reparta lo que se
 * dijo en la reunión por los apartados del acta (01/09/2026, Rodrigo).
 *
 * Es el gemelo de `lib/clinica/structureSession.js` y hace exactamente lo
 * mismo: montar el prompt con los apartados REALES de este centro, pedir solo
 * JSON, parsear defensivo y no romperse con lo que conteste. Lo que cambia es
 * el prompt, y por eso son dos ficheros: a un acta de equipo no se le pregunta
 * por la preparación de la sesión ni por la devolución de la familia, y a un
 * registro clínico no se le piden acuerdos ni reparto de tareas.
 *
 * Se reutiliza a propósito `normalizarPropuesta` de `registroCompleto.js`: es
 * el parseo defensivo del JSON de Claude —qué hacer con una lista donde iba
 * texto, con una clave de más, con un JSON entre vallas de markdown—, y eso no
 * tiene nada de clínico. Duplicarlo sería tener dos formas de aguantar la misma
 * respuesta rara.
 */

import { complete } from "../outreach/analysis/anthropic.js";
import { normalizarPropuesta } from "../clinica/registroCompleto.js";
import { bloquesDelActa, mensajeDelActa, promptDelActa } from "./acta.js";

/**
 * Holgado por lo mismo que en el registro: la salida es el acta entera y un
 * centro puede tener hasta 30 apartados. Si se trunca, el JSON no parsea y la
 * propuesta sale vacía.
 */
const MAX_TOKENS = 4000;

/**
 * @param {object} args
 * @param {string} args.material   Lo que se dijo: transcripción, notas o las dos.
 * @param {Array}  [args.apartados] Los del acta (plantilla del centro o la foto).
 * @param {object} [args.escrito]   Lo ya tecleado a mano, como contexto.
 * @param {string} [args.cuando]    Fecha y hora de la reunión, en cristiano.
 * @param {string[]} [args.equipo]  Nombres del centro, para escribirlos bien.
 * @param {string} args.apiKey
 * @param {string} [args.model]
 * @returns {Promise<{ propuesta: Record<string,string>, bloques: Array }>}
 */
export async function redactarActa({ material, apartados, escrito, cuando, equipo, apiKey, model }) {
  const bloques = bloquesDelActa(apartados);

  const raw = await complete({
    system: promptDelActa(bloques),
    user: mensajeDelActa({ material, escrito, bloques, cuando, equipo }),
    model,
    maxTokens: MAX_TOKENS,
    apiKey,
  });

  return { propuesta: normalizarPropuesta(raw, bloques), bloques };
}
