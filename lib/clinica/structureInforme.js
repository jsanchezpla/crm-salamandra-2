/**
 * Estructuración de un INFORME CLÍNICO con Claude (04/09/2026): dado lo que la
 * profesional ha dictado o apuntado, produce el informe entero repartido por
 * los apartados que de verdad tiene ese informe.
 *
 * Gemelo de `structureSession.js` y `structureTaller.js`, y por lo mismo: el
 * prompt lo construye `informeMaterial.js`; aquí solo se llama al modelo y no
 * se rompe con lo que conteste.
 *
 * No sustituye a nada. El informe sigue teniendo sus dos ayudas de siempre
 * —volcar las sesiones (`redactarInforme.js`) y pulir ese volcado
 * (`pulirInforme.js`)—, que parten de lo YA GUARDADO. Esta es la tercera
 * puerta: la que parte de lo que la profesional cuenta hoy.
 */

import { completeConParada } from "../outreach/analysis/anthropic.js";
import { leerRespuesta, normalizarPropuesta } from "./registroCompleto.js";
import { apartadosPropuestos } from "./apartadosPropuestos.js";
import { lineaDePaciente } from "./estiloClinico.js";
import { bloquesDelInforme, mensajeDeInforme, promptDeInforme } from "./informeMaterial.js";

/**
 * Como en el registro: un informe entero salido de un audio largo no cabe en
 * 4.000 tokens, y lo que se paga es lo que se usa, no el tope.
 */
const MAX_TOKENS = 12_000;

/**
 * @param {object} args
 * @param {string} args.transcription  El material (transcripción y/o notas).
 * @param {Array}  [args.apartados]    Los del informe (su foto o la plantilla).
 * @param {object} [args.escrito]      Lo ya tecleado, por clave de apartado.
 * @param {object} [args.paciente]     La fila del paciente: de ella sale la
 *                                     línea de contexto (edad y áreas). El
 *                                     NOMBRE no viaja al modelo nunca
 *                                     (`estiloClinico.js`).
 * @param {string} [args.tipo]         `reportType`: evolution, discharge…
 * @param {string} args.apiKey
 * @param {string} [args.model]
 * @returns {Promise<{ propuesta, nuevos, bloques, incidencia }>}
 */
export async function structureInforme({ transcription, apartados, escrito, paciente, tipo, apiKey, model }) {
  const bloques = bloquesDelInforme(apartados);

  const { texto: raw, parada } = await completeConParada({
    system: promptDeInforme(bloques, { tipo, contexto: lineaDePaciente(paciente) }),
    user: mensajeDeInforme({ transcription, escrito, bloques }),
    model,
    maxTokens: MAX_TOKENS,
    apiKey,
    // Por streaming, como los otros dos: con `maxTokens` alto una petición muda
    // se pasa de los 120 s de timeout y muere en un error interno que aquí
    // llegaría como «la IA ha fallado» sin más.
    stream: true,
  });

  const { objeto, incidencia: comoVino } = leerRespuesta(raw);
  const incidencia = parada === "max_tokens" ? "cortada" : comoVino;
  if (incidencia) console.warn("[clinica:structure-informe] respuesta", incidencia, { parada, largo: raw.length });

  return {
    propuesta: normalizarPropuesta(objeto, bloques),
    nuevos: apartadosPropuestos(objeto, bloques),
    bloques,
    incidencia,
  };
}
