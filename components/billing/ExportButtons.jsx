"use client";

import { useState, useRef, useEffect } from "react";

/**
 * Botones de export para los paneles de Facturación:
 *   - "Exportar Excel": enlace de descarga al endpoint XLSX (respeta los filtros
 *     que le pasa el panel en `xlsxUrl`).
 *   - "Descargar facturas": popover con rango de fechas → POST bulk-pdf → ZIP de
 *     PDFs de las facturas emitidas del rango. Se puede ocultar con showBulk=false.
 *
 * Props:
 *   xlsxUrl: string  — URL del endpoint XLSX ya con la query de filtros del panel.
 *   showBulk: bool   — mostrar el botón de descarga masiva de PDFs (default true).
 */
export default function ExportButtons({ xlsxUrl, showBulk = true }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function downloadBulk() {
    if (!from || !to) { setErr("Indica un rango de fechas"); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/billing/invoices/bulk-pdf?from=${from}&to=${to}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || "No se han podido generar los PDFs");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `facturas-${from}-${to}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e) {
      setErr(e?.message || "Error de red");
    } finally {
      setBusy(false);
    }
  }

  const btnCls =
    "inline-flex items-center gap-2 text-[13px] font-medium px-3 py-2 rounded-lg border border-[var(--ink-200,#e5e7eb)] bg-white text-[var(--ink-700,#374151)] hover:bg-neutral-50 transition-colors";

  return (
    <div className="flex items-center gap-2" ref={rootRef}>
      <a href={xlsxUrl} className={btnCls}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5" />
        </svg>
        Exportar Excel
      </a>

      {showBulk && (
        <div className="relative">
          <button type="button" onClick={() => setOpen((o) => !o)} className={btnCls}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14v4.75A2.25 2.25 0 0116.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10M14 3h7m0 0v7m0-7L10 14" />
            </svg>
            Descargar facturas
          </button>

          {open && (
            <div className="absolute right-0 mt-1 z-50 w-64 rounded-xl border border-neutral-200 bg-white shadow-xl p-3">
              <p className="text-[11px] text-neutral-500 mb-2">
                ZIP con los PDF de las facturas <strong>emitidas</strong> en el rango de fechas de emisión.
              </p>
              <label className="block text-[11px] font-medium text-neutral-500 mb-1">Desde</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="w-full mb-2 rounded-md px-2.5 py-1.5 text-sm border border-neutral-200 focus:outline-none focus:border-neutral-400" />
              <label className="block text-[11px] font-medium text-neutral-500 mb-1">Hasta</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="w-full mb-3 rounded-md px-2.5 py-1.5 text-sm border border-neutral-200 focus:outline-none focus:border-neutral-400" />
              {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
              <button type="button" onClick={downloadBulk} disabled={busy || !from || !to}
                className="w-full px-3 py-1.5 rounded-md text-sm font-medium text-white bg-[var(--color-primary,#1B3A2D)] hover:opacity-90 disabled:opacity-50 transition">
                {busy ? "Generando…" : "Descargar ZIP"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
