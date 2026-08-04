"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";

// Días en orden de UI (lunes primero) pero conservando valores JS getDay()
const DAYS_UI = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

function fmtTime(value) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

export default function CitasDisponibilidadPage() {
  const [eventTypes, setEventTypes] = useState([]);
  const [selectedEt, setSelectedEt] = useState(""); // "" = global (null)
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // { dayOfWeek }
  const [newSlot, setNewSlot] = useState({ startTime: "09:00", endTime: "14:00" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("eventTypeId", selectedEt || "null");
      const res = await fetch(`/api/citas/availability?${params}`, { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error cargando");
      setSlots(j.data);
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }, [selectedEt]);

  useEffect(() => {
    // `active=true`: un tipo de cita eliminado seguía saliendo aquí, y sin
    // marca de ningún tipo (04/08/2026). Ponerle horario a algo que ya no se
    // puede reservar no sirve de nada, y encima hacía dudar de si estaba
    // borrado o no.
    fetch("/api/citas/event-types?active=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setEventTypes(j.data); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const slotsByDay = useMemo(() => {
    const map = new Map();
    for (const day of DAYS_UI) map.set(day.value, []);
    for (const s of slots) {
      const list = map.get(s.dayOfWeek);
      if (list) list.push(s);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [slots]);

  function openAddSlot(dayOfWeek) {
    setModal({ dayOfWeek });
    setNewSlot({ startTime: "09:00", endTime: "14:00" });
    setError(null);
  }

  async function saveNewSlot() {
    setError(null);
    if (newSlot.startTime >= newSlot.endTime) {
      setError("La hora de fin debe ser posterior al inicio"); return;
    }
    try {
      const res = await fetch("/api/citas/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventTypeId: selectedEt || null,
          dayOfWeek: modal.dayOfWeek,
          startTime: newSlot.startTime,
          endTime: newSlot.endTime,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error creando bloque");
      setModal(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteSlot(id) {
    if (!window.confirm("¿Eliminar este bloque de disponibilidad?")) return;
    const res = await fetch(`/api/citas/availability/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Error eliminando"); return;
    }
    await load();
  }

  async function copyWeekday() {
    if (!window.confirm("Esto creará bloques 9:00-14:00 y 16:00-18:00 de lunes a viernes. ¿Continuar?")) return;
    setError(null);
    try {
      const bulk = [];
      for (const day of [1, 2, 3, 4, 5]) {
        bulk.push({ eventTypeId: selectedEt || null, dayOfWeek: day, startTime: "09:00", endTime: "14:00" });
        bulk.push({ eventTypeId: selectedEt || null, dayOfWeek: day, startTime: "16:00", endTime: "18:00" });
      }
      const res = await fetch("/api/citas/availability/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: bulk }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error creando bloques");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 lg:px-10 pt-8 pb-5 flex items-end justify-between shrink-0 border-b border-[var(--ink-200)] gap-6 flex-wrap">
        <div>
          <div className="eyebrow mb-1.5 lg:mb-2">Tiempo · Configuración</div>
          <h1 className="font-display text-[24px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
            Disponibilidad <span className="font-display-italic text-[var(--ink-400)]">— semanal</span>
          </h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Link
            href="/citas"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Calendario
          </Link>
          <Link
            href="/citas/tipos"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Tipos de cita
          </Link>
          <button
            onClick={copyWeekday}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Copiar semana laboral (L-V)
          </button>
        </div>
      </div>

      <div className="px-6 lg:px-10 py-3 flex items-center gap-3 shrink-0 border-b border-neutral-100">
        <label className="text-[12px] text-neutral-500">Disponibilidad para:</label>
        <Select
          value={selectedEt}
          onChange={(v) => setSelectedEt(v)}
          options={[
            { value: "", label: "Todos los tipos de cita (global)" },
            ...eventTypes.map((e) => ({ value: e.id, label: e.name })),
          ]}
          className="text-sm rounded-md px-2 py-1.5 border border-neutral-200 bg-white"
        />
      </div>

      {error && (
        <div className="mx-6 lg:mx-10 mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 lg:px-10 py-6">
        {loading ? (
          <div className="text-sm text-neutral-400">Cargando...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3">
            {DAYS_UI.map((day) => {
              const list = slotsByDay.get(day.value) ?? [];
              return (
                <div key={day.value} className="bg-white border border-neutral-200 rounded-xl p-3 flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[12px] font-semibold text-neutral-700 uppercase tracking-wider">
                      {day.label}
                    </h3>
                    <button
                      onClick={() => openAddSlot(day.value)}
                      title="Añadir bloque"
                      className="text-neutral-400 hover:text-neutral-700"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                    </button>
                  </div>
                  <div className="space-y-1.5 flex-1">
                    {list.length === 0 ? (
                      <div className="text-[12px] text-neutral-300 italic">Sin bloques</div>
                    ) : (
                      list.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between px-2.5 py-1.5 bg-neutral-50 border border-neutral-200 rounded-md"
                        >
                          <span className="text-[12px] tabular-nums text-neutral-700">
                            {fmtTime(s.startTime)} – {fmtTime(s.endTime)}
                          </span>
                          <button
                            onClick={() => deleteSlot(s.id)}
                            className="text-neutral-400 hover:text-red-500"
                            aria-label="Eliminar"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <button
                    onClick={() => openAddSlot(day.value)}
                    className="mt-2 text-[11px] text-neutral-400 hover:text-neutral-700 self-start"
                  >
                    + Añadir bloque
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal añadir bloque */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">
                Nuevo bloque — {DAYS_UI.find((d) => d.value === modal.dayOfWeek)?.label}
              </h2>
              <button
                onClick={() => setModal(null)}
                className="text-neutral-400 hover:text-neutral-700 p-0.5"
                aria-label="Cerrar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Inicio</label>
                  <input
                    type="time"
                    value={newSlot.startTime}
                    onChange={(e) => setNewSlot((p) => ({ ...p, startTime: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Fin</label>
                  <input
                    type="time"
                    value={newSlot.endTime}
                    onChange={(e) => setNewSlot((p) => ({ ...p, endTime: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-neutral-100 flex justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="text-xs px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </button>
              <button
                onClick={saveNewSlot}
                className="text-xs px-3 py-1.5 rounded-md bg-[#0F0F0F] text-white hover:bg-[#222]"
              >
                Crear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
