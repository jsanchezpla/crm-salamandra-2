import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getUploadsRoot, mimePorMagia } from "../mailing/imagenStorage.js";

/**
 * lib/billing/marcaImagen.js — el logo y el SELLO del centro, subidos desde el
 * ordenador (07/09/2026, AV-0069 de Aumenta).
 *
 * Rosa: «NO SALE EL SELLO DE AUMENTA EN LAS FACTURAS. ESTÁ REFLEJADO PERO NI
 * PUESTO NI QUITADO EL CLICK». Y no era que no se pintara: es que no había
 * forma de ponerlo. Los tres campos de marca (logo de factura, sello, logo de
 * presupuesto) eran cajas de texto donde había que pegar la DIRECCIÓN de una
 * imagen ya publicada en internet. Quien tiene el sello en un PNG en su
 * ordenador no podía hacer nada con él, y los OCHO centros con facturación
 * tenían los tres campos vacíos.
 *
 * ── POR QUÉ NO SE REUTILIZA EL ADJUNTO DE GASTOS ────────────────────────────
 * Era el camino que parecía obvio y es el malo. Devuelve una ruta NUESTRA, y
 * `cargarLogo` exige `https://` y sale a la red de verdad: con una ruta interna
 * habría devuelto null y la factura habría salido SIN SELLO, en silencio, sin
 * error en pantalla ni en el log. Se habría hecho un botón que no arregla nada
 * y encima parece que funciona. Además ese adjunto acepta cualquier tipo de
 * fichero y mete una fila en `documents`, que es el archivo de PACIENTES: un
 * sello no es de ningún paciente.
 *
 * Esto es el gemelo de `lib/mailing/imagenStorage.js`, que ya resolvió el mismo
 * problema para las imágenes de los correos: una imagen del CENTRO, sin dueño y
 * sin fila en base de datos —el fichero ES el registro—, con el tipo decidido
 * por los MAGIC BYTES y no por lo que diga el navegador.
 *
 * Layout: `{UPLOADS_ROOT}/marca/{slug}/{uuid}.{ext}`.
 * Lo que se guarda en los ajustes es la REFERENCIA `/marca/{slug}/{uuid}.png`.
 *
 * ── SOLO PNG Y JPEG, y no es una manía ──────────────────────────────────────
 * pdfkit no entiende nada más: con un SVG o un WebP lanza «Unknown image
 * format» y tumbaría la generación del PDF. El mailing sí acepta gif y webp
 * porque eso lo pinta un navegador; aquí lo pinta pdfkit.
 */

export const MAX_MARCA_BYTES = 2 * 1024 * 1024;

/** Lo que pdfkit sabe dibujar, y nada más. */
export const TIPOS_MARCA = Object.freeze({ "image/png": "png", "image/jpeg": "jpg" });

/** Los tres sitios donde puede ir una imagen de marca, y su columna. */
export const CAMPOS_MARCA = Object.freeze({
  logo: "logoUrl",
  sello: "stampUrl",
  logoPresupuesto: "quoteLogoUrl",
});

const REF_RE =
  /^\/marca\/([a-z0-9_]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg))$/;

/** ¿Es una referencia a una imagen de marca guardada por nosotros? */
export function esRefDeMarca(valor) {
  return REF_RE.test(String(valor ?? "").trim());
}

/** El centro al que pertenece esa referencia, o null. */
export function slugDeRef(valor) {
  const m = REF_RE.exec(String(valor ?? "").trim());
  return m ? m[1] : null;
}

/**
 * ¿Puede ESTE centro guardar ese valor en un campo de marca?
 *
 * El cerrojo va aquí, en la ESCRITURA, y no al leer: así el PDF puede fiarse
 * de lo que hay en la fila sin volver a preguntar, y no hay que acordarse de
 * pasarle el centro a las siete llamadas de `cargarLogo` repartidas por seis
 * endpoints. Un valor que no sea una referencia nuestra (una URL https, o
 * vacío para quitarlo) pasa tal cual, que es lo de siempre.
 */
export function refValidaPara(slug, valor) {
  const v = String(valor ?? "").trim();
  if (!v) return true;
  if (!v.startsWith("/marca/")) return true; // una URL de fuera: no es asunto nuestro
  return esRefDeMarca(v) && slugDeRef(v) === slug;
}

function carpetaDe(slug) {
  if (!/^[a-z0-9_]+$/.test(String(slug ?? ""))) throw new Error("slug inválido");
  return path.resolve(getUploadsRoot(), "marca", slug);
}

/** Guarda la imagen y devuelve `{ ref, mime, bytes }`, o `{ error }`. */
export async function guardarImagenDeMarca(slug, buffer) {
  if (!buffer?.length) return { error: "El fichero está vacío" };
  if (buffer.length > MAX_MARCA_BYTES) {
    return { error: `La imagen no puede pasar de ${Math.round(MAX_MARCA_BYTES / 1024 / 1024)} MB` };
  }
  const mime = mimePorMagia(buffer);
  const ext = TIPOS_MARCA[mime];
  if (!ext) {
    // El mensaje dice el porqué: quien sube un SVG tiene que saber que no es
    // un capricho, es que el PDF no lo sabe dibujar.
    return { error: "El logo y el sello tienen que ser PNG o JPG: son los únicos formatos que sabe dibujar el PDF" };
  }
  const nombre = `${randomUUID()}.${ext}`;
  const carpeta = carpetaDe(slug);
  await fs.mkdir(carpeta, { recursive: true });
  await fs.writeFile(path.join(carpeta, nombre), buffer);
  return { ref: `/marca/${slug}/${nombre}`, mime, bytes: buffer.length };
}

/**
 * Los BYTES de una imagen de marca, para dibujarla en un PDF. Nunca sale a la
 * red y NUNCA lanza: si falta, si no se puede leer o si es otra cosa, devuelve
 * null y el documento se dibuja sin ella. Una factura no puede dejar de
 * generarse porque falte un sello.
 */
export function leerImagenDeMarca(ref) {
  if (!esRefDeMarca(ref)) return null;
  try {
    // `resolve` y no `join`: la raíz puede venir sin letra de unidad
    // («/app/uploads» en Windows), y entonces comparar una ruta ya resuelta
    // contra una sin resolver da siempre falso y la imagen «no está». Se veía
    // en local y no en el servidor, que es la peor forma de tener un fallo.
    const raiz = path.resolve(getUploadsRoot(), "marca");
    const destino = path.resolve(raiz, "." + String(ref).trim().replace("/marca", ""));
    // Segundo cerrojo, por si el primero se queda corto algún día: el fichero
    // resuelto TIENE que caer dentro de marca/.
    if (destino === raiz || !destino.startsWith(raiz + path.sep)) return null;
    const buf = readFileSync(destino);
    // Se vuelve a mirar por los bytes: lo que se dibuja tiene que ser lo que
    // pdfkit entiende, aunque el nombre del fichero diga otra cosa.
    return TIPOS_MARCA[mimePorMagia(buf)] ? buf : null;
  } catch {
    return null;
  }
}

/** Borra la imagen a la que apunta esa referencia. Silencioso: nunca lanza. */
export async function borrarImagenDeMarca(ref) {
  if (!esRefDeMarca(ref)) return false;
  try {
    const raiz = path.resolve(getUploadsRoot(), "marca");
    const destino = path.resolve(raiz, "." + String(ref).trim().replace("/marca", ""));
    if (!destino.startsWith(raiz + path.sep)) return false;
    await fs.unlink(destino);
    return true;
  } catch {
    return false;
  }
}
