"use client";

import { useState } from "react";
import Select from "@/components/ui/Select.jsx";
import { scoreToSemaforo } from "@/lib/clinica/performanceAreas.js";
import { computeTotalScore, proposeIncentive } from "@/lib/clinica/incentives.js";

const SEMAFORO_DOT = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500", gray: "bg-neutral-300" };

/**
 * Editor de la evaluación mensual de un miembro del equipo (Dirección).
 * Se monta fresco cada vez (el padre lo renderiza solo cuando está abierto y le
 * pasa `initial`), así que inicializa el estado directamente desde props.
 *
 * Desempeño por roles: ya NO importa PERFORMANCE_AREAS. Las áreas y los umbrales
 * del semáforo llegan por props: el PADRE resuelve el rol de la persona elegida
 * (y al cambiar de persona en el alta, via onTherapistChange, re-resuelve y las
 * áreas del formulario cambian).
 *
 * Props:
 *   therapists  [{id,name}]  lista para el desplegable (solo alta nueva)
 *   defaultPeriod "YYYY-MM"  periodo por defecto
 *   tiers       [{from,amount}]  para la vista previa del incentivo
 *   areas       [{key,name,weight,goal?}]  áreas del ROL de la persona elegida
 *   thresholds  {green,amber}  umbrales del semáforo del rol
 *   roleKey     clave del rol (se envía en el body del POST)
 *   onTherapistChange(id)  aviso al padre para que re-resuelva el rol
 *   initial     null | { therapistId, therapistName, areaScores, complements, notes }
 *   onClose()   onSaved(row)
 */
