/**
 * lib/clinica/vistoIncidencia.js — el «Visto» de cada responsable
 * (04/09/2026, Rodrigo).
 *
 * El encargo, entero: «un botón de Visto para que una terapeuta marque que ha
 * resuelto SU parte de la incidencia, pero que no signifique que está resuelta
 * para todas, y le deje de salir, con la posibilidad de que se la vuelva a
 * tagear en la incidencia si hay una actualización».
 *
 * Son tres cosas, y conviene no confundirlas:
 *
 *   1. **Visto ≠ resuelta.** `incidencias.status` es de la incidencia y lo
 *      gobierna la verificación (`lib/clinica/incidencias.js`): es la respuesta
 *      del centro. El visto es de la PAREJA incidencia↔persona y vive en
 *      `incidencia_assignees.visto_at`: es la respuesta de cada una. Con tres
 *      responsables hay tres vistos y un solo estado.
 *   2. **«Le deje de salir» es la BANDEJA, no la incidencia.** Marcar visto la
 *      aparta de su Bandeja, su campana y su portada — no se la esconde. Puede
 *      seguir abriéndola, buscándola y quitando el visto: si el visto la hiciera
 *      invisible, una incidencia despachada por error no se podría recuperar.
 *      Por eso el alcance (`alcanceIncidencias.js`) NO mira esta columna.
 *   3. **«Que se la vuelva a tagear si hay una actualización».** Cualquier
 *      novedad —un comentario, una edición, que la reabran, que le vuelvan a
 *      asignar la incidencia— borra el visto de LOS DEMÁS y la incidencia les
 *      reaparece. De los demás y no de quien la provoca: si Ana comenta después
 *      de darla por vista, no tiene sentido devolvérsela a Ana.
 *
 * Aquí viven esas reglas, y solo esas: qué cuenta como actualización y a quién
 * le reaparece. Puras y con prueba (`_smoke-incidencia-visto.mjs`), porque el
 * PATCH que las aplica tiene cuatro caminos distintos (editar, comentar,
 * verificar, reasignar) y la respuesta tiene que ser la misma en los cuatro.
 */

/**
 * Campos de `incidencias` cuyo cambio es una ACTUALIZACIÓN de cara al equipo:
 * si cambia uno, lo que cada responsable dio por visto ya no es lo mismo que
 * hay ahora, y vuelve a su bandeja.
 *
 * Lo que NO está aquí está fuera a propósito:
 *   · `clientId` es una foto que se recalcula sola al cambiar el paciente
 *     (que sí cuenta): avisar dos veces del mismo cambio es avisar mal.
 *   · `resolvedAt` viaja pegado a `verification`, que ya cuenta.
 *   · `comments` no es un campo que se edite: el comentario tiene su propia
 *     puerta (`esActualizacion({ hayComentario: true })`) y su aviso.
 */
export const CAMPOS_QUE_REABREN = [
  "title",
  "description",
  "category",
  "subcategory",
  "priority",
  "incidenceDate",
  "patientId",
  "resolution",
  "verification",
  "status",
  "falta",
];

/**
 * ¿Esto que acaba de pasar en la incidencia es una actualización que tiene que
 * devolvérsela a quien ya la había dado por vista?
 *
 * @param {object}  args
 * @param {object}  args.cambios         el objeto que se le pasa a `row.update()`.
 * @param {boolean} args.hayComentario   se ha añadido un comentario al hilo.
 * @param {boolean} args.cambiaronResponsables  se ha tocado la lista de responsables.
 * @returns {boolean}
 */
export function esActualizacion({ cambios, hayComentario = false, cambiaronResponsables = false } = {}) {
  if (hayComentario) return true;
  if (cambiaronResponsables) return true;
  if (!cambios || typeof cambios !== "object") return false;
  return CAMPOS_QUE_REABREN.some((campo) => campo in cambios);
}

/**
 * A quién se le borra el visto: a todos los responsables MENOS a quien ha
 * hecho el cambio.
 *
 * Devuelve la condición de un `UPDATE ... WHERE` (Sequelize), no la ejecuta:
 * quien llama tiene los modelos y la transacción, y así esto se puede probar
 * sin base de datos.
 *
 * @param {string}      incidenciaId
 * @param {string|null} autorTeamMemberId  quien provocó la actualización, si se
 *   sabe. Sin ficha de equipo (dirección con usuario fuera de plantilla) se
 *   reabre para todos: es lo correcto, nadie de la lista lo ha provocado.
 * @param {symbol}      Op  el `Op` de Sequelize (se inyecta para no atar esta
 *   pieza al ORM en las pruebas).
 */
