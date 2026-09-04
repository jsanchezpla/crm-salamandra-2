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

import { completeConParada } from "../outreach/analysis/anthropic.js";
import {
  bloquesDelRegistro,
  estructuraHistorica,
  leerRespuesta,
  mensajeDeRegistro,
  normalizarPropuesta,
  promptDeRegistro,
} from "./registroCompleto.js";
import { apartadosPropuestos } from "./apartadosPropuestos.js";

/**
 * Holgado a propósito: la salida ya no son siete campos cortos sino el registro
 * entero, y un centro puede tener hasta 30 apartados en su plantilla
 * (`MAX_APARTADOS`).
 *
 * ── DE 4.000 A 12.000 (01/09/2026, Rodrigo: «a veces falla que lo mande al
 * registro») ──────────────────────────────────────────────────────────────
 * 4.000 daba de sobra para los siete campos de fábrica, pero no para un
 * registro entero salido de un audio largo: la respuesta se cortaba a mitad de
 * una frase, el JSON no parseaba y la propuesta llegaba VACÍA a la pantalla sin
 * un solo error por ninguna parte. De ahí el «a veces»: dependía del largo del
 * audio. Los tokens de salida se pagan por lo que se USA, no por el tope, así
 * que subirlo no encarece las sesiones cortas.
 */
const MAX_TOKENS = 12_000;

/**
 * @param {object} args
 * @param {string} args.transcription  Lo que dijo la profesional.
 * @param {Array}  [args.apartados]    Los del bloque 2 (plantilla del centro o
 *                                     la foto del registro). Sin ellos se usan
 *                                     los siete de fábrica.
 * @param {object} [args.escrito]      Lo ya tecleado a mano, por clave: viaja
 *                                     como contexto para no contradecirlo.
 * @param {object} [args.paciente]     Para ajustar la terminología a su edad y
 *                                     a sus áreas. NUNCA viaja su nombre: solo
 *                                     lo que deja pasar `lineaDePaciente`.
 * @param {string} args.apiKey
 * @param {string} [args.model]
 * @returns {Promise<{ propuesta: Record<string,string>, nuevos: Array, structured: object, bloques: Array, incidencia: string|null }>}
 *          `nuevos`: apartados que el modelo propone CREAR porque lo dictado no
 *          cabía en ninguno de los que tiene el documento (`[]` casi siempre).
 *          `incidencia`: `null` si la respuesta vino limpia; `"cortada"` si se
 *          quedó sin sitio (se rescata lo que llegó entero), `"envuelta"` si
 *          traía texto alrededor, `"ilegible"`/`"vacia"` si no hubo nada que
 *          leer. La pantalla lo usa para decir la verdad en vez de «la IA no ha
 *          sacado nada que repartir», que era mentira la mitad de las veces.
 */
export async function structureSession({ transcription, apartados, escrito, paciente = null, apiKey, model }) {
  const bloques = bloquesDelRegistro(apartados);

  const { texto: raw, parada } = await completeConParada({
    system: promptDeRegistro(bloques, { paciente }),
    user: mensajeDeRegistro({ transcription, escrito, bloques }),
    model,
    maxTokens: MAX_TOKENS,
    apiKey,
    // Por streaming, por lo mismo que la IA de Proyectos (ver `anthropic.js`):
    // con `maxTokens` a 12.000 una petición muda puede pasarse de los 120 s de
    // timeout y morir en un «Error interno del servidor» que aquí llegaría como
    // «la IA ha fallado» sin más. Lo que se recibe es idéntico —el SDK junta
    // los trozos y `stop_reason` viene igual—, pero la conexión no se queda
    // callada mientras Claude escribe un registro entero.
    stream: true,
  });

  const { objeto, incidencia: comoVino } = leerRespuesta(raw);
  // Que Claude parase por tope manda sobre lo que parezca el texto: puede
  // cortarse justo detrás de una coma y parsear entero, y aun así faltar
  // apartados. Vale más avisar de más que dar por completo lo que no lo está.
  const incidencia = parada === "max_tokens" ? "cortada" : comoVino;
  // A ojos del servidor esto es lo único que queda de un fallo que antes era
  // mudo. Sin esta línea, «a veces falla» seguiría sin poder investigarse.
  if (incidencia) console.warn("[clinica:structure] respuesta", incidencia, { parada, largo: raw.length });

  const propuesta = normalizarPropuesta(objeto, bloques);
  // Los apartados que el modelo se ha inventado porque lo dictado no cabía en
  // ninguno de los suyos (04/09/2026). Van APARTE de la propuesta: no son
  // valores de un apartado que existe, son apartados que habría que crear, y la
  // pantalla los enseña marcados para que ella los acepte o los descarte.
  const nuevos = apartadosPropuestos(objeto, bloques);
  return { propuesta, nuevos, structured: estructuraHistorica(propuesta), bloques, incidencia };
}
