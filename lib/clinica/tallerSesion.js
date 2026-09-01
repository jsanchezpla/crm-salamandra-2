/**
 * lib/clinica/tallerSesion.js — cómo una sesión de taller se convierte en el
 * registro de CADA paciente que fue (01/09/2026, Aumenta por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: esto lo necesitan tres sitios —el endpoint
 * que guarda la sesión del taller, el que la borra y el formulario que la
 * escribe—, y son reglas que no pueden salir distintas en ninguno: si el
 * reparto se copia, la primera copia que alguien toque le enseña a una familia
 * la nota de otro niño.)
 *
 * ── EL ENCARGO, EN UNA FRASE ────────────────────────────────────────────────
 * «El registro general el mismo a todos menos el apartado extra privado para
 * cada paciente.»
 *
 * O sea, dos mitades con reglas opuestas:
 *
 *   · **La común** — qué se trabajó, qué actividades, cómo fue el grupo. Se
 *     escribe UNA vez, en `taller_sesiones`, y se copia igual a los ocho.
 *   · **La individual** — «hoy participó», «se levantó dos veces». Vive SOLO en
 *     la sesión de ese paciente y no viaja a ningún otro sitio.
 *
 * ── DÓNDE VIVE LA NOTA INDIVIDUAL, Y POR QUÉ AHÍ ────────────────────────────
 * En `clinic_sessions.content_sections`, con la clave `notaIndividualTaller`.
 * Es un apartado más del registro, con su título, así que se imprime, se lee y
 * se envía como cualquier otro — que es lo que se pidió: que le salga «en sus
 * sesiones».
 *
 * Y como es un apartado más, NO se puede llamar igual que uno de fábrica ni
 * colarse en el registro común: `apartadosComunes()` la echa de la lista común
 * si alguien la mete, y la propagación nunca escribe esa clave con nada que no
 * sea la nota de ese paciente. Es la única regla de este fichero que, si se
 * rompe, se rompe hacia una familia.
 *
 * ── LO QUE NO SE PROPAGA ────────────────────────────────────────────────────
 * Las notas internas del grupo (`TallerSesion.internalNotes`). Material del
 * equipo, no sale del CRM y desde luego no baja a ocho registros que se pueden
 * enviar al área privada de ocho familias.
 */

import {
  CLAVE_APARTADOS,
  CLAVE_PLANTILLA,
  apartadosGuardados,
  normalizarApartados,
  repartirValoresDeSesion,
} from "./plantillas.js";

/** La clave del apartado privado de cada paciente. NO se renombra nunca. */
export const CLAVE_NOTA_INDIVIDUAL = "notaIndividualTaller";

/** Su título por defecto; el centro puede poner otro en la sesión del taller. */
export const ETIQUETA_NOTA_POR_DEFECTO = "Nota individual";

const MAX_ETIQUETA = 120;

function texto(v) {
  return typeof v === "string" ? v.trim() : "";
}

/** El apartado de la nota individual, con el título que use el centro. */
export function apartadoDeNota(etiqueta) {
  return {
    key: CLAVE_NOTA_INDIVIDUAL,
    label: texto(etiqueta).slice(0, MAX_ETIQUETA) || ETIQUETA_NOTA_POR_DEFECTO,
    tipo: "texto",
  };
}

/**
 * Los apartados del registro COMÚN, con la nota individual fuera.
 *
 * El filtro no es paranoia: los apartados los elige quien escribe, desde una
 * plantilla del centro que también se edita. Con la clave de la nota dentro de
 * la lista común, la propagación escribiría en ella el texto del grupo y le
 * borraría a los ocho su nota — o peor, le pondría a cada uno la misma.
 */
export function apartadosComunes(bruto) {
  return normalizarApartados(bruto).filter((a) => a.key !== CLAVE_NOTA_INDIVIDUAL);
}

/** Bolsa plana de valores del registro común (sin la foto ni la plantilla). */
export function valoresComunes(contentSections) {
  const cs = contentSections && typeof contentSections === "object" && !Array.isArray(contentSections)
    ? contentSections
    : {};
  const bolsa = { ...cs };
  delete bolsa[CLAVE_APARTADOS];
  delete bolsa[CLAVE_PLANTILLA];
  // Si alguien la coló en el común, aquí se queda fuera: la nota la pone la
  // propagación, paciente a paciente.
  delete bolsa[CLAVE_NOTA_INDIVIDUAL];
  return bolsa;
}

/** La nota individual que ya tenía guardada la sesión de un paciente. */
export function notaIndividualDe(contentSections) {
  const cs = contentSections && typeof contentSections === "object" && !Array.isArray(contentSections)
    ? contentSections
    : {};
  const v = cs[CLAVE_NOTA_INDIVIDUAL];
  return Array.isArray(v) ? v.map(texto).filter(Boolean).join("\n\n") : texto(v);
}

/**
 * LA función: el registro de UN paciente que fue a esta sesión de taller.
 *
 * Devuelve el objeto listo para `create`/`update` de `ClinicSession` —columnas
 * de siempre incluidas—, con el cuerpo común ya dentro y su nota individual
 * como un apartado más al final.
 *
 * Se apoya en `repartirValoresDeSesion`, que es el MISMO reparto que usa el
 * formulario de una sesión normal: los apartados de fábrica van a sus columnas
 * de toda la vida (de donde comen el informe, el anexo y las estadísticas) y
 * solo los nuevos —y la nota— al JSONB. Sin esto, un paciente que va a HHSS
 * todo el curso tendría el taller en la pantalla y no en su informe.
 *
 * @param sesionTaller  la fila de `taller_sesiones` (o su JSON)
 * @param nota          la nota individual de ESTE paciente
 * @param etiquetaNota  el título del apartado privado
 */
export function registroDelPaciente({ sesionTaller, nota = "", etiquetaNota = "" }) {
  const j = sesionTaller?.toJSON ? sesionTaller.toJSON() : sesionTaller ?? {};
  const comunes = apartadosComunes(apartadosGuardados(j.contentSections));
  const bolsa = valoresComunes(j.contentSections);

  const apartadoNota = apartadoDeNota(etiquetaNota);
  bolsa[CLAVE_NOTA_INDIVIDUAL] = texto(nota);

  const repartido = repartirValoresDeSesion(bolsa, [...comunes, apartadoNota]);

  return {
    ...repartido,
    sessionDate: j.sessionDate ?? new Date(),
    duration: j.duration ?? null,
    therapistId: j.teamMemberId ?? null,
    tallerSesionId: j.id ?? null,
    // 'published' del taller = cerrada; la del paciente hereda el mismo estado
    // para que las dos se lean igual de cerradas en su ficha.
    status: j.status === "published" ? "published" : "registered",
  };
}

/**
 * El título del apartado privado tal como quedó guardado en la sesión de un
 * paciente, para que al reabrir el formulario del taller salga el que se puso y
 * no el de fábrica. Se lee de la foto de apartados, que es donde vive el rótulo.
 */
export function etiquetaNotaDe(contentSections) {
  const foto = apartadosGuardados(contentSections);
  const nota = foto.find((a) => a.key === CLAVE_NOTA_INDIVIDUAL);
  return nota?.label ?? "";
}

/** ¿Este registro sale de un taller? (lo que lo distingue de una sesión normal) */
export function esSesionDeTaller(sesion) {
  const j = sesion?.toJSON ? sesion.toJSON() : sesion ?? {};
  return Boolean(j.tallerSesionId);
}
