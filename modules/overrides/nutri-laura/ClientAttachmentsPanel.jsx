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

import { useCallback, useEffect, useRef, useState } from "react";
import TimestampRelative from "../../../components/ui/TimestampRelative.jsx";

const MAX_FILE_MB = 25;
const MAX_FILES = 50;
// Archivo central (2026-07-23): se acepta cualquier tipo de fichero.

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
  // Modal de NOMBRE obligatorio al subir. `pending` = File a la espera de nombre.
  const [pending, setPending] = useState(null);
  const [pendingName, setPendingName] = useState("");
  // ¿Lo verá la paciente en su portal (Mi perfil → Mis documentos)? Por
  // defecto NO: compartir es una decisión consciente, no el camino por descuido.
  const [pendingVisible, setPendingVisible] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const fileInputRef = useRef(null);
  const resetInput = () => { if (fileInputRef.current) fileInputRef.current.value = ""; };

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
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return `Archivo demasiado grande: ${(file.size / (1024 * 1024)).toFixed(1)} MB · máximo ${MAX_FILE_MB} MB.`;
    }
    if (items.length >= MAX_FILES) {
      return `Límite alcanzado: ${MAX_FILES} archivos por paciente.`;
    }
    return null;
  }

  // Elegir fichero → NO sube todavía: abre el modal para pedir el nombre.
  function handleFile(file) {
    setUploadError(null);
    const validationError = validateFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    setPending(file);
    setPendingName(file.name.replace(/\.[^.]+$/, "")); // nombre por defecto sin extensión
    setPendingVisible(false); // cada subida decide de nuevo
  }

  /** Cambia si la paciente ve (o deja de ver) un documento ya subido. */
  async function toggleVisible(att) {
    setTogglingId(att.id);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/attachments/${att.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibleToClient: !att.clientVisible }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) throw new Error(j?.error || "No se pudo cambiar la visibilidad");
      setItems((prev) =>
        prev.map((x) => (x.id === att.id ? { ...x, clientVisible: j.data.clientVisible } : x))
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmUpload() {
    if (!pending) return;
    const name = pendingName.trim();
    if (!name) { setUploadError("El nombre del documento es obligatorio"); return; }
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", pending);
      fd.append("name", name);
      fd.append("visibleToClient", pendingVisible ? "true" : "false");
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
      setPending(null);
      setPendingName("");
      setPendingVisible(false); // la siguiente subida vuelve a decidir
      resetInput();
    } catch (e) {
      setUploadError(e.message);
      resetInput(); // permite re-elegir el MISMO fichero tras un error
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
    <div className="space-y-4 max-w-3xl">
    <FirmasPendientes clientId={clientId} />

    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Cabecera */}
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-700">Documentos</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {items.length}/{MAX_FILES} archivos · cualquier tipo, máximo {MAX_FILE_MB} MB
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
            ref={fileInputRef}
            type="file"
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
              <div className="text-sm text-gray-600">Arrastra un archivo o haz clic para subir</div>
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
                      {a.uploadedByClient && (
                        <span className="ml-1 px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-medium">
                          Lo subió la paciente
                        </span>
                      )}
                    </div>
                    {/* Visibilidad para la paciente. Lo que sube ella lo ve
                        siempre (es suyo), así que ahí no hay interruptor. */}
                    <div className="mt-1">
                      {a.uploadedByClient ? (
                        <span className="text-[11px] text-gray-400">Lo ve en su perfil</span>
                      ) : (
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!a.clientVisible}
                            disabled={togglingId === a.id}
                            onChange={() => toggleVisible(a)}
                            className="rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)] w-3.5 h-3.5"
                          />
                          {a.clientVisible ? (
                            <span className="text-emerald-700 font-medium">La paciente lo ve</span>
                          ) : (
                            <span>Solo para ti</span>
                          )}
                        </label>
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

      {/* Modal de NOMBRE obligatorio al subir */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5">
            <div className="text-sm font-semibold text-gray-800 mb-1">Nombre del documento</div>
            <div className="text-xs text-gray-500 mb-3 truncate">Archivo: {pending.name}</div>
            <input
              autoFocus
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmUpload(); }}
              placeholder="Ej. Contrato firmado, Analítica…"
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            />
            {/* ¿Se comparte con la paciente? Va aquí, en el mismo gesto de
                subir, para que sea una decisión consciente y no un ajuste que
                haya que recordar después. Desmarcado por defecto. */}
            <label className="mt-3 flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2.5 cursor-pointer select-none hover:bg-gray-50">
              <input
                type="checkbox"
                checked={pendingVisible}
                onChange={(e) => setPendingVisible(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)] w-4 h-4"
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-gray-700">
                  Que la paciente lo vea
                </span>
                <span className="block text-[11px] text-gray-500 leading-snug mt-0.5">
                  {pendingVisible
                    ? "Aparecerá en su perfil de la web, en «Mis documentos»."
                    : "Si lo dejas sin marcar, el documento es solo para ti."}
                </span>
              </span>
            </label>

            {uploadError && <div className="text-xs text-red-600 mt-2">{uploadError}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setPending(null); setPendingName(""); setPendingVisible(false); setUploadError(null); resetInput(); }}
                disabled={uploading}
                className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-200 text-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={confirmUpload}
                disabled={uploading}
                className="text-xs font-medium px-3 py-1.5 rounded-md text-white disabled:opacity-50"
                style={{ background: "var(--color-primary, #1B3A2D)" }}
              >
                {uploading ? "Subiendo…" : "Subir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

/**
 * FirmasPendientes — qué documentos ha firmado esta paciente y cuáles no
 * (06/08/2026, Rodrigo).
 *
 * La ficha decía «1 de 2 firmas» y poco más: con el contrato, sus tres anexos
 * y el consentimiento parental, ese recuento no dice a quién hay que
 * perseguir ni por qué papel. Aquí va documento a documento, con quién falta
 * por cada uno.
 *
 * Vive en la pestaña de Documentos porque es donde se viene a mirar el
 * papeleo. No se pinta nada si el centro no usa contrato: sin documentos que
 * firmar, una sección vacía solo estorba.
 */
function FirmasPendientes({ clientId }) {
  const [estado, setEstado] = useState(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/clients/${clientId}/contract`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setEstado(j?.data ?? null); })
      .catch(() => {});   // es informativo: si falla, la pestaña sigue sirviendo
    return () => { vivo = false; };
  }, [clientId]);

  const docs = estado?.documentos ?? [];
  if (docs.length === 0) return null;

  const completos = docs.filter((d) => d.completo).length;
  const todoFirmado = completos === docs.length;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-700">Firmas</div>
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
            todoFirmado
              ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
              : "bg-amber-50 text-amber-800 border border-amber-100"
          }`}
        >
          {todoFirmado ? "Todo firmado" : `${completos} de ${docs.length}`}
        </span>
      </div>

      <ul className="divide-y divide-gray-50">
        {docs.map((d) => (
          <li key={d.key} className="px-5 py-2.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] text-gray-800">{d.titulo}</div>
              {d.completo ? (
                <div className="text-[11px] text-gray-400 mt-0.5">
                  Firmado{d.firmadoPor.length ? ` por ${d.firmadoPor.join(" y ")}` : ""}
                  {d.firmadoEl ? ` · ${fmtFecha(d.firmadoEl)}` : ""}
                </div>
              ) : (
                <div className="text-[11px] text-amber-700 mt-0.5">
                  Falta la firma de {d.faltaPor.join(" y ") || "la paciente"}
                </div>
              )}
            </div>
            <span
              className={`shrink-0 mt-0.5 text-[11px] font-medium ${
                d.completo ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              {d.completo ? "✓" : "Pendiente"}
            </span>
          </li>
        ))}
      </ul>

      {estado?.viaPapel && (
        <div className="px-5 py-2 border-t border-gray-50 text-[11px] text-gray-500">
          Hay un contrato firmado en papel subido a la ficha: cuenta como firmado.
        </div>
      )}
    </div>
  );
}

function fmtFecha(iso) {
  try {
    return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return ""; }
}
