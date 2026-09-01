"use client";

import { useState } from "react";
import { inputCls, toDateInput, toTimeInput } from "./chips.jsx";

/**
 * El modal pequeño de un bloqueo pulsado en el calendario (31/08/2026,
 * Rodrigo): cambiar la categoría, el concepto, la fecha y la duración sin ir a
 * la pestaña de Bloqueos. Se apoya en el PATCH de /api/citas/bloqueos, que ya
 * pone las vallas (cada cual toca lo suyo, los cierres del centro solo
 * dirección): aquí un 403 solo se enseña.
 *
 * `categorias` son las del centro (01/09/2026), tal como las devuelve el
 * listado de bloqueos. Vacías —el centro no las usa— y el desplegable no se
 * enseña: el modal se queda exactamente como estaba.
 */
export function BloqueoModal({ bloqueo, categorias = [], talleres = [], onClose, onSaved }) {
  const [label, setLabel] = useState(bloqueo.label ?? "");
  const [categoryKey, setCategoryKey] = useState(bloqueo.categoryKey ?? "");
  const [tallerId, setTallerId] = useState(bloqueo.tallerId ?? "");
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
          // Vacía = quitarle la categoría. El servidor descarta la que no esté
          // dada de alta, así que aquí no hace falta validar nada.
          categoryKey: categoryKey || null,
          // Y qué taller se da en el tramo. Vacío = no es un taller.
          tallerId: tallerId || null,
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
            {categorias.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Categoría</label>
                <select
                  value={categoryKey}
                  onChange={(e) => setCategoryKey(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
            )}
            {/* ¿Este tramo es un TALLER? (01/09/2026, Rodrigo). Hasta hoy los
                talleres «salían como bloqueos y ya»: la hora quedaba tachada y
                de lo que pasaba dentro no quedaba nada. Marcándolo aquí, desde
                el propio taller se registra la sesión del grupo. */}
            {talleres.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Taller</label>
                <select value={tallerId} onChange={(e) => setTallerId(e.target.value)} className={inputCls}>
                  <option value="">No es un taller</option>
                  {talleres.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {tallerId && (
                  <p className="text-[10px] text-neutral-400 mt-1">
                    El registro de la sesión se escribe desde{" "}
                    <a href="/clinica/talleres" className="underline hover:no-underline">Talleres</a>: uno para
                    todo el grupo, más la nota de cada paciente.
                  </p>
                )}
              </div>
            )}
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
