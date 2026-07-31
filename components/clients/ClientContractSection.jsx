"use client";

/**
 * ClientContractSection — sección "Contrato" de la ficha de cliente
 * (sprint Aumenta 2026-07, punto 1.1).
 *
 * El contrato es de la FAMILIA, no del paciente: quien firma y quien paga son
 * los padres. Antes se subía en la ficha de cada paciente, y dos hermanos en el
 * centro significaban dos copias del mismo contrato.
 *
 * Se esconde sola si el tenant no tiene el archivo central de documentos
 * (`archivoDisponible: false`) o si el endpoint responde 403.
 *
 * Autocontenida: recibe `clientId` y habla con /api/clients/[id]/contract.
 */

import { useCallback, useEffect, useRef, useState } from "react";

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ClientContractSection({ clientId }) {
  const [estado, setEstado] = useState(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(() => {
    let alive = true;
    fetch(`/api/clients/${clientId}/contract`)
      .then(async (r) => ({ r, d: await r.json().catch(() => ({})) }))
      .then(({ r, d }) => {
        if (!alive) return;
        if (r.status === 403 || d?.data?.archivoDisponible === false) {
          setAvailable(false);
          return;
        }
        if (!d.ok) throw new Error(d.error || "No se pudo cargar el contrato");
        setEstado(d.data);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [clientId]);

  useEffect(() => load(), [load]);

  async function subir(file) {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/clients/${clientId}/contract`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo subir el contrato");
      setEstado(d.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function eliminar() {
    if (busy) return;
    if (!window.confirm("¿Eliminar el PDF del contrato de esta familia?")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/contract`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) throw new Error("No se pudo eliminar");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !available) return null;

  const contrato = estado?.contract ?? null;
  const firmantes = estado?.firmantes ?? 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6 max-w-5xl">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-semibold text-gray-700">Contrato</span>
        {contrato ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Subido</span>
        ) : (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Pendiente</span>
        )}
      </div>

      <div className="p-5 space-y-3">
        {contrato ? (
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <a
                href={`/api/clients/${clientId}/contract/download`}
                className="text-sm font-medium text-[var(--color-primary)] hover:underline [overflow-wrap:anywhere]"
              >
                {contrato.name}
              </a>
              <div className="text-xs text-gray-500 mt-0.5">
                {formatSize(contrato.fileSize)}
                {contrato.uploadedAt && ` · subido el ${formatDate(contrato.uploadedAt)}`}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs shrink-0">
              <label
                className={`text-[var(--color-primary)] hover:underline cursor-pointer ${busy ? "opacity-40 pointer-events-none" : ""}`}
              >
                Reemplazar
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    subir(f);
                  }}
                />
              </label>
              <button onClick={eliminar} disabled={busy} className="text-rose-500 hover:text-rose-700 disabled:opacity-40">
                Eliminar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-400 italic">Esta familia todavía no tiene contrato subido.</span>
            <label
              className={`text-sm font-medium text-[var(--color-primary)] hover:underline cursor-pointer ${busy ? "opacity-40 pointer-events-none" : ""}`}
            >
              {busy ? "Subiendo…" : "+ Subir PDF firmado"}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  subir(f);
                }}
              />
            </label>
          </div>
        )}

        {/* Estado de firma. Si el contrato en papel está subido, cuenta como
            firmado y el portal no pide firma web (decisión del 31/07). Con
            padres separados son DOS firmas: no está firmado hasta las dos. */}
        {firmantes > 0 && (
          <div className="pt-2 border-t border-gray-50 text-xs text-gray-600">
            {estado.viaPapel ? (
              <span className="text-emerald-600 font-medium">
                Firmado en papel · no se le pide firma en el portal
              </span>
            ) : (
              <>
                Firmas en el portal:{" "}
                <span className={estado.contratoCompleto ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>
                  {estado.firmas} de {firmantes}
                </span>
                {!estado.contratoCompleto && (
                  <span className="text-gray-400">
                    {" · "}
                    falta {estado.pendientes?.join(" y ") || "por firmar"} · su documentación sigue cerrada
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {error && <div className="text-xs text-rose-600">{error}</div>}
      </div>
    </div>
  );
}
