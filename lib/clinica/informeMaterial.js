/**
 * lib/clinica/informeMaterial.js — el informe clínico también se DICTA
 * (04/09/2026, Rodrigo: la pantalla de crear un informe tiene que ser como la
 * del registro, «con su IA, sus notas y sus campos»).
 *
 * (Fichero nuevo en /lib, regla #2: la misma lista de bloques la necesitan el
 * endpoint que llama a Claude y la pantalla que enseña la propuesta, igual que
 * pasa con `registroCompleto.js` en el registro y `tallerCompleto.js` en el
 * taller. Y como allí, el prompt SE CONSTRUYE con los apartados que de verdad
 * tiene ese informe: si el centro añade «Coordinación con el colegio» a su
 * plantilla, Claude lo rellena sin que nadie toque una línea de código.)
 *
 * ── QUÉ TENÍA EL INFORME Y QUÉ LE FALTABA ──────────────────────────────────
 * El informe ya tenía DOS ayudas, y las dos parten de lo que ya está guardado:
 *
 *   · `redactarInforme.js` — vuelca literalmente lo escrito en las sesiones,
 *   · `pulirInforme.js`    — redacta ese volcado, sin añadir nada.
 *
 * Las dos siguen y no se tocan. Lo que faltaba era la otra puerta, la que el
 * registro tiene desde el 01/09: poder DICTAR el informe, o pegar lo que se
 * tenga apuntado, y que se reparta por los apartados. Es el caso de un informe
 * de alta, de derivación o de asesoramiento, que no sale de las sesiones
 * semanales sino de lo que la profesional tiene en la cabeza el día que lo
 * escribe.
 *
 * ── DE DÓNDE SALE LO QUE NO ESTÁ AQUÍ ──────────────────────────────────────
 * La voz, la frontera entre dato y elaboración, lo prohibido y la forma son las
 * MISMAS que en el registro y la entrevista: viven en `estiloClinico.js` y
 * llegan por `reglasDelReparto()`. Aquí solo se escribe lo que de verdad es
 * propio del informe — que lo lee la familia, y a veces su colegio.
 *
 * Y no hay envoltorio: el informe es solo sus apartados. No tiene preparación,
 * ni devolución de la familia, ni notas internas — nada de lo que se escribe
 * aquí es material interno, así que no hay ninguna frontera que defender como
 * en el registro.
 */

import { APARTADOS_INFORME_BASE, normalizarApartados } from "./plantillas.js";
import { INSTRUCCION_NUEVOS } from "./apartadosPropuestos.js";
import { haySintesis, lineaDePaciente } from "./estiloClinico.js";
import { lineaDeBloque, moldeDeBloques, reglasDelReparto } from "./registroCompleto.js";
import { nombreDelInforme } from "./serialize.js";

const texto = (v) => (v == null ? "" : String(v).trim());

/**
 * Los bloques de ESTE informe: sus apartados, sin más. Sin apartados —nadie los
 * manda, llegan corruptos, o la petición viene de una pantalla vieja— se cae a
 * los siete de fábrica: un informe sin apartados no es un informe, y devolver
 * una lista vacía dejaría a Claude sin nada que rellenar.
 */
export function bloquesDelInforme(apartados) {
  const pedidos = normalizarApartados(apartados);
  const base = pedidos.length ? pedidos : APARTADOS_INFORME_BASE;
  const vistas = new Set();
  const salida = [];
  for (const a of base) {
    if (vistas.has(a.key)) continue;
    vistas.add(a.key);
    salida.push({ key: a.key, label: a.label, tipo: a.tipo, ...(a.pista ? { pista: a.pista } : {}) });
  }
  return salida;
}

/* ═══ El prompt ════════════════════════════════════════════════════════════ */

const cabecera = (tipo) => `Recibes el material de un ${(nombreDelInforme(tipo) ?? "informe").toLowerCase()} —lo que la profesional ha dictado, lo que ha escrito, o las dos cosas— y lo escribes, apartado por apartado.

Devuelve SOLO un JSON válido (sin texto alrededor, sin markdown, sin explicaciones), con una clave por apartado de la lista de abajo —todas, y ninguna que no esté— más, si hace falta, la clave que se explica al final.`;

/**
 * Lo propio del informe, y solo eso: quién lo lee. El registro de sesión es una
 * nota de trabajo del centro; el informe sale por la puerta —lo lee la familia
 * y a veces lo lleva al colegio, a la mutua o a una beca—, y eso cambia cómo se
 * escribe aunque los datos sean los mismos.
 */
const REGLAS_INFORME = `REGLAS PROPIAS DEL INFORME (mandan sobre las de arriba si chocan):
5. Este documento SALE DEL CENTRO: lo lee la familia y puede acabar en el colegio o en una convocatoria. Escríbelo entero, sin abreviaturas, sin jerga interna del equipo y sin nada que no le dirías a la familia a la cara.
6. Nada de fechas de sesión delante de cada frase. Si el material viene con ellas —suele venir del volcado de los registros—, úsalas para ordenar y agrupar lo que cuentas y luego quítalas del texto.
7. Un informe se lee de corrido: enlaza lo que va junto y no dejes frases sueltas de una línea donde hay material para desarrollar.`;

/**
 * El SYSTEM, construido desde los apartados REALES de este informe.
 *
 * @param {Array}  bloques
 * @param {object} [opciones]
 * @param {string} [opciones.tipo]      Tipo del informe, para nombrarlo.
 * @param {string} [opciones.contexto]  La línea del paciente (edad y áreas,
 *                                      nunca el nombre: `lineaDePaciente`).
 */
export function promptDeInforme(bloques, { tipo = "", contexto = "" } = {}) {
  const lista = Array.isArray(bloques) ? bloques : [];
  const sintesis = haySintesis(lista);
  return [
    cabecera(tipo),
    `APARTADOS DE ESTE INFORME (usa estas claves exactas):\n${lista
      .map((b) => lineaDeBloque(b, { sintesis }))
      .join("\n")}`,
    `FORMA EXACTA DE LA RESPUESTA:\n${moldeDeBloques(lista, { conNuevos: true })}`,
    reglasDelReparto({ sintesis, contexto }),
    REGLAS_INFORME,
    INSTRUCCION_NUEVOS,
  ].join("\n\n");
}

/**
 * El mensaje de usuario: el material y, como contexto, lo que la profesional ya
 * haya escrito a mano.
 *
 * Del paciente no viaja el nombre: lo que hace falta para escribir —la edad y
 * las áreas— va en el SYSTEM por `lineaDePaciente`, que es la regla de la casa
 * desde que existe `estiloClinico.js`.
 */
export function mensajeDeInforme({ transcription, escrito = null, bloques = [] }) {
  const partes = [`LO QUE HA DICTADO O APUNTADO LA PROFESIONAL:\n\n${texto(transcription)}`];
  const yaEscrito = [];
  for (const b of Array.isArray(bloques) ? bloques : []) {
    const v = texto(escrito?.[b.key]);
    if (v) yaEscrito.push(`- ${b.label}: ${v}`);
  }
  if (yaEscrito.length) {
    partes.push(
      `LO QUE LA PROFESIONAL YA HABÍA ESCRITO A MANO (contexto, NO lo copies ni lo devuelvas):\n${yaEscrito.join(
        "\n"
      )}\n\nTu propuesta sale del material de arriba. Úsalo solo para no contradecirla ni repetir lo que ya dijo con otras palabras.`
    );
  }
  return partes.join("\n\n");
}

/** La línea del paciente, tal como la quiere el prompt. Reexportada por comodidad. */
export { lineaDePaciente };
