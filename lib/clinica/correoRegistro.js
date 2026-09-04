/**
 * lib/clinica/correoRegistro.js — el correo que avisa a la familia de que
 * tiene un registro de sesión nuevo (04/09/2026, Rodrigo: «texto email
 * automático resumiendo el registro de sesión para la familia, editable»).
 *
 * Hasta hoy «Enviar al paciente» publicaba el PDF en el área privada y ahí se
 * acababa: la familia no se enteraba hasta que entraba a mirar. El correo lo
 * cuenta, y con un resumen de lo que ha pasado en la sesión — que es lo que la
 * familia quiere leer sin abrir un PDF.
 *
 * ── LO QUE JAMÁS PUEDE SALIR DE AQUÍ ────────────────────────────────────────
 * Un correo es el canal MENOS seguro por el que sale información de este CRM:
 * se reenvía, se queda en el móvil de quien sea, y no se puede retirar. Por eso
 * el resumen se construye con una lista BLANCA, nunca con «todo menos»:
 *
 *   · **Nunca** las notas internas (`internalNotes`) — son del equipo.
 *   · **Nunca** la preparación (`prepText`) ni sus adjuntos — son del trabajo
 *     previo de la profesional.
 *   · **Nunca** la transcripción del audio (`aiTranscription`) — es la sesión
 *     entera en crudo, con todo lo que se dijo dentro.
 *
 * Es la misma frontera que ya respetan el PDF del registro (`sessionPdf.js`) y
 * el volcado a informes, y la fija una prueba: si mañana alguien añade un
 * apartado a la lista blanca, tiene que hacerlo a propósito.
 *
 * ── DE DÓNDE SALE EL RESUMEN ────────────────────────────────────────────────
 * De la **Devolución a la familia** cuando el centro la tiene en su plantilla y
 * la ha escrito: es literalmente el apartado que se redacta PARA ellos, así que
 * no hay que resumir nada ni gastar IA. Si no hay, se cae a Actividades y
 * Desempeño —que la familia ya recibe dentro del PDF— y, si tampoco, a un aviso
 * a secas de que el registro está disponible: mejor un correo corto que uno que
 * se inventa contenido.
 *
 * Y sea cual sea, **se propone, no se manda**: quien envía lo ve escrito en un
 * recuadro y lo cambia antes de dar a enviar. Esa es la salvaguarda de verdad.
 */

import { apartadosPara, valorDeApartado, valoresDeSesion } from "./plantillas.js";

/**
 * Los apartados del registro que PUEDEN ir en el correo, por orden de
 * preferencia. Lista blanca: lo que no está aquí no sale.
 *
 * `devolucionFamilia` es lo que el centro le cuenta a la familia. `activities`
 * y `performance` son el respaldo, y están porque ya viajan dentro del PDF que
 * se publica en la misma acción: no son una revelación nueva.
 */
export const APARTADOS_DEL_CORREO = ["devolucionFamilia", "activities", "performance"];

/** Apartados que no pueden salir por correo NUNCA, escritos para la prueba. */
export const NUNCA_POR_CORREO = ["internalNotes", "prepText", "prepFiles", "aiTranscription", "parentFeedback"];

const texto = (v) => {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean).join("\n");
  const s = String(v ?? "").trim();
  return s || null;
};

/** La fecha de la sesión, en cristiano y en hora de Madrid. */
export function fechaLegible(d) {
  if (!d) return null;
  const dt = typeof d === "string" && d.length <= 10 ? new Date(`${d}T12:00:00Z`) : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("es-ES", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid",
  });
}

/** El primer nombre, para saludar sin sonar a circular. */
export function nombreDePila(nombre) {
  const n = texto(nombre);
  return n ? n.split(/\s+/)[0] : null;
}

/**
 * El TEXTO que se propone. Devuelve `{ asunto, texto, fuente }`:
 *   · `fuente` = `devolucion` | `registro` | `aviso`, para que la pantalla
 *     pueda decir de dónde salió (y para poder probarlo sin leer el texto).
 *
 * @param {object} args
 * @param {object} args.sesion        la ClinicSession (plana o modelo).
 * @param {object} args.tenant        el tenant, para sus plantillas.
 * @param {?string} args.patientName  el paciente.
 * @param {?string} args.centro       el nombre del centro.
 */
export function propuestaDeCorreo({ sesion, tenant, patientName = null, centro = null } = {}) {
  const fila = sesion?.toJSON ? sesion.toJSON() : (sesion ?? {});
  const bolsa = valoresDeSesion(fila);
  const apartados = apartadosPara(fila.contentSections, tenant, "registro");
  const porClave = new Map((apartados ?? []).map((a) => [a.key, a]));

  const fecha = fechaLegible(fila.sessionDate);
  const nombre = texto(patientName);

  // La lista blanca, en orden. El primero con contenido gana.
  const piezas = [];
  for (const clave of APARTADOS_DEL_CORREO) {
    const apartado = porClave.get(clave);
    if (!apartado) continue;
    const valor = texto(valorDeApartado(bolsa, apartado));
    if (valor) piezas.push({ clave, label: apartado.label, valor });
  }

  const devolucion = piezas.find((p) => p.clave === "devolucionFamilia");
  const cuerpo = devolucion
    ? devolucion.valor
    : piezas.length
      ? piezas.map((p) => `${p.label}: ${p.valor}`).join("\n\n")
      : null;

  const fuente = devolucion ? "devolucion" : cuerpo ? "registro" : "aviso";

  const saludo = nombreDePila(nombre) ? `Hola:` : "Hola:";
  const encabezado = nombre
    ? `Os escribimos para contaros cómo ha ido la sesión de ${nombre}${fecha ? ` del ${fecha}` : ""}.`
    : `Os escribimos para contaros cómo ha ido la sesión${fecha ? ` del ${fecha}` : ""}.`;

  const cierre =
    "Tenéis el registro completo en vuestra área privada, y aquí estamos para cualquier duda.";

  const partes = [saludo, "", encabezado];
  if (cuerpo) partes.push("", cuerpo);
  partes.push("", cierre);
  if (centro) partes.push("", texto(centro));

  const asunto = nombre
    ? `Sesión de ${nombre}${fecha ? ` · ${fecha}` : ""}`
    : `Registro de sesión${fecha ? ` · ${fecha}` : ""}`;

  return { asunto, texto: partes.join("\n"), fuente };
}

/**
 * Lo que acepta el POST cuando se pide mandar el correo: un asunto y un cuerpo,
 * los dos recortados. Sin cuerpo NO se manda —un correo vacío es peor que
 * ninguno— y se dice por qué.
 *
 * @returns {{asunto: string, texto: string} | {error: string}}
 */
export function limpiarCorreo(bruto) {
  const asunto = texto(bruto?.asunto);
  const cuerpo = texto(bruto?.texto);
  if (!cuerpo) return { error: "El correo no tiene texto: escríbelo o desmarca «avisar por correo»" };
  return {
    asunto: (asunto ?? "Registro de sesión").slice(0, 200),
    texto: cuerpo.slice(0, 5000),
  };
}

/**
 * Por qué NO se puede avisar por correo, o `null` si se puede. Se dice, no se
 * falla en silencio: la misma regla que `motivoParaNoEnviar`.
 */
export function motivoParaNoAvisar({ email } = {}) {
  if (!texto(email)) {
    return "La familia no tiene correo en su ficha, así que el registro se publica en su área privada pero no se avisa por correo.";
  }
  return null;
}
