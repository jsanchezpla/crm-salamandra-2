"use client";

/**
 * TeamHoursEditor — editor del horario de trabajo semanal de un terapeuta.
 * Lee/guarda contra /api/team/[id]/hours. Reutilizable: en la ficha del miembro
 * (Equipo, el centro edita cualquiera) y en "Mi horario" (el terapeuta el suyo).
 */

import { useCallback, useEffect, useState } from "react";

// Orden de visualización: lunes primero. `value` = convención JS getDay (0=domingo).
const DAYS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

export default function TeamHoursEditor({ memberId, canEdit = true }) {
  const [rows, setRows] = useState([]); // { dayOfWeek, startTime, endTime }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/team/${memberId}/hours`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setRows((j.data.hours || []).map((h) => ({
            dayOfWeek: h.dayOfWeek,
            startTime: String(h.startTime || "").slice(0, 5),
            endTime: String(h.endTime || "").slice(0, 5),
          })));
        }
      })
      .catch(() => setErr("No se pudo cargar el horario"))
      .finally(() => setLoading(false));
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  const byDay = (d) => rows.map((r, i) => ({ ...r, i })).filter((r) => r.dayOfWeek === d);
  const addRange = (d) => { setMsg(null); setRows((rs) => [...rs, { dayOfWeek: d, startTime: "09:00", endTime: "14:00" }]); };
  const setField = (i, k, v) => { setMsg(null); setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r))); };
  const removeRange = (i) => { setMsg(null); setRows((rs) => rs.filter((_, idx) => idx !== i)); };

  async function save() {
    setSaving(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/team/${memberId}/hours`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: rows.map((h) => ({ dayOfWeek: h.dayOfWeek, startTime: h.startTime, endTime: h.endTime })) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar el horario");
      setMsg("Horario guardado ✓");
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-[11px] text-neutral-400">Cargando horario…</p>;

  return (
    <div>
      <div className="space-y-2">
        {DAYS.map((d) => {
          const ranges = byDay(d.value);
          return (
            <div key={d.value} className="flex items-start gap-3">
              <div className="w-24 shrink-0 text-xs text-neutral-600 pt-1.5">{d.label}</div>
              <div className="flex-1 space-y-1.5">
                {ranges.length === 0 && <div className="text-[11px] text-neutral-300 pt-1.5">Libre</div>}
                {ranges.map((r) => (
                  <div key={r.i} className="flex items-center gap-1.5">
                    <input type="time" disabled={!canEdit} value={r.startTime} onChange={(e) => setField(r.i, "startTime", e.target.value)} className="rounded-md border border-neutral-200 px-2 py-1 text-xs disabled:bg-neutral-50" />
                    <span className="text-neutral-400 text-xs">–</span>
                    <input type="time" disabled={!canEdit} value={r.endTime} onChange={(e) => setField(r.i, "endTime", e.target.value)} className="rounded-md border border-neutral-200 px-2 py-1 text-xs disabled:bg-neutral-50" />
                    {canEdit && (
                      <button type="button" onClick={() => removeRange(r.i)} className="text-neutral-400 hover:text-rose-600 px-1" title="Quitar franja">✕</button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <button type="button" onClick={() => addRange(d.value)} className="text-[11px] font-medium text-[var(--color-primary,#1B3A2D)] hover:underline">+ Añadir franja</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
      {msg && <p className="text-[11px] text-emerald-600 mt-2">{msg}</p>}
      {canEdit && (
        <div className="flex justify-end mt-3">
          <button onClick={save} disabled={saving} className="text-xs font-medium px-3 py-1.5 rounded-md text-white disabled:opacity-40" style={{ backgroundColor: "var(--color-primary,#1B3A2D)" }}>
            {saving ? "Guardando…" : "Guardar horario"}
          </button>
        </div>
      )}
    </div>
  );
}
