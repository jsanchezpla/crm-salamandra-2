"use client";

/**
 * ClientComunicacionesSection — «Comunicaciones» de la ficha de cliente
 * (01/08/2026).
 *
 * Muestra por dónde acepta la familia que se le escriba y permite cambiarlo
 * desde el CRM. Existe porque **retirar un consentimiento tiene que ser tan
 * fácil como darlo**: si llaman y dicen «no me mandéis más WhatsApps», tiene
 * que poder quedar reflejado en ese momento y no esperar a que entren en su
 * área privada.
 *
 * Se distingue quién lo marcó: la propia familia en el portal, o el equipo
 * apuntando lo que dijo. No es lo mismo como prueba, y por eso se enseña.
 */

import { useCallback, useEffect, useState } from "react";

function fmtFecha(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ClientComunicacionesSection({ clientId }) {
  const [datos, setDatos] = useState(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    fetch(`/api/clients/${clientId}/comunicaciones`)
      .then(async (r) => ({ r, d: await r.json().catch(() => ({})) }))
      .then(({ r, d }) => {
        if (!alive) return;
        if (r.status === 403) { setAvailable(false); return; }
        if (!d.ok) throw new Error(d.error || "No se pudieron cargar las comunicaciones");
        setDatos(d.data);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [clientId]);

  useEffect(() => load(), [load]);

  async function alternar(canal, aceptado) {
    setBusy(canal);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/comunicaciones`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [canal]: aceptado }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "No se pudo guardar");
      setDatos(d.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (loading || !available) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6 max-w-5xl">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-semibold text-gray-700">Comunicaciones</span>
        <span className="text-[11px] text-gray-400">
          {datos?.yaRespondio ? "La familia ya ha contestado" : "Sin respuesta de la familia todavía (valores por defecto)"}
        </span>
      </div>

      <div className="p-5">
        <ul className="divide-y divide-gray-100">
          {(datos?.canales ?? []).map((c) => (
            <li key={c.canal} className="py-3 flex items-start gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-800">{c.label}</div>
                <div className="text-xs text-gray-500">{c.ayuda}</div>
                {c.desde && (
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {c.quien === "portal" ? "Lo marcó la familia" : "Lo registró el equipo"} el {fmtFecha(c.desde)}
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={c.aceptado}
                  disabled={busy === c.canal}
                  onChange={(e) => alternar(c.canal, e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 accent-[var(--color-primary)]"
                />
                {c.aceptado ? "Sí" : "No"}
              </label>
            </li>
          ))}
        </ul>

        {error && <div className="text-xs text-rose-600 mt-3">{error}</div>}

        <p className="text-[10px] text-gray-400 mt-3">
          Si desmarcas los dos avisos de cita, esta familia no recibirá ni confirmaciones ni
          recordatorios: solo verá sus citas entrando en su área privada.
        </p>
      </div>
    </div>
  );
}
