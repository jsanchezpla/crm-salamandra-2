/**
 * buzonStorage — las capturas que nos adjuntan en un aviso.
 *
 * (Fichero nuevo en /lib, regla #2.) Clona el enfoque de
 * `lib/support/ticketStorage.js`, que a su vez importa los helpers genéricos de
 * `lib/documents/documentStorage.js` — ese no se toca.
 *
 * Layout en disco (ruta RELATIVA a UPLOADS_ROOT, siempre con "/"):
 *   buzon/{tenantSlug}/{avisoUUID}/{adjuntoUUID}.{ext}
 *
 * ── LOS LÍMITES SON MÁS CORTOS QUE LOS DE TICKETS, Y NO POR CAPRICHO ────────
 * Allí son 5 × 10 MB = 50 MB. nginx corta el cuerpo de la petición en 30 MB, así
 * que pasarse no devuelve el JSON de `apiResponse` sino una página HTML de error
 * de nginx: en pantalla se ve como «no ha pasado nada», que es la peor forma de
 * fallar. Con 3 × 5 MB no se llega nunca. Para una captura de pantalla sobra.
 *
 * ── LA CARPETA SOBREVIVE A LA BAJA DEL CLIENTE ──────────────────────────────
 * `scripts/borrar-tenant.js` no toca `uploads/` en ningún momento, así que estas
 * capturas siguen ahí cuando el cliente ya no está — igual que su aviso, y por
 * el mismo motivo. Quien las caduca es `scripts/podar-buzon.js`.
 */

import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

import { getUploadsRoot, sanitizeFileName, extFromFileName } from "../documents/documentStorage.js";
import { LIMITES } from "./buzon.js";

/**
 * Los topes NO se escriben aquí: se traen de `buzon.js`.
 *
 * Estaban en los dos ficheros con el mismo número copiado, que es la forma
 * estándar de que un día dejen de coincidir — y el sitio donde peor se nota,
 * porque uno decide qué se puede elegir en pantalla y el otro qué se guarda de
 * verdad. Se unificaron el 13/08/2026 al subirlos de 5 a 10 MB.
 */
export const MAX_BYTES_POR_FICHERO = LIMITES.bytesPorAdjunto;
export const MAX_FICHEROS = LIMITES.adjuntos;

const SLUG_RE = /^[a-z0-9_]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// buzon/{slug}/{uuid}/{uuid}.{ext}
const RUTA_RE = /^buzon\/[a-z0-9_]+\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/i;

export { sanitizeFileName, extFromFileName };

function assertSlug(slug) {
  if (!SLUG_RE.test(String(slug || ""))) throw new Error(`Slug inválido: ${slug}`);
}

function absoluta(ruta) {
  if (!RUTA_RE.test(String(ruta || ""))) throw new Error("ruta de adjunto inválida");
  return path.join(getUploadsRoot(), ...ruta.split("/"));
}

/** Escribe el binario y devuelve la ruta relativa que se guarda en BD. */
export async function guardarFichero(slug, avisoId, adjuntoId, buffer, ext) {
  assertSlug(slug);
  if (!UUID_RE.test(avisoId) || !UUID_RE.test(adjuntoId)) {
    throw new Error("ids inválidos para adjunto");
  }
  const extSegura = /^[a-z0-9]{1,10}$/i.test(ext || "") ? ext.toLowerCase() : "bin";
  const rel = `buzon/${slug}/${avisoId}/${adjuntoId}.${extSegura}`;
  const abs = absoluta(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return rel;
}

/** Stream + tamaño real, para servir la descarga sin doblar la memoria. */
export async function abrirFichero(ruta) {
  const abs = absoluta(ruta);
  const stat = await fs.stat(abs);
  return { stream: createReadStream(abs), size: stat.size };
}

/** Best-effort: si ya no está, no pasa nada. */
export async function borrarFichero(ruta) {
  try {
    await fs.unlink(absoluta(ruta));
  } catch {
    /* ya no estaba */
  }
}

/** La carpeta entera de un aviso (al podarlo). */
export async function borrarCarpeta(slug, avisoId) {
  assertSlug(slug);
  if (!UUID_RE.test(avisoId)) return;
  try {
    await fs.rm(path.join(getUploadsRoot(), "buzon", slug, avisoId), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Lee los ficheros de un formulario multipart y los deja en disco.
 *
 * Devuelve las fichas que hay que insertar en `buzon_adjuntos`. Si algo falla a
 * medias, lo ya escrito se borra: es preferible perder la captura a dejar
 * ficheros sueltos que no apunta ninguna fila.
 */
export async function guardarAdjuntosDelFormulario({ form, slug, avisoId, subidoPor }) {
  const ficheros = form.getAll("adjuntos").filter((f) => f && typeof f.arrayBuffer === "function");
  if (!ficheros.length) return { fichas: [], error: null };
  if (ficheros.length > MAX_FICHEROS) {
    return { fichas: [], error: `Como mucho ${MAX_FICHEROS} ficheros.` };
  }

  const fichas = [];
  const escritas = [];
  try {
    for (const f of ficheros) {
      if (f.size > MAX_BYTES_POR_FICHERO) {
        // Se dice el tope Y lo que pesa la suya: si no, hay que ir probando.
        const tope = Math.round(MAX_BYTES_POR_FICHERO / (1024 * 1024));
        const pesa = (f.size / (1024 * 1024)).toFixed(1);
        throw new Error(`«${f.name}» pesa ${pesa} MB y el tope son ${tope} MB.`);
      }
      const adjuntoId = crypto.randomUUID();
      const buffer = Buffer.from(await f.arrayBuffer());
      const ruta = await guardarFichero(slug, avisoId, adjuntoId, buffer, extFromFileName(f.name));
      escritas.push(ruta);
      fichas.push({
        id: adjuntoId,
        avisoId,
        nombre: sanitizeFileName(f.name),
        ruta,
        bytes: f.size,
        mime: f.type || null,
        subidoPor,
      });
    }
    return { fichas, error: null };
  } catch (e) {
    await Promise.all(escritas.map(borrarFichero));
    return { fichas: [], error: e.message || "No se han podido guardar los adjuntos." };
  }
}
