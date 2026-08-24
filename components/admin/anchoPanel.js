/**
 * anchoPanel — el ancho y el margen de una pantalla del PANEL, en un solo sitio.
 *
 * ── POR QUÉ EXISTE (24/08/2026, Jorge: «la mayoría de pestañas tienen mucho
 *    padding a los lados, quiero que ocupe más ancho el contenido») ──────────
 * Las siete pantallas del panel se escribían su contenedor a mano, y habían
 * acabado con CINCO respuestas distintas a la misma pregunta:
 *
 *     /admin/tablero        max-w-[900px]      ← el Registro, el más estrecho
 *     /admin/integraciones  max-w-[1000px]
 *     /admin/paquetes       max-w-[1000px]
 *     /admin/clientes       max-w-5xl (1.024)
 *     /admin/buzon          max-w-[1100px]
 *     /admin                max-w-[1180px]
 *     /admin/modulos        max-w-[1180px]
 *
 * Ninguna de esas cifras la había decidido nadie: cada pantalla copiaba la de la
 * que tuviera más cerca. En un monitor de 1.920 el Registro dejaba más de mil
 * píxeles en blanco mientras la barra de navegación iba de lado a lado, así que
 * el contenido se veía estrangulado debajo de su propio menú.
 *
 * Es el mismo fallo que `components/layout/anchoPantalla.js` arregló en el CRM
 * el 13/08, y se arregla igual: la decisión vive en un sitio y escribirla a mano
 * deja de ser lo natural. Arreglar una pantalla no arregla nada.
 *
 * ── POR QUÉ NO LLAMA A `anchoPantalla()` DEL CRM ────────────────────────────
 * Porque el panel no es otra pantalla del CRM: es otra superficie, con su
 * paleta, su tipografía y su ritmo de márgenes (`px-6 lg:px-12 py-10 lg:py-14`,
 * frente al `p-4 lg:p-8` de allí). Reutilizarlo cambiaría el margen de las siete
 * de paso —que no es lo que se pidió— y las dejaría en `max-w-7xl`, 1.280 px:
 * en 1.920 son 320 px de blanco a cada lado, o sea la queja otra vez. Son dos
 * decisiones distintas y se toman en dos sitios. Si algún día convergen, se
 * juntan aquí.
 *
 * ── POR QUÉ 1.800 Y NO PANTALLA COMPLETA ────────────────────────────────────
 * En 1.920 deja unos 60 px a cada lado: prácticamente de borde a borde y a la
 * altura de la barra de arriba. El tope solo entra en juego en un monitor más
 * ancho, y ahí hace falta: el panel es casi todo TABLAS —los módulos de cada
 * cliente, las dependencias entre módulos, el Registro—, y una tabla de lado a
 * lado en 2.560 px deja las columnas separadas medio metro.
 *
 * ⚠️ LAS CLASES SE ESCRIBEN LITERALES A PROPÓSITO. Tailwind busca los nombres de
 * clase leyendo el código fuente como texto: un `max-w-[${ancho}px]` compuesto en
 * tiempo de ejecución no lo ve nadie y la clase no llega a generarse. Por eso
 * aquí hay una cadena y no un número.
 */

/** Solo el tope, para quien ya tiene su propio contenedor (la tarjeta de Alta). */
export const MAX_ANCHO_PANEL = "max-w-[1800px]";

/**
 * Las clases del contenedor raíz de una pantalla del panel.
 * @returns {string}
 */
export function anchoPanel() {
  return `min-h-screen px-6 lg:px-12 py-10 lg:py-14 ${MAX_ANCHO_PANEL} mx-auto`;
}