export default function PerformanceEditor({ therapists = [], defaultPeriod, tiers = [], areas = [], thresholds, roleKey = null, onTherapistChange, initial = null, onClose, onSaved }) {
  const isEdit = !!initial;
  const [therapistId, setTherapistId] = useState(initial?.therapistId ?? "");
  const [period, setPeriod] = useState(defaultPeriod);
  const [scores, setScores] = useState(() => {
    const o = {};
    for (const a of areas) {
      const v = initial?.areaScores?.[a.key];
      o[a.key] = v == null ? "" : String(v);
    }
    return o;
  });
  const [occupation, setOccupation] = useState(initial?.complements?.occupation == null ? "" : String(initial.complements.occupation));
  const [seniority, setSeniority] = useState(initial?.complements?.seniority == null ? "" : String(initial.complements.seniority));
  const [attendance, setAttendance] = useState(initial?.complements?.attendance ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [pullingOcc, setPullingOcc] = useState(false);

  const pickTherapist = (id) => {
    setTherapistId(id);
    onTherapistChange?.(id); // el padre re-resuelve el rol → cambian `areas`/`thresholds`
  };

  // Trae el % de productividad del profesional/periodo y lo pone como ocupación.
  const pullOccupation = async () => {
    if (!therapistId) { setErr("Elige a la persona antes de traer la ocupación."); return; }
    setPullingOcc(true); setErr(null);
    try {
      const r = await fetch(`/api/clinica/productividad?period=${period}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo leer productividad");
      const row = (j.data.rows ?? []).find((x) => x.therapistId === therapistId);
      if (row?.pct == null) { setErr("Ese profesional no tiene productividad calculada en el periodo (falta fijar sus horas/semana)."); return; }
      setOccupation(String(Math.max(0, Math.min(100, Math.round(row.pct)))));
    } catch (e) {
      setErr(e.message);
    } finally {
      setPullingOcc(false);
    }
  };

  // Vista previa en vivo (mismas fórmulas que el backend, con las áreas del rol).
  const merged = {};
  for (const a of areas) merged[a.key] = (scores[a.key] ?? "") === "" ? null : Number(scores[a.key]);
  const totalPreview = computeTotalScore(merged, areas);
  const proposedPreview = proposeIncentive(totalPreview, tiers);
  const totalLevel = scoreToSemaforo(totalPreview, thresholds);

  const save = async () => {
    setErr(null);
    if (!therapistId) { setErr("Elige un miembro del equipo."); return; }
    setBusy(true);
    try {
      // En ALTA ("Nueva evaluación"), los campos vacíos se OMITEN del body: si
      // esa persona+mes ya tenía evaluación, el backend conserva lo guardado
      // (merge) en vez de machacarlo con nulls. En EDICIÓN el formulario va
      // precargado, así que vaciar un campo es borrado intencional (se envía null).
      const areaScores = {};
      for (const a of areas) {
        const v = scores[a.key] ?? "";
        if (v === "") {
          if (isEdit) areaScores[a.key] = null;
        } else {
          areaScores[a.key] = Number(v);
        }
      }
      const complements = {};
      if (occupation !== "" || isEdit) complements.occupation = occupation === "" ? null : Number(occupation);
      if (seniority !== "" || isEdit) complements.seniority = seniority === "" ? null : Number(seniority);
      if (attendance || isEdit) complements.attendance = attendance;
      const body = { therapistId, period, areaScores, complements };
      if (roleKey) body.roleKey = roleKey;
      if (notes.trim() || isEdit) body.notes = notes.trim() || null;
      const r = await fetch("/api/clinica/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar");
      onSaved?.(j.data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start lg:items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => !busy && onClose?.()}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-4" onClick={(e) => e.stopPropagation()}>
        {/* Cabecera */}
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-lg text-[var(--ink-900)]">{isEdit ? "Editar evaluación" : "Nueva evaluación"}</h3>
            <p className="text-[11px] text-neutral-400 mt-0.5">{isEdit ? initial?.therapistName ?? "" : "Puntúa las áreas del rol de la persona en el periodo."}</p>
          </div>
          <button onClick={() => !busy && onClose?.()} className="p-1.5 text-neutral-400 hover:text-neutral-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Miembro del equipo + periodo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Miembro del equipo</label>
              {isEdit ? (
                <div className="mt-1 px-3 py-2 text-sm border border-neutral-100 rounded-lg bg-neutral-50 text-neutral-700">{initial?.therapistName ?? "—"}</div>
              ) : (
                <Select
                  value={therapistId}
                  onChange={pickTherapist}
                  options={[{ value: "", label: "Elegir…" }, ...therapists.map((t) => ({ value: t.id, label: t.name }))]}
                  className="mt-1 w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 bg-white"
                />
              )}
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Periodo</label>
              <input
                type="month" value={period} onChange={(e) => setPeriod(e.target.value)}
                className="mt-1 w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-400"
              />
            </div>
          </div>

          {/* Áreas (las del rol resuelto por el padre) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="eyebrow">Puntuación por áreas (0-100)</label>
              <span className="text-[10px] text-neutral-400">El peso pondera la puntuación total</span>
            </div>
            {areas.length === 0 ? (
              <p className="text-[11px] text-neutral-400">Elige a la persona para cargar las áreas de su rol.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {areas.map((a, idx) => (
                  <div key={a.key} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[var(--ink-900)] truncate">{a.n ?? idx + 1}. {a.name}</div>
                      {a.goal ? <div className="text-[10px] text-neutral-400 truncate" title={a.goal}>Meta: {a.goal}</div> : null}
                      <div className="text-[10px] text-neutral-400">Peso {a.weight}%</div>
                    </div>
                    <input
                      type="number" min={0} max={100} value={scores[a.key] ?? ""}
                      onChange={(e) => setScores((s) => ({ ...s, [a.key]: e.target.value }))}
                      className="w-20 px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 tabular text-right"
                      placeholder="—"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Complementos */}
          <div>
            <label className="eyebrow">Complementos</label>
            <div className="grid grid-cols-3 gap-3 mt-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400">Ocupación %</div>
                  <button type="button" onClick={pullOccupation} disabled={pullingOcc} className="text-[10px] text-[var(--color-primary,#1B3A2D)] hover:underline disabled:opacity-50" title="Traer el % de productividad del periodo">
                    {pullingOcc ? "…" : "productividad"}
                  </button>
                </div>
                <input type="number" min={0} max={100} value={occupation} onChange={(e) => setOccupation(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 tabular" placeholder="—" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Antigüedad (años)</div>
                <input type="number" min={0} value={seniority} onChange={(e) => setSeniority(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 tabular" placeholder="—" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Asistencia</div>
                <button
                  type="button" onClick={() => setAttendance((v) => !v)}
                  className={`w-full px-2 py-1.5 text-sm rounded-lg border ${attendance ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-white border-neutral-200 text-neutral-500"}`}
                >
                  {attendance ? "✓ Sin faltas" : "Con faltas"}
                </button>
              </div>
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Notas (opcional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-400 resize-none" placeholder="Comentario interno sobre la evaluación…" />
          </div>

          {/* Vista previa */}
          <div className="flex items-center justify-between rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className={`w-2.5 h-2.5 rounded-full ${SEMAFORO_DOT[totalLevel] ?? SEMAFORO_DOT.gray}`} />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-400">Puntuación total</div>
                <div className="font-display text-xl text-[var(--ink-900)] tabular">{totalPreview ?? "—"}<span className="text-xs text-neutral-400">/100</span></div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">Incentivo propuesto</div>
              <div className="font-display text-xl text-[var(--color-primary,#1B3A2D)] tabular">{proposedPreview} €</div>
            </div>
          </div>

          {err && <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{err}</div>}
        </div>

        <div className="px-5 py-4 border-t border-neutral-100 flex justify-end gap-2">
          <button onClick={() => !busy && onClose?.()} disabled={busy} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancelar</button>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
            {busy ? "Guardando…" : "Guardar evaluación"}
          </button>
        </div>
      </div>
    </div>
  );
}
