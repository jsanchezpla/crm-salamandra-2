/**
 * lib/citas/resultadoCita.js — CÓMO ACABÓ una cita, en un solo sitio
 * (01/09/2026, Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Cambiar el "no asistió" por falta justificada o falta injustificada: son dos
 * botones y así queda claro cuándo han venido y cuándo no. Y quiero poder ver
 * el resultado —completada, las faltas— o cancelar la cita dentro de cada
 * paciente, en sus citas.»
 *
 * ── POR QUÉ ES UN FICHERO DE /lib Y NO UN PAR DE BOTONES ────────────────────
 * Hasta hoy el resultado se decidía en UN sitio (la ficha de la cita en la
 * Agenda) y con UN botón —«No asistió»— que abría un diálogo preguntando si la
 * falta estaba justificada. Dos pasos para lo que son dos respuestas, y la
 * pregunta escondida detrás del botón: mirando la agenda no se sabía qué se iba
 * a apuntar.
 *
 * Ahora el resultado se pone desde DOS pantallas (la ficha de la cita y las
 * citas del paciente) y son CUATRO respuestas. Si cada pantalla escribe su
 * propio `fetch`, en un mes una manda `noShowJustified` y la otra se lo deja, y
 * la falta de la ficha del paciente no avisa a nadie. Aquí vive lo único que
 * las dos necesitan: cómo se llama cada resultado y qué se le manda al
 * servidor.
 *
 * `noShowJustified` NO se puede omitir al marcar una falta: el endpoint lo lee
 * como `body.noShowJustified === true`, así que callarlo es decir «sin
 * justificar» — y una falta sin justificar abre incidencia y avisa a
 * administración. Por eso los cuerpos se construyen aquí y no a mano.
 */

import { esPresunta, estadoEfectivo } from "./asistencia.js";
import { rotuloFalta } from "./recuperacionFalta.js";

/**
 * Los cuatro resultados que se pueden poner a mano, en el orden en que se
 * enseñan: primero lo bueno, luego las dos faltas, y cancelar al final.
 *
 * `motivo` describe qué se pregunta antes de guardar (`null` = no se pregunta
 * nada). `tono` es para pintar: la pantalla decide el color, no el texto.
 */
export const RESULTADOS_CITA = Object.freeze([
  {
    clave: "completada",
    label: "Completada",
    status: "completed",
    tono: "bien",
    motivo: null,
    ayuda: "Vino a la cita.",
  },
  {
    clave: "falta_justificada",
    label: "Falta justificada",
    status: "no_show",
    tono: "aviso",
    motivo: { titulo: "Motivo de la falta", etiqueta: "Opcional", confirmar: "Marcar la falta" },
    ayuda: "Avisaron, enfermedad, un imprevisto… podrá recuperarla con otra cita.",
  },
  {
    clave: "falta_injustificada",
    label: "Falta injustificada",
    status: "no_show",
    tono: "peligro",
    motivo: { titulo: "¿Qué ha pasado?", etiqueta: "Opcional", confirmar: "Marcar la falta" },
    ayuda: "No vino y no avisó: no se recupera y se avisa a administración.",
  },
  {
    clave: "cancelada",
    label: "Cancelar la cita",
    status: "cancelled",
    tono: "peligro",
    motivo: {
      titulo: "Cancelar la cita",
      texto: "Se le avisará por correo si tiene consentimiento y correo en su ficha.",
      etiqueta: "Motivo (opcional)",
      confirmar: "Cancelar la cita",
      cancelar: "Volver",
    },
    ayuda: "La cita no se da: ni vino ni contaba como falta.",
  },
]);

const POR_CLAVE = Object.fromEntries(RESULTADOS_CITA.map((r) => [r.clave, r]));

export function resultadoPorClave(clave) {
  return POR_CLAVE[clave] ?? null;
}

/**
 * El cuerpo del PATCH de un resultado. `motivo` es el texto opcional que se
 * haya tecleado (vacío → `null`, nunca cadena vacía: en la base sería un motivo
 * puesto y en blanco, que es distinto de no haber puesto ninguno).
 */
export function cuerpoDelResultado(clave, motivo = null) {
  const r = POR_CLAVE[clave];
  if (!r) return null;
  const texto = typeof motivo === "string" && motivo.trim() ? motivo.trim() : null;
  if (r.status === "no_show") {
    return {
      status: "no_show",
      noShowJustified: clave === "falta_justificada",
      noShowReason: texto,
    };
  }
  if (r.status === "cancelled") {
    return { status: "cancelled", cancellationReason: texto };
  }
  return { status: r.status };
}

/**
 * En qué resultado está una cita AHORA MISMO, con la presunción de asistencia
 * incluida (`asistencia.js`): una confirmada que ya terminó cuenta como
 * completada aunque nadie la haya tocado.
 *
 * Devuelve `null` para las que todavía no han acabado: una cita de mañana no
 * tiene resultado, tiene estado.
 */
export function resultadoDeCita(cita, ahora = new Date()) {
  if (!cita) return null;
  if (cita.status === "cancelled") return "cancelada";
  if (cita.status === "no_show") {
    return cita.noShowJustified === true ? "falta_justificada" : "falta_injustificada";
  }
  return estadoEfectivo(cita, ahora) === "completed" ? "completada" : null;
}

/**
 * El rótulo de una cita para una lista: su resultado si ya lo tiene, y si no,
 * en qué estado está. Las faltas las nombra `recuperacionFalta.js`, que es
 * donde vive la equivalencia justificada = recuperable.
 */
export function etiquetaResultado(cita, ahora = new Date()) {
  if (!cita) return "—";
  if (cita.status === "no_show") return rotuloFalta(cita);
  if (cita.status === "cancelled") return "Cancelada";
  if (cita.status === "completed") return "Completada";
  if (esPresunta(cita, ahora)) return "Se da por asistida";
  return cita.status === "pending" ? "Pendiente" : "Confirmada";
}

/**
 * ¿Tiene sentido poner un resultado a esta cita? No en una que todavía no ha
 * empezado: marcarla como falta antes de tiempo no es un caso de uso, es un
 * clic equivocado. La ficha de la cita sigue enseñando sus botones (allí se
 * está mirando UNA cita a propósito); esto es para las listas.
 */
export function admiteResultado(cita, ahora = new Date()) {
  if (!cita) return false;
  if (cita.status === "cancelled") return false;
  const empieza = cita.scheduledAt ? new Date(cita.scheduledAt).getTime() : NaN;
  if (Number.isNaN(empieza)) return false;
  return empieza <= new Date(ahora).getTime();
}
