/**
 * Adjuntar al correo de Captación ficheros que ya están en Documentos.
 *
 * Pedido por Rodrigo el 04/09/2026: el dossier sanitario es el mismo para todos
 * los centros, así que se sube UNA vez al archivo y se marca al enviar, en vez
 * de arrastrarlo desde el escritorio en cada correo.
 *
 * De Documentos y no de una biblioteca nueva a propósito: ya es el sitio donde
 * viven los ficheros del centro, con su cuota, sus carpetas, sus permisos y su
 * papelera. Una segunda estantería para lo mismo obliga a acordarse de subir la
 * versión nueva en dos sitios, que es justo como se acaba mandando el dossier
 * viejo.
 *
 * ── QUIÉN PUEDE ADJUNTAR QUÉ ────────────────────────────────────────────────
 * La visibilidad de Documentos MANDA, y se comprueba aquí con las mismas piezas
 * que usa la descarga (`canViewDocument` + las carpetas compartidas conmigo):
 * un privado de otro no se puede adjuntar aunque llegue su id en el body. Sin
 * esta comprobación, el envío de correo sería una puerta trasera para leer el
 * archivo entero del tenant documento a documento.
 */

import { canViewDocument } from "../documents/helpers.js";
import { carpetasCompartidasCon } from "../documents/carpetasCompartidas.js";
import { readDocumentStream } from "../documents/documentStorage.js";
import { MAX_ADJUNTOS, MAX_ADJUNTO_BYTES, MAX_ADJUNTOS_BYTES } from "../correo/composicion.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lee un stream entero a Buffer. Los adjuntos van en el cuerpo del correo. */
async function aBuffer(stream) {
  const trozos = [];
  for await (const t of stream) trozos.push(t);
  return Buffer.concat(trozos);
}

const mb = (bytes) => Math.round(bytes / 1024 / 1024);

/**
 * Convierte una lista de ids de Documentos en adjuntos con el formato del SDK
 * de Resend (`filename` / `content` / `contentType`).
 *
 * Devuelve `{ adjuntos }` o `{ error }` con un mensaje que se le pueda enseñar
 * a una persona. Un adjunto que falla tumba el envío ENTERO antes de mandar
 * nada: mejor eso que un correo salido a medias sin el dossier que lo justifica.
 */
/**
 * `leerFichero` y `carpetasCompartidas` se inyectan para poder ejercitar la
 * regla completa en pruebas sin disco ni base, igual que `analyzeLead` inyecta
 * su proveedor de IA. Por defecto son los de verdad.
 */
export async function adjuntosDesdeDocumentos({
  tenantModels,
  tenantSlug,
  userId,
  documentIds,
  leerFichero = readDocumentStream,
  carpetasCompartidas = carpetasCompartidasCon,
}) {
  if (documentIds == null) return { adjuntos: [] };
  if (!Array.isArray(documentIds)) return { error: "«documentIds» tiene que ser una lista" };
  if (documentIds.length === 0) return { adjuntos: [] };
  if (documentIds.length > MAX_ADJUNTOS) {
    return { error: `Como mucho ${MAX_ADJUNTOS} archivos adjuntos por correo` };
  }
  for (const id of documentIds) {
    if (!UUID_RE.test(String(id ?? ""))) return { error: "Hay un archivo con identificador inválido" };
  }

  const { Document } = tenantModels;
  // Las carpetas compartidas conmigo se resuelven UNA vez, no por documento.
  const { todas } = await carpetasCompartidas({ tenantModels, userId });

  const adjuntos = [];
  let total = 0;

  for (const id of documentIds) {
    const doc = await Document.findByPk(id);
    if (!doc) return { error: "Uno de los archivos ya no existe en Documentos" };
    if (!canViewDocument(doc, userId, todas)) {
      // Sin decir si existe o no: el que no lo ve, no sabe que hay algo.
      return { error: "No tienes acceso a uno de los archivos seleccionados" };
    }

    const bytes = Number(doc.fileSize ?? 0);
    if (bytes > MAX_ADJUNTO_BYTES) {
      return { error: `«${doc.fileName}» pesa demasiado para ir por correo (máximo ${mb(MAX_ADJUNTO_BYTES)} MB por archivo)` };
    }
    total += bytes;
    if (total > MAX_ADJUNTOS_BYTES) {
      return { error: `Los archivos juntos pasan de ${mb(MAX_ADJUNTOS_BYTES)} MB. Quita alguno.` };
    }

    let contenido;
    try {
      const { stream } = await leerFichero(tenantSlug, doc.storagePath);
      contenido = await aBuffer(stream);
    } catch (e) {
      if (e.code === "ENOENT") {
        return { error: `«${doc.fileName}» está en la lista pero su archivo no aparece en el disco` };
      }
      throw e;
    }

    // `fileSize` es lo que se apuntó al subir; el tope de verdad lo pone lo
    // que se va a mandar, así que se vuelve a mirar con el fichero en la mano.
    if (contenido.length > MAX_ADJUNTO_BYTES) {
      return { error: `«${doc.fileName}» pesa demasiado para ir por correo (máximo ${mb(MAX_ADJUNTO_BYTES)} MB por archivo)` };
    }

    adjuntos.push({
      filename: doc.fileName,
      content: contenido.toString("base64"),
      contentType: doc.mimeType,
    });
  }

  return { adjuntos };
}
