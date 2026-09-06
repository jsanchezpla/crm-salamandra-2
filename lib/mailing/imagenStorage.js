import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * lib/mailing/imagenStorage.js — las imágenes de los correos de mailing.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten la subida —autenticada— y
 * el servicio público —sin login— y los dos tienen que estar de acuerdo en
 * dónde viven los ficheros y qué nombres son válidos.)
 *
 * Una imagen de un correo tiene que servirse PÚBLICAMENTE (plan, «lo que puede
 * morder»): el buzón del destinatario la pide sin ninguna sesión. Por eso no
 * sirve el archivo de Documentos, que exige login, ni el adjunto en base64 de
 * /correo, que va dentro de cada mensaje (con 500 destinatarios serían 500
 * copias). Aquí se guarda una vez en disco y el correo lleva la URL.
 *
 * Layout: `{UPLOADS_ROOT}/mailing/{slug}/{uuid}.{ext}` — mismo criterio de
 * raíz que `lib/documents/documentStorage.js`. El nombre lo pone el servidor
 * (UUID), así que la URL pública no revela nada y no se puede adivinar.
 *
 * Solo imágenes (png, jpg, gif, webp), 2 MB, y el tipo se comprueba por los
 * MAGIC BYTES del fichero, no por lo que diga el navegador.
 */

export const MAX_IMAGEN_BYTES = 2 * 1024 * 1024;
export const TIPOS_IMAGEN = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
});
const NOMBRE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;

export function getUploadsRoot() {
  if (process.env.UPLOADS_ROOT) return process.env.UPLOADS_ROOT;
  if (process.env.NODE_ENV === "production") return "/app/uploads";
  return path.join(process.cwd(), "uploads");
}

/** El MIME real por los primeros bytes, o null si no es una imagen admitida. */
export function mimePorMagia(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function carpetaDe(slug) {
  if (!/^[a-z0-9_]+$/.test(String(slug ?? ""))) throw new Error("slug inválido");
  return path.join(getUploadsRoot(), "mailing", slug);
}

/** Guarda el buffer y devuelve `{ nombre, mime, bytes }` o `{ error }`. */
export async function guardarImagen(slug, buffer) {
  if (!buffer?.length) return { error: "El fichero está vacío" };
  if (buffer.length > MAX_IMAGEN_BYTES) return { error: `La imagen no puede pasar de ${Math.round(MAX_IMAGEN_BYTES / 1024 / 1024)} MB` };
  const mime = mimePorMagia(buffer);
  if (!mime) return { error: "Solo se admiten imágenes png, jpg, gif o webp" };
  const nombre = `${randomUUID()}.${TIPOS_IMAGEN[mime]}`;
  const carpeta = carpetaDe(slug);
  await fs.mkdir(carpeta, { recursive: true });
  await fs.writeFile(path.join(carpeta, nombre), buffer);
  return { nombre, mime, bytes: buffer.length };
}

/** `{ ruta, mime }` de una imagen guardada, o null si el nombre no es de las nuestras o no existe. */
export async function localizarImagen(slug, nombre) {
  if (!NOMBRE_RE.test(String(nombre ?? ""))) return null;
  const ruta = path.join(carpetaDe(slug), nombre);
  try {
    const st = await fs.stat(ruta);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  const ext = nombre.split(".").pop();
  const mime = Object.entries(TIPOS_IMAGEN).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  return { ruta, mime, bytes: (await fs.stat(ruta)).size };
}

export function streamDeImagen(ruta) {
  return createReadStream(ruta);
}
