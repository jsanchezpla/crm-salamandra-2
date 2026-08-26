/**
 * lib/correo/composicion.js — montar el CONTENIDO de un correo escrito a mano:
 * el cuerpo, el pie de firma y los adjuntos.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint que envía y el que
 * guarda las firmas, y lo prueba `_smoke-correo-herramientas.mjs`. Si cada uno
 * escapara y recortara por su cuenta, la firma se sanearía al guardar y no al
 * enviar —o al revés— y el hueco quedaría abierto.)
 *
 * ── POR QUÉ LA FIRMA SE SANEA ──────────────────────────────────────────────
 * El pie de firma es HTML que escribe (o sube) una persona del equipo y que
 * sale disparado al buzón de pacientes y clientes desde el dominio verificado
 * del centro. Un `<script>` ahí no se ejecuta en casi ningún cliente de correo,
 * pero un `onmouseover=` o un `javascript:` en un enlace sí pueden vivir en el
 * HTML y son exactamente lo que los filtros de spam castigan. Se limpia al
 * GUARDAR y otra vez al COMPONER: cinturón y tirantes, porque lo guardado pudo
 * entrar por una versión anterior del código.
 *
 * ── POR QUÉ EL CUERPO VIAJA ESCAPADO EN EL HTML ────────────────────────────
 * Hasta ahora el envío manual era texto plano y no había nada que escapar. Con
 * firma, el correo pasa a llevar versión HTML, y el cuerpo —que teclea una
 * persona— se escapa entero antes de entrar en ella. La versión de texto plano
 * sigue tal cual, como en el resto de plantillas (`docs/modules/emails.md`).
 */

export const MAX_ADJUNTOS = 10;
export const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024; // 10 MB por fichero
export const MAX_ADJUNTOS_BYTES = 15 * 1024 * 1024; // 15 MB por envío
export const MAX_FIRMA_HTML = 20000;
export const MAX_FIRMA_IMAGEN_BYTES = 1024 * 1024; // 1 MB: es un logo o un escaneo, no un póster

// Lo que se puede adjuntar: imágenes y PDF (Rodrigo, 26/08/2026). El tipo se
// decide por la EXTENSIÓN del nombre, no por lo que declare el navegador: el
// `content_type` que le pasamos a Resend tiene que casar con lo que el buzón
// del destinatario va a abrir.
const TIPO_POR_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

const TIPOS_IMAGEN_FIRMA = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Texto plano → HTML inofensivo: escapado entero y con los saltos de línea. */
export function textoAHtml(texto) {
  return escapeHtml(texto).replaceAll("\r\n", "\n").replaceAll("\n", "<br />");
}

/**
 * Deja el HTML de una firma sin nada ejecutable. NO es un saneador general de
 * HTML (eso es un proyecto entero): quita lo que puede ejecutar o navegar
 * —scripts, iframes, manejadores `on*`, URLs `javascript:`— y deja el marcado
 * de presentación (negritas, enlaces, tablas, imágenes por URL).
 */
