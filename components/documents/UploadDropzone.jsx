"use client";

import { useRef, useState } from "react";

const ACCEPT = ".pdf,.docx,.xlsx";
const MAX_MB = 25;

/**
 * Zona de subida (drag & drop + click). Sube uno a uno a POST /api/documents con
 * el folderId actual (visibilidad heredada) o la visibilidad si estamos en la
 * raíz. Reporta errores por archivo. El backend valida tipo/tamaño/cuota/magic.
 */
export default function UploadDropzone({ folderId, visibility, onUploaded, disabled }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [errors, setErrors] = useState([]);

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0 || busy || disabled) return;
    setErrors([]);
    setBusy(true);
    const errs = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      if (folderId) fd.append("folderId", folderId);
      else fd.append("visibility", visibility);
      try {
        const r = await fetch("/api/documents", { method: "POST", body: fd });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          errs.push(`${file.name}: ${j.error || `error ${r.status}`}`);
        }
      } catch (e) {
        errs.push(`${file.name}: ${e.message}`);
      }
    }
    setErrors(errs);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    onUploaded?.();
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!disabled) uploadFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
          disabled
            ? "border-neutral-200 bg-neutral-50 opacity-60 cursor-not-allowed"
            : drag
            ? "border-[var(--color-primary,#1B3A2D)] bg-neutral-50"
            : "border-neutral-200 hover:border-neutral-300 bg-white"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={disabled || busy}
          onChange={(e) => uploadFiles(e.target.files)}
          className="hidden"
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-6 h-6 text-neutral-400">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
        <span className="text-sm text-neutral-600">
          {busy ? "Subiendo…" : "Arrastra archivos o haz clic para subir"}
        </span>
        <span className="text-[11px] text-neutral-400">PDF, DOCX o XLSX · máx {MAX_MB} MB</span>
      </label>
      {errors.length > 0 && (
        <ul className="mt-2 space-y-1">
          {errors.map((e, i) => (
            <li key={i} className="text-xs text-rose-600">
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
