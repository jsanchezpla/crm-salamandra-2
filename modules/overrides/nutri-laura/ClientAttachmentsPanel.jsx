"use client";

/**
 * ClientAttachmentsPanel — tab "Adjuntos" del detalle de paciente
 * (nutri_laura). PDFs subidos asociados al cliente.
 *
 * Funcionalidad:
 *   - GET    /api/clients/:id/attachments
 *   - POST   /api/clients/:id/attachments (multipart, campo "file")
 *   - DELETE /api/clients/:id/attachments/:attachmentId
 *   - Descarga directa por <a href="/api/.../download"> — el backend ya
 *     pone el Content-Disposition con el nombre original.
 *
 * Validaciones frontend (espejo del backend):
 *   - MIME `application/pdf` exclusivo.
 *   - Tamaño máximo 10 MB por archivo.
 *   - Máximo 50 adjuntos por cliente.
 *
 * Decisión Checkpoint 3:
 *   - Borrado sin restricción por uploader (backend tampoco enforza; Laura
 *     es la única usuaria). Apuntado al backlog para sprints futuros.
 *
 * Drop zone con drag-over visual, manejo de errores claro, y skeleton
 * cuando carga inicial.
 */

import { useCallback, useEffect, useState } from "react";
import TimestampRelative from "../../../components/ui/TimestampRelative.jsx";

const MAX_FILE_MB = 10;
const MAX_FILES = 50;
const ALLOWED_MIME = "application/pdf";

function fmtBytes(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClientAttachmentsPanel({ clientId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/clients/${clientId}/attachments`)
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) throw new Error(j?.error || "Error al cargar adjuntos");
        setItems(j.data?.attachments ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { reload(); }, [reload]);

  function validateFile(file) {
    if (!file) return "Selecciona un archivo.";
    if (file.type !== ALLOWED_MIME) {
      return `Solo se aceptan PDF (recibido: ${file.type || "tipo desconocido"}).`;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return `Archivo demasiado grande: ${(file.size / (1024 * 1024)).toFixed(1)} MB · máximo ${MAX_FILE_MB} MB.`;
    }
    if (items.length >= MAX_FILES) {
      return `Límite alcanzado: ${MAX_FILES} archivos por paciente.`;
    }
    return null;
  }

  async function handleFile(file) {
    setUploadError(null);
    const validationError = validateFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/clients/${clientId}/attachments`, {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) {
        setUploadError(j?.error || `Error al subir (HTTP ${r.status})`);
        return;
      }
      // Optimista: añadimos arriba sin refetch completo.
      setItems((prev) => [j.data, ...prev]);
    } catch (e) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(attachment) {
    setConfirmDelete(null);
    try {
      const r = await fetch(
        `/api/clients/${clientId}/attachments/${attachment.id}`,
        { method: "DELETE" }
      );
      if (r.ok || r.status === 204) {
        setItems((prev) => prev.filter((a) => a.id !== attachment.id));
      }
    } catch {
      reload();
    }
  }

  const limitReached = items.length >= MAX_FILES;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden max-w-3xl">
      {/* Cabecera */}
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-700">Adjuntos PDF</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {items.length}/{MAX_FILES} archivos · PDF, máximo {MAX_FILE_MB} MB
          </div>
        </div>
      </div>

      {/* Drop zone */}
      <div className="px-5 py-4 border-b border-gray-100">
        <label
          onDragOver={(e) => { e.preventDefault(); if (!limitReached) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (limitReached) return;
            handleFile(e.dataTransfer.files?.[0]);
          }}
          className={`flex items-center justify-center gap-3 px-4 py-6 border-2 border-dashed rounded-xl transition-colors ${
            limitReached
              ? "border-gray-200 bg-gray-50 cursor-not-allowed opacity-60"
              : dragOver
                ? "border-[var(--color-primary)] bg-[var(--color-accent,#F7F1EB)]/40 cursor-pointer"
                : "border-gray-200 hover:border-gray-300 bg-gray-50/50 cursor-pointer"
          }`}
        >
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0])}
            disabled={uploading || limitReached}
          />
          {uploading ? (
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
              Subiendo…
            </div>
          ) : limitReached ? (
            <div className="text-center text-xs text-gray-500">
              Has alcanzado el límite de {MAX_FILES} archivos.
              <br />Borra alguno para subir más.
            </div>
          ) : (
            <div className="text-center">
              <div className="text-sm text-gray-600">Arrastra un PDF o haz clic para subir</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Máximo {MAX_FILE_MB} MB</div>
            </div>
          )}
        </label>
        {uploadError && (
          <div className="mt-2 px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">
            {uploadError}
          </div>
        )}
      </div>

      {/* Lista / estados */}
      <div className="px-5 py-2">
        {error && (
          <div className="my-3 px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={reload}
              className="text-[11px] font-semibold underline hover:no-underline"
            >
              Reintentar
            </button>
          </div>
        )}

        {loading ? (
          <ul className="divide-y divide-gray-50">
            {[0, 1, 2].map((i) => (
              <li key={i} className="py-3 flex items-center gap-3 animate-pulse">
                <div className="w-9 h-9 rounded-md bg-gray-100 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-2/3 bg-gray-100 rounded" />
                  <div className="h-3 w-1/3 bg-gray-100 rounded" />
                </div>
              </li>
            ))}
          </ul>
        ) : items.length === 0 && !error ? (
          <div className="py-10 text-center text-xs text-gray-400">
            Aún no hay documentos. Sube el primero usando la zona de arriba.
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {items.map((a) => (
              <li key={a.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-md bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                      <path d="M6 2h7l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V8h4.5L13 3.5z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">
                      {a.originalName}
                    </div>
                    <div className="text-[11px] text-gray-400 flex items-center gap-1 flex-wrap">
                      <span>{fmtBytes(a.fileSize)}</span>
                      <span>·</span>
                      <TimestampRelative date={a.createdAt} />
                      {a.uploadedBy && (
                        <>
                          <span>·</span>
                          <span className="truncate">{a.uploadedBy}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/api/clients/${clientId}/attachments/${a.id}/download`}
                    className="text-[11px] font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    Descargar
                  </a>
                  {confirmDelete === a.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(a)}
                        className="text-[11px] font-semibold text-red-600 hover:underline"
                      >
                        Confirmar
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-[11px] text-gray-400 hover:text-gray-600"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(a.id)}
                      className="text-[11px] text-gray-400 hover:text-red-600"
                    >
                      Borrar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
