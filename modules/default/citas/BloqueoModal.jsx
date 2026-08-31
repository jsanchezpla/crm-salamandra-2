"use client";

import { useState } from "react";
import { inputCls, toDateInput, toTimeInput } from "./chips.jsx";

/**
 * El modal pequeño de un bloqueo pulsado en el calendario (31/08/2026,
 * Rodrigo): cambiar el concepto, la fecha y la duración sin ir a la pestaña
 * de Bloqueos. Se apoya en el PATCH de /api/citas/bloqueos, que ya pone las
 * vallas (cada cual toca lo suyo, los cierres del centro solo dirección):
 * aquí un 403 solo se enseña.
 */
export function BloqueoModal({ bloqueo, onClose, onSaved }) {
  const [label, setLabel] = useState(bloqueo.label ?? "");
  const [startDate, setStartDate] = useState(toDateInput(bloqueo.start));
  const [startTime, setStartTime] = useState(toTimeInput(bloqueo.start));
  const [endDate, setEndDate] = useState(toDateInput(bloqueo.end));
  const [endTime, setEndTime] = useState(toTimeInput(bloqueo.end));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function guardar() {
    setErr(null);
    const inicio = new Date(`${startDate}T${startTime || "00:00"}`);
    const fin = new Date(`${endDate}T${endTime || "00:00"}`);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      setErr("Fecha u hora ilegibles");
      return;
    }
    if (fin <= inicio) {
      setErr("El fin tiene que ser posterior al inicio");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/citas/bloqueos?id=${bloqueo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || "Vacaciones",
          startAt: inicio.toISOString(),
          endAt: fin.toISOString(),
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      onSaved();
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !saving && onClose()} />
      {/* items-start + overflow-y-auto, no centrado en alto: la lección del
          modal de incidencias (31/08/2026) — centrado, en pantallas grandes se
          cortaba por arriba. */}
      <div className="fixed top-14 lg:top-0 inset-x-0 bottom-0 z-50 flex items-start justify-center pt-16 px-4 overflow-y-auto pointer-events-none">
        <div className="bg-white rounded-xl shadow-pop w-full max-w-sm pointer-events-auto">
          <div className="px-5 pt-4 pb-3 border-b border-neutral-100">
            <div className="eyebrow">Bloqueo</div>
            <h3 className="font-display text-lg text-neutral-900 mt-0.5 truncate">{bloqueo.titulo}</h3>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-neutral-500 mb-1">Concepto</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder="Vacaciones" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Empieza</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Hora</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Termina</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Hora</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
              </div>
            </div>
            {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{err}</div>}
          </div>
          <div className="px-5 py-3 border-t border-neutral-100 flex justify-end gap-2">
            <button type="button" onClick={() => !saving && onClose()}
              className="px-3 py-1.5 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={saving}
              className="px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
              style={{ background: "var(--color-primary, #1B3A2D)" }}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