export function aQuienSeLeReabre(incidenciaId, autorTeamMemberId, Op) {
  const where = { incidenciaId, vistoAt: { [Op.ne]: null } };
  if (autorTeamMemberId) where.teamMemberId = { [Op.ne]: autorTeamMemberId };
  return where;
}

/**
 * El texto que ve quien pulsa el botón. Vive aquí y no en el JSX porque la
 * pantalla y la ayuda tienen que contar lo mismo: la confusión que hay que
 * evitar es creer que «Visto» cierra la incidencia para todo el mundo.
 */
export const AYUDA_VISTO =
  "«Visto» marca que tú ya has hecho tu parte: la incidencia desaparece de tu bandeja, " +
  "pero sigue abierta para el resto del equipo. Si alguien la comenta o la cambia, te vuelve a salir. " +
  "Cuando la han dado por vista todas las responsables, se cierra sola.";

/**
 * Lo que la pantalla necesita saber del visto de QUIEN MIRA, a partir de las
 * filas de la pivote de esa incidencia.
 *
 * `puedeMarcar` es false para quien no es responsable: el visto es de «tu
 * parte», y quien solo registró la incidencia no tiene parte que dar por
 * hecha (la ve porque la abrió ella, y se cierra cerrándola).
 *
 * @param {Array<{teamMemberId: string, vistoAt: *}>} filas
 * @param {string|null} yoSoy
 */
export function vistoDe(filas, yoSoy) {
  if (!yoSoy || !Array.isArray(filas)) return { puedeMarcar: false, visto: false, vistoAt: null };
  const mia = filas.find((f) => f && f.teamMemberId === yoSoy);
  if (!mia) return { puedeMarcar: false, visto: false, vistoAt: null };
  const vistoAt = mia.vistoAt ?? null;
  return { puedeMarcar: true, visto: Boolean(vistoAt), vistoAt };
}

/**
 * QUIÉN LA HA REVISADO Y CUÁNDO (05/09/2026, vuelta de AV-0039).
 *
 * Olga, por el Buzón: «así podríamos saber en todo momento en qué estado se
 * encuentra la incidencia y quién la ha revisado». El dato ya se guardaba
 * —`incidencia_assignees.visto_at`, una fila por responsable— pero la ficha
 * solo decía si lo habías marcado TÚ («✓ Visto por ti»): con tres responsables,
 * dos podían haberla despachado y la tercera no tenía forma de saberlo.
 *
 * Aquí solo se ORDENA lo que hay, sin nombres: quién es cada id lo sabe la
 * pantalla, que ya trae `assignees` con su nombre. Sin pendientes primero, que
 * es lo que se mira: quién falta.
 *
 * @param {Array<{teamMemberId: string, vistoAt: *}>} filas
 * @returns {{ repaso: Array<{teamMemberId: string, visto: boolean, vistoAt: *}>,
 *             vistos: number, total: number, todos: boolean }}
 */
export function repasoDelEquipo(filas) {
  const lista = (Array.isArray(filas) ? filas : [])
    .filter((f) => f && f.teamMemberId)
    .map((f) => ({
      teamMemberId: String(f.teamMemberId),
      visto: Boolean(f.vistoAt),
      vistoAt: f.vistoAt ?? null,
    }));
  // Las que faltan, primero; entre las vistas, la más reciente arriba.
  lista.sort((a, b) => {
    if (a.visto !== b.visto) return a.visto ? 1 : -1;
    if (!a.visto) return 0;
    return new Date(b.vistoAt).getTime() - new Date(a.vistoAt).getTime();
  });
  const vistos = lista.filter((x) => x.visto).length;
  return { repaso: lista, vistos, total: lista.length, todos: lista.length > 0 && vistos === lista.length };
}

/**
 * SE CIERRA SOLA CUANDO LA MARCAN TODAS (05/09/2026, Rodrigo: «sí»).
 *
 * Olga pedía «que para que la incidencia desaparezca, todas tengan que poner un
 * tick». Hasta hoy el visto no tocaba `status` a propósito —el estado lo
 * gobernaba la verificación, que es la respuesta del centro— y Rodrigo decidió
 * el 05/09 que cuando la última responsable da la suya, esa ES la respuesta del
 * centro: se cierra como «resuelta».
 *
 * Solo cuando hay al menos una responsable: una incidencia sin nadie al cargo
 * no está «vista por todas», está huérfana. Y solo se cierra, nunca se reabre:
 * quitar un visto después no la devuelve a pendiente —para eso está la
 * verificación—.
 *
 * @param {Array<{teamMemberId: string, vistoAt: *}>} filas las de la pivote, DESPUÉS de escribir el visto
 */
export function cierraAlMarcarTodas(filas) {
  return repasoDelEquipo(filas).todos;
}
