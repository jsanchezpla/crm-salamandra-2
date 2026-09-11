/**
 * contentDisposition(tipo, nombre) — la cabecera `Content-Disposition` con un
 * nombre de fichero que NO puede tumbar la respuesta.
 *
 * `new Response(cuerpo, { headers })` valida cada cabecera como ByteString: un
 * code point por encima de 255 LANZA un TypeError y el usuario ve un 500. Pasó
 * el 10/09/2026 (error K8QBN30F) con un fichero subido desde un Mac: macOS
 * guarda la «ñ» descompuesta (n + U+0303, la tilde combinante), y 771 > 255.
 * Con «ñ» precompuesta (U+00F1 = 241) colaba, así que once rutas que solo
 * quitaban comillas y saltos de línea llevaban meses pareciendo correctas.
 *
 * Cómo se arma (RFC 6266 + RFC 5987):
 *
 *   attachment; filename="Informe Munoz.pdf"; filename*=UTF-8''Informe%20Mu%C3%B1oz.pdf
 *
 *   - `filename="..."` es el RESPALDO para clientes viejos: solo ASCII
 *     imprimible, sin comillas ni barras invertidas. Los acentos se quitan
 *     (ñ → n, á → a) en vez de convertirse en `_`, para que el nombre siga
 *     siendo legible; lo que no tiene equivalente (€, —, emoji) sí va a `_`.
 *   - `filename*=UTF-8''...` lleva el nombre FIEL, normalizado a NFC (para que
 *     el mismo fichero se llame igual venga de un Mac o de Windows) y
 *     percent-encoded. Es el que usan los navegadores actuales.
 *
 * Siempre se normaliza a NFC ANTES de nada: aunque el respaldo por sí solo ya
 * no dejaría pasar la tilde combinante, la parte fiel debe describir el mismo
 * nombre que verá el usuario en su disco.
 */

/** Nombre limpio y en NFC; nunca vacío. */
function nombreLimpio(nombre, porDefecto) {
  let s = String(nombre ?? "");
  // Un par suelto de UTF-16 haría reventar encodeURIComponent (URIError).
  if (typeof s.toWellFormed === "function") s = s.toWellFormed();
  s = s
    .normalize("NFC")
    // Saltos de línea y demás controles: ni en la cabecera ni en el nombre.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return s || porDefecto;
}

/** El respaldo `filename="..."`: ASCII imprimible sin comillas ni barras. */
function respaldoAscii(nombre) {
  const sinAcentos = nombre.normalize("NFD").replace(/\p{M}/gu, "");
  // Con `u`, un emoji (dos unidades UTF-16) es UN carácter y sale como un solo `_`.
  const ascii = sinAcentos.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/g, "_").trim();
  return ascii || "archivo";
}

/**
 * RFC 5987: percent-encoding de UTF-8 donde solo se libran los `attr-char`.
 * encodeURIComponent deja pasar `'()*`, que ahí NO están permitidos.
 */
function codificarRfc5987(nombre) {
  return encodeURIComponent(nombre).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * @param {"attachment"|"inline"} tipo  Descargar o mostrar en pantalla.
 * @param {string|null|undefined} nombre  El nombre visible del fichero, tal cual.
 * @returns {string} El valor entero de la cabecera, listo para `headers`.
 */
export function contentDisposition(tipo, nombre) {
  const disposicion = tipo === "inline" ? "inline" : "attachment";
  const limpio = nombreLimpio(nombre, "archivo");
  return `${disposicion}; filename="${respaldoAscii(limpio)}"; filename*=UTF-8''${codificarRfc5987(limpio)}`;
}
