/**
 * anchoPantalla — el margen y el ancho de una pantalla del CRM, decidido en un
 * solo sitio.
 *
 * ── POR QUÉ EXISTE (13/08/2026, Rodrigo: «hay que mirar por qué ocurre esto») ─
 * El ancho de Formación se ha arreglado ya varias veces y siempre vuelve. No es
 * mala suerte: es que **no había ningún sitio donde estuviera decidido**. Cada
 * pantalla se escribía su propio `p-… max-w-…` a mano, copiado de la que tuviera
 * más cerca, así que el módulo acabó con CUATRO respuestas distintas a la misma
 * pregunta:
 *
 *     /formacion                 max-w-5xl
 *     /formacion/empresas        max-w-6xl
 *     /formacion/cursos          max-w-6xl
 *     /formacion/usuarios        max-w-7xl
 *     /formacion/alumnos         max-w-7xl
 *     /formacion/empresas/[id]   max-w-5xl
 *     /formacion/cuestionarios   NINGUNO — de lado a lado de la pantalla
 *
 * Y el CRM entero igual: 19 pantallas a 7xl, 13 a 6xl, 12 a 5xl y 6 a 4xl, sin
 * que nada diga cuál toca. El arreglo del 27/07 tocó las dos portadas y las
 * otras cinco pantallas siguieron cada una por su lado — por eso «volvía».
 *
 * Arreglar una pantalla no arregla nada. Lo que se arregla es que la decisión
 * viva en un sitio y que escribirla a mano deje de ser lo natural.
 *
 * ── SOLO HAY DOS ANCHOS, Y ES A PROPÓSITO ───────────────────────────────────
 * Con tres o más vuelve el problema: quien duda elige mal y nadie lo nota.
 *
 *   `portada`  (max-w-3xl)  Portadas de módulo, fichas y formularios. Poco
 *                           contenido: estirarlo deja tarjetas de 500 px con dos
 *                           líneas de texto dentro, que es justo lo que se ve
 *                           «demasiado ancho».
 *   `listado`  (max-w-7xl)  Pantallas con TABLA. Aquí el ancho sí se usa: son
 *                           columnas de verdad y estrecharlas obliga a truncar.
 *
 * Si dudas: ¿tiene una tabla con más de tres columnas? `listado`. Si no,
 * `portada`.
 *
 * ── `portada` BAJÓ DE 4xl A 3xl (14/08/2026, Rodrigo: «se sigue viendo
 *    demasiado wide») ──────────────────────────────────────────────────────────
 * Centralizar el ancho quitó el problema de que volviera por sitios distintos,
 * pero el valor seguía siendo el heredado. Medido en la portada de Formación a
 * 1600 px: tarjetas de 408 px para un icono de 40 px y una descripción de ~250,
 * o sea 150 px de vacío a la derecha de cada una, y métricas de 196 px para un
 * número de una cifra. Lo que se lee como «ancho» no es la página: son cajas
 * grandes con el texto pegado a la izquierda.
 *
 * A 3xl las tarjetas quedan en 344 px y esas descripciones pasan a ocupar sus
 * dos líneas, que es lo que llena la caja. Se comprobó que ninguna pantalla de
 * `portada` tiene tabla —la ficha de empresa son tarjetas a dos columnas, que a
 * 344 px siguen cabiendo—, así que estrechar no obliga a truncar nada.
 *
 * `listado` NO se toca: en /formacion/usuarios son ocho columnas repartidas en
 * 1280 px. Ahí el ancho no sobra, se usa.
 *
 * ── POR QUÉ UNA FUNCIÓN Y NO UN COMPONENTE ──────────────────────────────────
 * Un `<Pantalla>` habría obligado a reestructurar el JSX de siete pantallas
 * —una de ellas con tres contenedores por sus estados de carga y error—, y una
 * etiqueta mal cerrada en ese cambio no la habría cazado nadie. Devolviendo las
 * clases, cada pantalla cambia UNA línea y sigue siendo su propio `<div>`.
 *
 * ⚠️ HOY SOLO LO USA FORMACIÓN. No se ha aplicado al resto del CRM de golpe a
 * propósito: cambiaría el ancho de cincuenta pantallas de siete clientes en un
 * commit que nadie podría revisar. Lo que sí vale desde ya: **una pantalla nueva
 * usa esto y no escribe `max-w-` a mano**, y la que se toque por otro motivo se
 * pasa de paso.
 */

const ANCHOS = {
  portada: "max-w-3xl",
  listado: "max-w-7xl",
};

/**
 * @param {"portada"|"listado"} [tipo="portada"]
 * @returns {string} las clases del contenedor raíz de la pantalla
 */
export function anchoPantalla(tipo = "portada") {
  // Un valor mal escrito cae en `portada` en vez de quedarse sin ancho: el fallo
  // que se estaba arreglando era justamente una pantalla sin límite.
  return `p-4 lg:p-8 ${ANCHOS[tipo] ?? ANCHOS.portada} mx-auto`;
}
