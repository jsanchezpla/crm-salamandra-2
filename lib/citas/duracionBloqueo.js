/**
 * lib/citas/duracionBloqueo.js — que un hueco cerrado no se coma el curso
 * entero sin que nadie lo haya querido (08/09/2026).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Daniela: «sigo sin tener horario en CRM actualizado… no coincide». Su agenda
 * del CRM sí coincidía con Organízate hasta el viernes 11; a partir de ahí
 * tenía encima UN bloqueo de 420.495 minutos —del 11/09/2026 a las 15:30 al
 * 30/06/2027 a las 15:45— que tapaba 991 citas vivas. Estefanía tenía otro
 * igual, etiquetado «Vacaciones», encima de 1.163 citas.
 *
 * Los dos llevan la misma huella: la HORA de fin es la de inicio más quince
 * minutos, y la FECHA de fin es el último día del curso. O sea, alguien
 * entendió «hasta cuándo» como «hasta cuándo se repite» y no como «cuándo
 * termina este hueco». No es cosa de una persona despistada: son dos personas
 * distintas, dos días distintos y la misma equivocación, y Daniela lo intentó
 * SEIS veces en ocho minutos. Eso es la pantalla, no ellas.
 *
 * ── POR QUÉ NO SE PROHÍBE Y SE PREGUNTA ────────────────────────────────────
 * Un bloqueo largo de verdad existe: unas vacaciones de tres semanas son un
 * bloqueo de tres semanas. Prohibir por encima de un día rompería el caso
 * legítimo. Lo que no puede pasar es que salga sin querer y en silencio, así
 * que por encima de 24 h hace falta decir que sí a propósito
 * (`confirmarLargo`), y el aviso NOMBRA la equivocación probable cuando lleva
 * la huella de arriba.
 *
 * Vive en `lib/` y no en el endpoint porque la pantalla necesita el MISMO
 * cálculo para preguntar antes de mandar: si cada lado lo hiciera por su
 * cuenta, un día dirían cosas distintas.
 */

/** Minutos que tiene un día. Por encima de esto, un bloqueo hay que quererlo. */
export const MINUTOS_DE_UN_DIA = 24 * 60;

/** Los minutos que dura, o null si las fechas no valen. */
export function minutosDeBloqueo(inicio, fin) {
  const a = inicio instanceof Date ? inicio : new Date(inicio);
  const b = fin instanceof Date ? fin : new Date(fin);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const min = (b.getTime() - a.getTime()) / 60000;
  return Number.isFinite(min) ? min : null;
}

/** 'HH:MM' de un instante en hora de Madrid, que es la que se teclea. */
function horaMadrid(d) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

/**
 * ¿Hay que preguntar antes de guardar este bloqueo? Devuelve null cuando no
 * (lo normal), y si sí, con qué palabras se pregunta.
 *
 * `mismaHoraDelDia` es la huella del fallo: se acaba a la misma hora a la que
 * empieza (o casi), pero días o meses después. Cuando aparece, el aviso deja de
 * ser un «son muchos días» genérico y dice lo que de verdad ha pasado.
 */
export function avisoDeBloqueoLargo(inicio, fin) {
  const minutos = minutosDeBloqueo(inicio, fin);
  if (minutos === null || minutos <= MINUTOS_DE_UN_DIA) return null;

  const a = inicio instanceof Date ? inicio : new Date(inicio);
  const b = fin instanceof Date ? fin : new Date(fin);
  const dias = Math.round(minutos / MINUTOS_DE_UN_DIA);
  const [hi, mi] = horaMadrid(a).split(":").map(Number);
  const [hf, mf] = horaMadrid(b).split(":").map(Number);
  const distancia = Math.abs(hf * 60 + mf - (hi * 60 + mi));
  const mismaHoraDelDia = distancia <= 60;

  const cuanto = dias >= 60 ? `${Math.round(dias / 30)} meses` : `${dias} días`;
  const texto = mismaHoraDelDia
    ? `Esto cierra la agenda ${cuanto} seguidos, no ese rato de cada día. Si lo que quieres es guardar la misma hora todas las semanas, hay que apuntar el hueco de cada día: «hasta cuándo» es cuándo termina ESTE hueco, no hasta cuándo se repite.`
    : `Esto cierra la agenda ${cuanto} seguidos. Si son vacaciones o una baja, adelante; si no, revisa la fecha de fin.`;

  return { minutos, dias, mismaHoraDelDia, texto };
}
