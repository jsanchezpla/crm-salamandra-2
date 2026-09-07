"use client";

/**
 * VistaPreviaFacturaModal — ver la factura ANTES de emitirla (07/09/2026,
 * Rodrigo: «quiero que haya una vista previa de las facturas antes de emitirlas
 * con un botón»).
 *
 * No dibuja ninguna factura: pide al servidor el PDF de verdad y lo enseña en
 * un <iframe>, como la vista previa del archivo de Documentos
 * (`components/documents/PdfPreviewModal.jsx`; la auth va por la cookie
 * httpOnly del mismo origen, sin cabeceras a mano). Lo que se ve aquí es el
 * mismo `renderInvoice` que saldrá emitido, con «VISTA PREVIA» cruzando las
 * páginas mientras siga sin emitir.
 *
 * Sirve para los dos sitios donde se emite: el borrador de una factura suelta
 * (con su botón de Emitir aquí mismo) y cada fila de la Facturación del mes
 * (donde emitir es del lote entero, así que aquí solo se mira).
 *
 * Respeta la barra móvil (regla #13) y va en z-[60] porque se abre ENCIMA del
 * cajón de la factura y del de la facturación del mes, que están en z-50.
 *
 * Se porta al <body> (createPortal) porque los dos cajones desde los que se
 * abre entran con una animación, y una animación es un `transform`: dentro de
 * un transform lo `fixed` deja de ser fijo y el modal salía encajonado en la
 * mitad derecha de la pantalla, del ancho del cajón.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function VistaPreviaFacturaModal({
  url,
  titulo,
  subtitulo = null,
  onClose,
  onEmitir = null,
  emitirTexto = "Emitir",
  emitirDisabled = false,
  emitiendo = false,
  aviso = null,
}) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !emitiendo && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, emitiendo]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed top-14 lg:top-0 left-0 right-0 bottom-0 z-[60] bg-black/60 flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 text-white shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{titulo}</div>
          {subtitulo && <div className="text-[11px] text-white/60 truncate">{subtitulo}</div>}
        </div>
        <button
          onClick={onClose}
          disabled={emitiendo}
          aria-label="Cerrar"
          className="text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/15 disabled:opacity-40 shrink-0"
        >
          ×
        </button>
      </header>

      <div className="flex-1 min-h-0 px-2">
        <iframe src={url} title={titulo} className="w-full h-full rounded-lg bg-white border-0" />
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3 shrink-0">
        <p className="text-[11px] text-white/60 min-w-0">
          {aviso ?? "Todavía no está emitida: no tiene número y se puede cambiar."}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={emitiendo}
            className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide text-white/80 hover:bg-white/15 disabled:opacity-40 transition"
          >
            Cerrar
          </button>
          {onEmitir && (
            <button
              onClick={onEmitir}
              disabled={emitirDisabled || emitiendo}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {emitiendo ? "Emitiendo..." : emitirTexto}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
