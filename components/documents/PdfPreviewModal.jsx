"use client";

import { useEffect } from "react";

/**
 * Vista previa de PDF en un modal a pantalla (respeta la barra superior móvil,
 * regla #13: top-14 lg:top-0). Carga el endpoint /preview en un <iframe>; la
 * auth va por la cookie httpOnly (mismo origen), sin cabeceras manuales.
 */
export default function PdfPreviewModal({ doc, onClose }) {
  useEffect(() => {
    if (!doc) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [doc, onClose]);

  if (!doc) return null;

  return (
    <div className="fixed top-14 lg:top-0 right-0 bottom-0 left-0 z-50 bg-black/60 flex flex-col" onClick={onClose}>
      <header
        className="flex items-center justify-between gap-3 px-4 py-2.5 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-medium truncate">{doc.fileName}</span>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={`/api/documents/${doc.id}/download`}
            className="text-xs px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
          >
            Descargar
          </a>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/15"
          >
            ×
          </button>
        </div>
      </header>
      <div className="flex-1 px-2 pb-2 min-h-0" onClick={(e) => e.stopPropagation()}>
        <iframe
          src={`/api/documents/${doc.id}/preview`}
          title={doc.fileName}
          className="w-full h-full rounded-lg bg-white border-0"
        />
      </div>
    </div>
  );
}
