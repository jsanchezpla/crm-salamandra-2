/**
 * prepFiles — adjuntos de la PREPARACIÓN de una sesión clínica
 * (sprint Aumenta 2026-07, punto 4: registro de sesión en 3 partes).
 *
 * (Fichero nuevo en /lib, regla #2: son material de trabajo del terapeuta —una
 * foto de la ficha de un ejercicio, una nota de voz antes de entrar—, no
 * documentos del archivo del CRM. Se reutilizan las primitivas de disco de
 * `documentStorage`, para no tener un cuarto almacén con su propia política
 * de tamaños y rutas.)
 *
 * La metadata vive en `clinic_sessions.prep_files` (JSONB):
 *   [{ id, name, storagePath, mimeType, size, uploadedAt, uploadedBy }]
 *
 * ── Y DESDE EL 02/09/2026, TAMBIÉN EN `documents` (AV-0027 de Aumenta) ──────
 * «Que todos los documentos que vayamos subiendo respecto a las sesiones
 * también salgan en el apartado de Documentos, para una búsqueda más rápida.»
 * Hasta ese día aquí ponía, a propósito, que NO se creaban filas en
 * `documents` para que no aparecieran en el buscador ni se acercaran al portal
 * de la familia. Lo primero es justo lo que pide el centro; lo segundo se
 * conserva: la fila entra como `sesion_preparacion`, compartida con el equipo
 * y con `clientVisible = false` SIEMPRE (el portal solo enseña lo visible), y
 * se borra solo desde la sesión —el archivo y la ficha del paciente la
 * enseñan pero no la quitan, porque el fichero es el mismo—. La fila la crea
 * el POST de prep-files (`documentoDePrepFile`) y la quita el DELETE; lo
 * anterior a esa fecha lo dio de alta `scripts/backfill-documents-preparacion.js`.
 */

import { randomUUID } from "node:crypto";
import { extFromFileName } from "../documents/documentStorage.js";

// Fotos, audio y PDF: lo que una terapeuta trae de una sesión. Nada ejecutable.
const EXT_PERMITIDAS = new Set([
  "jpg", "jpeg", "png", "webp", "heic", "gif",
  "m4a", "mp3", "wav", "ogg", "webm", "mp4", "aac", "amr",
  "pdf",
]);

export const MAX_PREP_FILES = 10;

/** El `source` con el que un adjunto de preparación entra en `documents` (02/09/2026). */
export const SOURCE_PREPARACION = "sesion_preparacion";

/** ¿Este documento del archivo es un adjunto de preparación? Entonces se quita desde su sesión. */
export function esAdjuntoDePreparacion(doc) {
  return doc?.source === SOURCE_PREPARACION;
}

/** El día de la sesión como `YYYY-MM-DD` (hora de Madrid), o null si no lo hay. */
function diaDeSesion(valor) {
  if (!valor) return null;
  if (typeof valor === "string") {
    const m = valor.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * La fila de `documents` que corresponde a un adjunto de preparación: la misma
 * la crea el POST al subirlo y el backfill para lo que ya existía. Compartida
 * con el equipo, nunca visible para la familia, colgada del paciente, de la
 * familia y de la sesión. Sin `id`: lo pone la base.
 */
export function documentoDePrepFile({ sesion, adjunto, ownerUserId = null }) {
  return {
    folderId: null,
    visibility: "shared",
    ownerUserId: ownerUserId ?? null,
    documentDate: diaDeSesion(sesion?.sessionDate),
    fileName: String(adjunto?.name || "adjunto").slice(0, 255),
    storagePath: adjunto?.storagePath,
    fileSize: Number(adjunto?.size) || 0,
    mimeType: adjunto?.mimeType || "application/octet-stream",
    clientId: sesion?.clientId ?? null,
    patientId: sesion?.patientId ?? null,
    clinicSessionId: sesion?.id ?? null,
    source: SOURCE_PREPARACION,
    clientVisible: false,
    uploadedByClient: false,
  };
}

/** ¿Se puede guardar este fichero? Devuelve la extensión o null. */
export function extPermitida(fileName, mimeType) {
  const ext = extFromFileName(fileName);
  if (EXT_PERMITIDAS.has(ext)) return ext;
  // Algunos móviles mandan el nombre sin extensión; se acepta por el tipo.
  const m = String(mimeType || "");
  if (m.startsWith("image/")) return "jpg";
  if (m.startsWith("audio/")) return "m4a";
  if (m === "application/pdf") return "pdf";
  return null;
}

export function nuevoPrepFile({ name, storagePath, mimeType, size, uploadedBy }) {
  return {
    id: randomUUID(),
    name: String(name || "archivo").slice(0, 255),
    storagePath,
    mimeType: mimeType || "application/octet-stream",
    size: Number(size) || 0,
    uploadedAt: new Date().toISOString(),
    uploadedBy: uploadedBy ?? null,
  };
}

/** Lista normalizada (el JSONB puede traer cualquier cosa de versiones viejas). */
export function listaPrepFiles(session) {
  const arr = Array.isArray(session?.prepFiles) ? session.prepFiles : [];
  return arr.filter((f) => f && typeof f === "object" && f.storagePath);
}

export function buscarPrepFile(session, fileId) {
  return listaPrepFiles(session).find((f) => String(f.id) === String(fileId)) ?? null;
}
