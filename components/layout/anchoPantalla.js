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
 * Con tres o más vuelve el problema: quien duda elige mal y nadie lo nota. Los
 * NOMBRES sí son tres, porque son tres preguntas distintas; los VALORES, dos.
 *
 *   `portada`  (max-w-7xl)  Portada de módulo: rejilla de tarjetas y métricas.
 *   `listado`  (max-w-7xl)  Pantallas con TABLA. El ancho se usa: son columnas
 *                           de verdad y estrecharlas obliga a truncar.
 *   `ficha`    (max-w-3xl)  El detalle de UNA cosa: una empresa, un intento de
 *                           cuestionario, un formulario. Texto seguido, que a
 *                           1.200 px se lee peor, no mejor.
 *
 * `portada` y `listado` valen hoy lo mismo y se mantienen separadas a
 * propósito: responden a preguntas distintas y ya se han separado una vez.
 * Fundirlas obligaría a volver a partirlas el día que una de las dos cambie.
 *
 * Si dudas: ¿es el detalle de una sola cosa? `ficha`. ¿Tiene tabla? `listado`.
 * Si no, `portada`.
 *
 * ── EL VAIVÉN DEL ANCHO DE LA PORTADA, QUE ES LO QUE HAY QUE ENTENDER ───────
 * 4xl → 3xl (14/08/2026, Rodrigo) → 7xl (24/08/2026, Jorge). Parece que se ha
 * dado la vuelta a una decisión, y no es eso: las dos quejas eran distintas y la
 * primera se resolvió con la palanca equivocada.
 *
 * Rodrigo se quejaba de las TARJETAS —408 px de caja para un icono de 40 y dos
 * líneas de texto—, y la palanca que tenía a mano era estrechar el contenedor.
 * Funcionó, pero pagándolo con el margen: a 3xl la portada dejaba ~500 px de
 * blanco a cada lado en una pantalla de 1600, que es de lo que se quejó Jorge
 * el 24/08. La palanca buena para una tarjeta demasiado ancha no es estrechar la
 * página: es repartirla en MÁS COLUMNAS. Por eso este cambio va acompañado de
 * la rejilla de accesos a tres columnas en `FormacionOverview` — sin eso, subir
 * a 7xl devuelve tarjetas de 590 px y el problema de Rodrigo, más gordo que
 * antes. Las dos cosas van juntas o no van.
 *
 * Con 7xl y tres columnas la tarjeta queda en ~395 px: por debajo de las 408 que
 * se señalaron como demasiado, y el margen lateral baja de ~500 a ~250 px. Y de
 * paso la portada mide lo mismo que los listados del módulo, así que navegar
 * entre Formación y Cursos ya no mueve la página de sitio.
 *
 * Lo que NO se ensancha es el detalle de una cosa, que ahora tiene su propio
 * nombre (`ficha`) y se queda en 3xl: la ficha de empresa y el detalle de un
 * intento de cuestionario, que es texto seguido. Antes compartían nombre con la
 * portada y por eso este cambio se los habría llevado por delante.
 *
 * ── LO QUE SE MIDIÓ EL 14/08, que sigue siendo válido y por eso se conserva ──
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
  portada: "max-w-7xl",
  listado: "max-w-7xl",
  ficha: "max-w-3xl",
};

/**
 * @param {"portada"|"listado"|"ficha"} [tipo="portada"]
 * @returns {string} las clases del contenedor raíz de la pantalla
 */
export function anchoPantalla(tipo = "portada") {
  // Un valor mal escrito cae en `portada` en vez de quedarse sin ancho: el fallo
  // que se estaba arreglando era justamente una pantalla sin límite.
  return `p-4 lg:p-8 ${ANCHOS[tipo] ?? ANCHOS.portada} mx-auto`;
}