export function sanitizarHtmlFirma(html) {
  let s = String(html ?? "").slice(0, MAX_FIRMA_HTML);
  // Bloques enteros con su contenido: dentro de un <script> no hay nada que salvar.
  s = s.replace(/<(script|style|iframe|object|embed|form|meta|link|base)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  // Los mismos, sin cierre (un <link> o un <meta> no lo llevan).
  s = s.replace(/<\/?(script|style|iframe|object|embed|form|meta|link|base)\b[^>]*>/gi, "");
  // Manejadores de evento dentro de cualquier etiqueta: onclick=, onmouseover=…
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // URLs que ejecutan en vez de navegar.
  s = s.replace(/(href|src)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi, '$1=$2#$2');
  return s.trim();
}

/** La versión de texto de una firma HTML: sin etiquetas y con las entidades básicas. */
export function htmlATexto(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Bytes reales de una cadena base64, sin decodificarla. */
export function bytesDeBase64(b64) {
  const s = String(b64 ?? "");
  if (!s) return 0;
  const relleno = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - relleno;
}

/** Nombre de fichero presentable: sin rutas, sin caracteres de control, acotado. */
export function limpiarNombreFichero(nombre) {
  const solo = String(nombre ?? "")
    .split(/[\\/]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .trim();
  return solo.slice(0, 120) || "adjunto";
}

/**
 * Valida los adjuntos que llegan de la pantalla y los deja como los quiere
 * Resend. Devuelve `{ adjuntos }` o `{ error }` — un adjunto malo tumba el
 * envío ENTERO antes de mandar nada: mejor que descubrir a mitad de tanda que
 * la mitad de la gente recibió el correo sin el PDF.
 */
export function validarAdjuntos(brutos) {
  if (brutos == null) return { adjuntos: [] };
  if (!Array.isArray(brutos)) return { error: "«adjuntos» tiene que ser una lista" };
  if (brutos.length > MAX_ADJUNTOS) {
    return { error: `Como mucho ${MAX_ADJUNTOS} adjuntos por envío` };
  }

  const adjuntos = [];
  let total = 0;
  for (const bruto of brutos) {
    const nombre = limpiarNombreFichero(bruto?.nombre);
    const extension = nombre.includes(".") ? nombre.split(".").pop().toLowerCase() : "";
    const tipo = TIPO_POR_EXTENSION[extension];
    if (!tipo) {
      return { error: `«${nombre}»: solo se pueden adjuntar imágenes (png, jpg, gif, webp) o PDF` };
    }

    const base64 = String(bruto?.base64 ?? "").replace(/\s+/g, "");
    if (!base64 || base64.length % 4 !== 0 || !BASE64_RE.test(base64)) {
      return { error: `«${nombre}» no se ha podido leer. Vuelve a adjuntarlo.` };
    }

    const bytes = bytesDeBase64(base64);
    if (bytes > MAX_ADJUNTO_BYTES) {
      return { error: `«${nombre}» pesa demasiado (máximo ${Math.round(MAX_ADJUNTO_BYTES / 1024 / 1024)} MB por fichero)` };
    }
    total += bytes;
    if (total > MAX_ADJUNTOS_BYTES) {
      return { error: `Los adjuntos juntos pasan de ${Math.round(MAX_ADJUNTOS_BYTES / 1024 / 1024)} MB. Quita alguno.` };
    }

    // Claves en snake_case a propósito: `resendClient` pasa la lista tal cual a
    // la API de Resend (igual que hace con `reply_to`).
    adjuntos.push({ filename: nombre, content: base64, content_type: tipo });
  }

  return { adjuntos };
}

/**
 * Normaliza lo que llega del formulario de firma. Acepta texto plano (se
 * convierte a HTML con sus saltos de línea) o HTML (se sanea), y una imagen
 * opcional en base64. Devuelve `{ html, texto, imagen }` o `{ error }`.
 *
 * `html`, `texto` e `imagen` a null a la vez significa «sin firma»: quien llama
 * decide si eso es borrar la fila o rechazar el guardado.
 */
export function normalizarFirmaEntrada({ html, imagen } = {}) {
  const brutoHtml = String(html ?? "").trim();
  if (brutoHtml.length > MAX_FIRMA_HTML) {
    return { error: `La firma no puede pasar de ${MAX_FIRMA_HTML} caracteres` };
  }

  // Sin ningún `<` es texto plano tecleado: se le respetan los saltos de línea.
  // Con etiquetas, se sanea — y si el saneado se las lleva TODAS (alguien pegó
  // texto con un <script> suelto), lo que queda vuelve a ser texto plano y se
  // le respetan los saltos igual. La distinción evita que una firma de tres
  // líneas llegue como un solo renglón.
  let htmlLimpio = null;
  if (brutoHtml) {
    if (!brutoHtml.includes("<")) {
      htmlLimpio = textoAHtml(brutoHtml);
    } else {
      const saneado = sanitizarHtmlFirma(brutoHtml);
      htmlLimpio = saneado.includes("<") ? saneado : textoAHtml(saneado);
    }
  }
  const texto = htmlLimpio ? htmlATexto(htmlLimpio) || null : null;

  let imagenLimpia = null;
  if (imagen != null) {
    const tipo = String(imagen?.tipo ?? "").toLowerCase();
    if (!TIPOS_IMAGEN_FIRMA.has(tipo)) {
      return { error: "La imagen de la firma tiene que ser png, jpg, gif o webp" };
    }
    const base64 = String(imagen?.base64 ?? "").replace(/\s+/g, "");
    if (!base64 || base64.length % 4 !== 0 || !BASE64_RE.test(base64)) {
      return { error: "La imagen de la firma no se ha podido leer. Súbela otra vez." };
    }
    if (bytesDeBase64(base64) > MAX_FIRMA_IMAGEN_BYTES) {
      return { error: `La imagen de la firma no puede pasar de ${Math.round(MAX_FIRMA_IMAGEN_BYTES / 1024)} KB` };
    }
    imagenLimpia = { nombre: limpiarNombreFichero(imagen?.nombre || "firma.png"), tipo, base64 };
  }

  return { html: htmlLimpio, texto, imagen: imagenLimpia };
}

/**
 * El cuerpo definitivo de un envío manual: texto siempre, y HTML solo cuando
 * hay firma (sin firma, el correo sigue siendo el texto plano de siempre).
 *
 * La imagen de la firma va como adjunto embebido (`content_id` + `cid:`), que
 * es lo único que pintan Gmail y Outlook: un `data:` en el `src` lo bloquean
 * casi todos. Si el buzón no soporta `cid:`, la imagen llega como adjunto
 * normal — degradación aceptable, nunca un correo roto.
 */
export function componerContenido({ cuerpo, firma }) {
  const texto = String(cuerpo ?? "");
  const conFirma = firma && (firma.html || firma.imagen);
  if (!conFirma) return { text: texto, html: null, adjuntosFirma: [] };

  const text = firma.texto ? `${texto}\n\n--\n${firma.texto}` : texto;

  const partes = [
    `<div style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111111;">${escapeHtml(texto)}</div>`,
    `<div style="margin-top:16px;border-top:1px solid #dddddd;padding-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#333333;">`,
    firma.html ? sanitizarHtmlFirma(firma.html) : "",
    firma.imagen
      ? `<img src="cid:firma" alt="" style="max-width:420px;height:auto;display:block;margin-top:8px;" />`
      : "",
    `</div>`,
  ];

  const adjuntosFirma = firma.imagen
    ? [
        {
          filename: firma.imagen.nombre || "firma.png",
          content: firma.imagen.base64,
          content_type: firma.imagen.tipo,
          content_id: "firma",
        },
      ]
    : [];

  return { text, html: partes.join(""), adjuntosFirma };
}
