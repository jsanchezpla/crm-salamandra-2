"use client";

/**
 * ContratoServiciosCard — el Contrato de Prestación de Servicios del centro
 * (01/08/2026).
 *
 * Es UNO por cliente y vale para todas las familias: se sube aquí y es el
 * documento que firman en su área privada. Sin él, el portal no le pide la
 * firma a nadie — por diseño, para no pedir que firmen un papel inexistente.
 *
 * Vive en Documentos, no en Configuración: es un documento del centro, y quien
 * solo tenga **Documentos básico** (nutri_laura) verá exactamente esto y nada
 * más. El archivo completo exige `documents_avanzado`.
 */

import { useCallback, useEffect, useState } from "react";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

function fmtPeso(bytes) {
  if (!bytes && bytes !== 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fmtFecha(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

export default function ContratoServiciosCard({ isAdmin = true }) {
  const [contrato, setContrato] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    let vivo = true;
    fetch("/api/documents/contrato-servicios", { cache: "no-store" })
      .then(async (r) => ({ r, j: await r.json().catch(() => ({})) }))
      .then(({ r, j }) => {
        if (!vivo || r.status === 403) return;
        if (!j.ok) throw new Error(j.error || "No se pudo cargar el contrato");
        setContrato(j.data.contrato ?? null);
        setError(null);
      })
      .catch((e) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, []);

  useEffect(() => cargar(), [cargar]);

  async function subir(file) {
    if (!file || subiendo) return;
    setSubiendo(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", "Contrato de Prestación de Servicios");
      const r = await fetch("/api/documents/contrato-servicios", { method: "POST", body: fd });
      const j = await leerRespuestaApi(r, { siGrande: "El archivo pesa demasiado. El tope son 25 MB por documento." });
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo subir el contrato");
      setContrato(j.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubiendo(false);
    }
  }

  if (cargando) return null;

  return (
    <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-neutral-800">Contrato de Prestación de Servicios</span>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-xl">
            El documento que firman las familias al entrar en su área privada. Se sube una vez y
            vale para todas.
          </p>
        </div>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${contrato ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
        >
          {contrato ? "Subido" : "Sin subir"}
        </span>
      </div>

      <div className="px-5 py-4 space-y-3">
        {contrato ? (
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <a
                href="/api/documents/contrato-servicios/download"
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-[var(--color-primary,#1B3A2D)] hover:underline [overflow-wrap:anywhere]"
              >
                {contrato.name}
              </a>
              <div className="text-xs text-neutral-500 mt-0.5">
                {fmtPeso(contrato.fileSize)}
                {contrato.createdAt && ` · subido el ${fmtFecha(contrato.createdAt)}`}
              </div>
            </div>
            {isAdmin && (
              <label
                className={`text-xs text-[var(--color-primary,#1B3A2D)] hover:underline cursor-pointer shrink-0 ${subiendo ? "opacity-40 pointer-events-none" : ""}`}
              >
                {subiendo ? "Subiendo…" : "Reemplazar"}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; subir(f); }}
                />
              </label>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-neutral-400 italic">
              Todavía no has subido el contrato del centro.
            </span>
            {isAdmin && (
              <label
                className={`text-sm font-medium text-[var(--color-primary,#1B3A2D)] hover:underline cursor-pointer ${subiendo ? "opacity-40 pointer-events-none" : ""}`}
              >
                {subiendo ? "Subiendo…" : "+ Subir contrato (PDF)"}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; subir(f); }}
                />
              </label>
            )}
          </div>
        )}

        {error && <div className="text-xs text-rose-600">{error}</div>}

        <p className="text-[10px] text-neutral-400">
          Mientras no haya contrato subido, a las familias no se les pide firmar nada al entrar en
          su área privada.
        </p>
      </div>
    </section>
  );
}
