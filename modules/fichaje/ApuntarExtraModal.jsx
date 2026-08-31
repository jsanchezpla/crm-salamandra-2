"use client";

import { useState } from "react";

/**
 * Apuntar horas extra a mano (31/08/2026, Rodrigo). Usa el POST manual de
 * /api/fichaje que ya existía sin interfaz, con `tipo: "extra"`: el tramo
 * queda etiquetado como extra (no como «más minutos» sueltos) y la nota es
 * obligatoria — un tramo que no salió de ningún fichero tiene que decir de
 * dónde salió.
 */
export default function ApuntarExtraModal({ personas, periodo, onClose, onSaved }) {
  const [teamMemberId, setTeamMemberId] = useState("");
  const [fecha, setFecha] = useState(`${periodo}-01`);
  const [horas, setHoras] = useState("1");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState(null);

  async function guardar() {
    setErr(null);
    const minutos = Math.round(Number(horas) * 60);
    if (!teamMemberId) { setErr("Elige a la persona"); return; }
    if (!Number.isFinite(minutos) || minutos <= 0) { setErr("Pon las horas extra (mayor que 0)"); return; }
    if (!nota.trim()) { setErr("La nota es obligatoria: di de dónde salen estas horas"); return; }
    setGuardando(true);
    try {
      const r = await fetch("/api/fichaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamMemberId, fecha, minutos, tipo: "extra", nota: nota.trim() }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      onSaved();
    } catch (e) {
      setErr(e.message);
      setGuardando(false);
    }
  }

  const inputCls =
    "w-full rounded-lg px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 focus:outline-none focus:border-gray-400";

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !guardando && onClose()} />
      {/* items-start + overflow, no centrado en alto (la lección del modal de
          incidencias): en pantallas grandes el centrado se corta por arriba. */}
      <div className="fixed top-14 lg:top-0 inset-x-0 bottom-0 z-50 flex items-start justify-center pt-16 px-4 overflow-y-auto pointer-events-none">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm pointer-events-auto">
          <div className="px-5 pt-4 pb-3 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Apuntar horas extra</h3>
            <p className="text-xs text-gray-400 mt-0.5">Quedan etiquetadas como extra, con su nota.</p>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Persona</label>
              <select value={teamMemberId} onChange={(e) => setTeamMemberId(e.target.value)} className={inputCls}>
                <option value="">Elegir…</option>
                {personas.map((p) => (
                  <option key={p.teamMemberId} value={p.teamMemberId}>{p.nombre}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Día</label>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Horas</label>
                <input type="number" min="0.25" step="0.25" value={horas} onChange={(e) => setHoras(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Nota (obligatoria)</label>
              <input value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls}
                placeholder="Ej: se quedó con el taller de las 18:00" />
            </div>
            {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{err}</div>}
          </div>
          <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
            <button type="button" onClick={() => !guardando && onClose()}
              className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-widest hover:text-gray-700">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={guardando}
              className="px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide text-white bg-[var(--color-primary)] disabled:opacity-50">
              {guardando ? "Guardando..." : "Apuntar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
