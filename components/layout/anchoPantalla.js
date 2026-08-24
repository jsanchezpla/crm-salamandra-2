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
 * ── CUATRO NOMBRES, TRES ANCHOS ─────────────────────────────────────────────
 * La regla vieja decía «solo dos anchos, y con tres vuelve el problema: quien
 * duda elige mal y nadie lo nota». La regla sigue siendo buena y el peligro
 * también, así que conviene decir qué cambió el 24/08/2026 y por qué:
 *
 *   `portada`  (max-w-7xl)  Portada de módulo: rejilla de tarjetas y métricas.
 *   `listado`  (max-w-7xl)  Muchas cosas a la vez: tabla, o rejilla de fichas.
 *                           El ancho se usa; estrecharlo obliga a truncar.
 *   `ficha`    (max-w-3xl)  El detalle de UNA cosa leída como TEXTO: una
 *                           empresa, un intento de cuestionario. A 1.200 px se
 *                           lee peor, no mejor.
 *   `ajustes`  (max-w-4xl)  La pantalla de configuración de un módulo. Un campo
 *                           de formulario de 1.200 px no se rellena mejor: se
 *                           rellena peor, y el ojo pierde la etiqueta.
 *
 * El cuarto nombre no es una grieta en la regla: es que ese ancho YA existía
 * copiado a mano en cuatro pantallas (`/configuracion`, y las `configuracion`
 * de facturación, pedidos y captación). Estaba sin nombre, que es exactamente
 * la situación que este fichero existe para evitar. Y la pregunta que lo elige
 * no admite duda —¿es la pantalla de ajustes de un módulo?—, que es lo que hacía
 * peligroso al tercer ancho: no el número, sino tener que adivinar.
 *
 * `portada` y `listado` valen hoy lo mismo y se mantienen separadas a
 * propósito: responden a preguntas distintas y ya se han separado una vez.
 * Fundirlas obligaría a volver a partirlas el día que una de las dos cambie.
 *
 * Si dudas: ¿es la pantalla de ajustes? `ajustes`. ¿Es el detalle de una sola
 * cosa, y es texto? `ficha`. ¿Hay muchas cosas a la vez? `listado`. Si no,
 * `portada`.
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
 * ── YA NO LO USA SOLO FORMACIÓN (24/08/2026) ───────────────────────────────
 * Aquí ponía «HOY SOLO LO USA FORMACIÓN; no se ha aplicado al resto del CRM de
 * golpe a propósito: cambiaría el ancho de cincuenta pantallas de siete
 * clientes en un commit que nadie podría revisar». El miedo era bueno y sigue
 * siéndolo; lo que cambió es que Jorge pidió la pasada entera y dijo cómo se
 * revisa: **en local, sin desplegar, mirándolo él**. Eso es exactamente lo que
 * faltaba, así que el aviso se cumplió en vez de saltárselo.
 *
 * Pasaron 46 contenedores de 42 ficheros. Antes de la pasada, medido en el
 * navegador a 1600 px, el CRM contestaba a la misma pregunta con CINCO anchos
 * —896, 1024, 1152, 1280 y sin límite— y dentro de UN módulo:
 *
 *     /facturacion              1024      /facturacion/facturas     1280
 *     /facturacion/cobros       1152      /facturacion/cumplimiento  896
 *     /facturacion/proveedores  sin tope
 *
 * O sea que moverse por la barra de Facturación desplazaba la página de sitio
 * en cada pestaña. Ahora las 15 pantallas del módulo valen 1280 menos la de
 * ajustes.
 *
 * Lo que NO entró, y no es olvido:
 *   · La portada `/` es editorial a propósito (titular en serif, columna de
 *     texto a `max-w-xl`, alineada a la izquierda). Ahí el blanco de la derecha
 *     es diseño, no descuido.
 *   · La ficha de cliente. Sus ~18 tarjetas llevan el `max-w-` copiado a mano
 *     una por una en `components/clients/`, y esos mismos paneles pintan la
 *     ficha propia de nutri_laura. Arreglarlo es su propio trabajo —con su
 *     decisión sobre Laura—, no una línea de una pasada.
 *   · `/proyectos` y `/outreach`, que ya iban a 1400 px.
 *
 * Lo que vale desde siempre: **una pantalla nueva usa esto y no escribe
 * `max-w-` a mano**, y la que se toque por otro motivo se pasa de paso.
 */

const ANCHOS = {
  portada: "max-w-7xl",
  listado: "max-w-7xl",
  ficha: "max-w-3xl",
  ajustes: "max-w-4xl",
};

/**
 * @param {"portada"|"listado"|"ficha"|"ajustes"} [tipo="portada"]
 * @returns {string} las clases del contenedor raíz de la pantalla
 */
export function anchoPantalla(tipo = "portada") {
  // Un valor mal escrito cae en `portada` en vez de quedarse sin ancho: el fallo
  // que se estaba arreglando era justamente una pantalla sin límite.
  return `p-4 lg:p-8 ${ANCHOS[tipo] ?? ANCHOS.portada} mx-auto`;
}
