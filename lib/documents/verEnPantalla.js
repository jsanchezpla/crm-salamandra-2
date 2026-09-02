/**
 * lib/documents/verEnPantalla.js — ¿este fichero se puede ENSEÑAR en pantalla,
 * y como qué?
 *
 * Nació en `lib/buzon/buzon.js` (13/08/2026) para las capturas del buzón y se
 * mudó aquí el 02/09/2026 (AV-0025 de Aumenta: «que los archivos subidos en
 * Documentos no tengan que descargarse para abrirlos») porque ahora lo
 * necesitan también el archivo de Documentos y los adjuntos del paciente. El
 * buzón lo sigue importando de aquí; la regla es UNA.
 *
 * Sin dependencias a propósito: lo leen a la vez el endpoint (para decidir la
 * cabecera) y el navegador (para saber si pinta el botón «Ver»), y este
 * fichero no puede arrastrar `node:fs` al bundle del cliente.
 *
 * ── LAS DOS REGLAS, Y POR QUÉ ───────────────────────────────────────────────
 *
 * 1. EL TIPO SALE DE LA EXTENSIÓN QUE GUARDAMOS NOSOTROS, no del `mime` de la
 *    ficha. Ese `mime` es lo que declaró el navegador de quien subió el
 *    fichero, o sea que lo elige él. La extensión de la ruta en disco la
 *    escribió `extFromFileName` al guardar. Fiarse del `mime` sería dejar que
 *    quien sube decida cómo se lo servimos al que mira.
 *
 * 2. SVG NO ENTRA, y es lo único que hay que recordar de aquí. Un SVG es un XML
 *    que puede llevar `<script>` dentro: abierto en línea se ejecuta EN NUESTRO
 *    ORIGEN (y una de las pantallas del buzón es el back-office, donde vive la
 *    sesión que toca la configuración de todos los clientes).
 *
 * Es lista BLANCA: lo que no esté aquí (DOCX, XLSX, HTML, ZIP, lo que sea) se
 * descarga. Un Word no se puede enseñar en un navegador sin convertirlo, y eso
 * es otra cosa.
 */
const VISIBLES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  /*
   * `jfif` y `jpe` son JPEG con otro nombre, y hay que aceptarlos (24/08/2026).
   * Chrome en Windows guarda JPEGs como `.jfif` en cuanto la web los sirve sin
   * nombre —pasa con lo que se descarga de un chat, que es justo de donde
   * salen las capturas que nos mandan—. Aceptarlos aquí arregla además las
   * que YA están guardadas: esta lista se consulta al servir, no al subir.
   */
  jfif: "image/jpeg",
  jpe: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** Content-Type con el que servirlo en línea, o `null` = obligar a descargar. */
export function tipoParaVerEnPantalla(rutaONombre) {
  const ext = String(rutaONombre || "").split(".").pop()?.toLowerCase();
  return VISIBLES[ext] ?? null;
}

/** ¿Es una imagen (y no un PDF)? Decide si se pinta con <img> o con <iframe>. */
export function esImagenEnPantalla(rutaONombre) {
  const tipo = tipoParaVerEnPantalla(rutaONombre);
  return Boolean(tipo && tipo.startsWith("image/"));
}
