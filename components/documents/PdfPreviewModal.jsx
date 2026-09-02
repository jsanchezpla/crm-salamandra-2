"use client";

import { useEffect } from "react";

import { esImagenEnPantalla } from "@/lib/documents/verEnPantalla.js";

/**
 * Vista previa de un documento en un modal a pantalla (respeta la barra
 * superior móvil, regla #13: top-14 lg:top-0). Carga el endpoint de vista en
 * un <iframe> (PDF) o en un <img> (imagen); la auth va por la cookie httpOnly
 * (mismo origen), sin cabeceras manuales.
 *
 * Desde el 02/09/2026 (AV-0025 de Aumenta: «que los archivos no tengan que
 * descargarse para abrirlos») ya no es solo de PDF ni solo del archivo de
 * Documentos: `urls` permite montarlo desde otra lista (los adjuntos de la
 * ficha del paciente) con sus propios endpoints. Sin `urls` usa los del archivo.
 * Qué se puede ver y qué no lo decide `lib/documents/verEnPantalla.js`.
 */
export default function PdfPreviewModal({ doc, onClose, urls = null }) {
  useEffect(() => {
    if (!doc) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [doc, onClose]);

  if (!doc) return null;

  const verUrl = urls?.ver ?? `/api/documents/${doc.id}/preview`;
  const descargarUrl = urls?.descargar ?? `/api/documents/${doc.id}/download`;
  const esImagen = esImagenEnPantalla(doc.fileName);

  return (
    <div className="fixed top-14 lg:top-0 right-0 bottom-0 left-0 z-50 bg-black/60 flex flex-col" onClick={onClose}>
      <header
        className="flex items-center justify-between gap-3 px-4 py-2.5 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-medium truncate">{doc.fileName}</span>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={descargarUrl}
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
        {esImagen ? (
          <div className="w-full h-full rounded-lg bg-neutral-900 flex items-center justify-center overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={verUrl} alt={doc.fileName} className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <iframe src={verUrl} title={doc.fileName} className="w-full h-full rounded-lg bg-white border-0" />
        )}
      </div>
    </div>
  );
}
