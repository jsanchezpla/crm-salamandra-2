/**
 * lib/citas/filtroRecordado.js — la profesional que se estaba mirando en la
 * agenda se queda puesta un rato corto.
 *
 * Fichero puro y sin dependencias, como su vecino `filtros.js`: lo importa la
 * pantalla de Citas, que es cliente. Aquí no se toca `localStorage` a ciegas —
 * el almacén entra por parámetro, así que la prueba puede pasarle uno de
 * mentira y no hace falta un navegador para fijar las reglas.
 *
 * ── DE QUÉ PETICIÓN REAL NACE (10/09/2026, Rosa de Aumenta) ─────────────────
 *
 * «Cada vez que salgo de Citas a otra pestaña del CRM y vuelvo, me salen todas
 * las terapeutas sin seleccionar ninguna; que se quede la que estaba mirando.»
 *
 * Es la segunda mitad del mismo problema que el 09/09/2026 llevó la vista por
 * terapeuta a la dirección (`CitasModule.jsx`): aquello arregló el botón de
 * ATRÁS, pero quien vuelve a Citas por el MENÚ llega a `/citas` limpio, y el
 * filtro nacía en blanco. Con dieciocho personas en el centro, dirección
 * reparte la agenda entrando y saliendo decenas de veces al día, y cada
 * regreso costaba volver a buscar a la misma persona en el desplegable.
 *
 * ── POR QUÉ DIEZ MINUTOS Y NO PARA SIEMPRE ─────────────────────────────────
 *
 * Lo pidió así Rodrigo: «plazos cortos». Un filtro que dura para siempre deja
 * de ser un filtro y se convierte en una trampa — el lunes por la mañana la
 * agenda se abriría acotada a la terapeuta que se miró el viernes, y quien no
 * recuerde haberlo puesto lee una agenda a medias como si faltaran citas. Diez
 * minutos cubren la ida y vuelta a una ficha, a Cobros o al Registro, y no
 * llegan a la siguiente tarea.
 *
 * El plazo se cuenta desde la ÚLTIMA vez que se usó, no desde que se eligió:
 * quien está repartiendo la agenda durante media hora no pierde el filtro a
 * mitad de faena.
 *
 * ── LO QUE SE GUARDA, Y DE QUIÉN ───────────────────────────────────────────
 *
 * `{ u: userId, t: sello, ids }`, donde `ids` es `null` («todo el equipo») o la
 * lista elegida. El `userId` va dentro a propósito: en recepción se comparte
 * ordenador y el navegador es el mismo, así que sin él la siguiente persona
 * abriría la agenda acotada a la terapeuta que miró la anterior.
 *
 * `null` se recuerda igual que una lista: si alguien acaba de poner «Todo el
 * equipo», volver a Citas no puede devolverle su propia agenda (lo que haría
 * la preselección de `CitasModule`) o el filtro se sentiría embrujado.
 */

/** Cuánto dura lo recordado. Corto a propósito: ver la cabecera. */
export const MINUTOS_DE_MEMORIA = 10;

/** La clave del almacén. Mismo prefijo que `citas.compacta` y `citas.miniMeses`. */
export const CLAVE_FILTRO_PROFESIONAL = "citas.filtroProfesional";

const MS_DE_MEMORIA = MINUTOS_DE_MEMORIA * 60 * 1000;

/**
 * `localStorage` cuando lo hay y `null` cuando no (servidor, o un navegador con
 * el almacenamiento capado: en modo privado `localStorage` existe pero lanza).
 * Todo lo de aquí trata el `null` como «sin memoria», que es el comportamiento
 * de siempre: la agenda se abre como se abría antes.
 */
export function memoriaDelNavegador() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Qué filtro por profesional hay que reponer al entrar en Citas.
 *
 * @param {Storage|null} almacen
 * @param {object} opciones
 * @param {string|null} opciones.userId  Quién mira; sin él no se repone nada.
 * @param {string[]} [opciones.idsValidos]  Los ids de equipo que existen HOY.
 * @param {number} [opciones.ahora]
 * @returns {{ ids: string[]|null } | null} `null` = no hay nada que reponer.
 */
export function recuperarFiltroDeProfesional(almacen, { userId, idsValidos = null, ahora = Date.now() } = {}) {
  if (!almacen || !userId) return null;
  let crudo = null;
  try {
    crudo = almacen.getItem(CLAVE_FILTRO_PROFESIONAL);
  } catch {
    return null;
  }
  if (typeof crudo !== "string" || crudo === "") return null;

  let guardado = null;
  try {
    guardado = JSON.parse(crudo);
  } catch {
    // Basura de una versión anterior o de otra pestaña: se tira y se sigue.
    olvidarFiltroDeProfesional(almacen);
    return null;
  }
  if (!guardado || typeof guardado !== "object") return null;
  // De otra persona que usó este mismo ordenador: no es asunto de quien mira.
  if (guardado.u !== userId) return null;
  if (typeof guardado.t !== "number" || !Number.isFinite(guardado.t)) return null;
  if (ahora - guardado.t > MS_DE_MEMORIA || ahora < guardado.t) {
    olvidarFiltroDeProfesional(almacen);
    return null;
  }

  if (guardado.ids === null) return { ids: null }; // «Todo el equipo», a propósito
  if (!Array.isArray(guardado.ids)) return null;
  // Lista vacía = todos, igual que en el `MultiSelect` de la pantalla.
  if (guardado.ids.length === 0) return { ids: null };

  /*
   * Una ficha de equipo borrada (o de un tenant distinto, que el almacén no
   * separa) dejaría el filtro pidiendo un id que ya no existe, y eso es una
   * agenda en blanco que se lee como «han desaparecido las citas». Se cruza con
   * lo que hay hoy y, si no queda nadie, se hace como si no hubiera recuerdo:
   * manda el arranque de siempre.
   */
  const validos = Array.isArray(idsValidos) ? new Set(idsValidos.map((v) => String(v))) : null;
  const ids = guardado.ids
    .filter((v) => typeof v === "string" && v !== "")
    .filter((v) => !validos || validos.has(v));
  if (ids.length === 0) return null;
  return { ids };
}

/**
 * Deja anotado el filtro que hay puesto (y refresca el plazo).
 *
 * @param {Storage|null} almacen
 * @param {object} opciones
 * @param {string|null} opciones.userId
 * @param {string[]|null} opciones.ids  `null` = todo el equipo.
 * @param {number} [opciones.ahora]
 */
export function recordarFiltroDeProfesional(almacen, { userId, ids, ahora = Date.now() } = {}) {
  if (!almacen || !userId) return;
  const lista = Array.isArray(ids) && ids.length > 0 ? ids.map((v) => String(v)) : null;
  try {
    almacen.setItem(CLAVE_FILTRO_PROFESIONAL, JSON.stringify({ u: userId, t: ahora, ids: lista }));
  } catch {
    // Sin memoria (cuota llena, modo privado): solo esta visita, como antes.
  }
}

/** Borra lo recordado. Nunca lanza. */
export function olvidarFiltroDeProfesional(almacen) {
  if (!almacen) return;
  try {
    almacen.removeItem(CLAVE_FILTRO_PROFESIONAL);
  } catch {
    /* sin memoria: no había nada que borrar */
  }
}
