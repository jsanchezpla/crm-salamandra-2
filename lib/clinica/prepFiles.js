/**
 * prepFiles — adjuntos de la PREPARACIÓN de una sesión clínica
 * (sprint Aumenta 2026-07, punto 4: registro de sesión en 3 partes).
 *
 * (Fichero nuevo en /lib, regla #2: son material de trabajo del terapeuta —una
 * foto de la ficha de un ejercicio, una nota de voz antes de entrar—, no
 * documentos del archivo del CRM. Por eso NO se crean filas en `documents`: no
 * deben aparecer en el buscador ni acercarse al portal de la familia. Lo que sí
 * se reutiliza son las primitivas de disco de `documentStorage`, para no tener
 * un cuarto almacén con su propia política de tamaños y rutas.)
 *
 * La metadata vive en `clinic_sessions.prep_files` (JSONB):
 *   [{ id, name, storagePath, mimeType, size, uploadedAt, uploadedBy }]
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
