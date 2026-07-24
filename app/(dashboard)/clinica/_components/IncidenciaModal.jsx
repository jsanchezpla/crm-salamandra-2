"use client";

import { useState } from "react";
import Select from "@/components/ui/Select.jsx";
import { INCIDENCIA_CATEGORIES, INCIDENCIA_PRIORITY } from "@/lib/clinica/incidencias.js";

const STATUS_BTN = [
  { key: "pending", label: "Pendiente", on: "bg-amber-500 text-white", off: "bg-amber-50 text-amber-700" },
  { key: "in_progress", label: "En proceso", on: "bg-blue-500 text-white", off: "bg-blue-50 text-blue-700" },
  { key: "resolved", label: "Resuelta", on: "bg-emerald-500 text-white", off: "bg-emerald-50 text-emerald-700" },
];
const fmt = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDT = (d) => (d ? new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const catOf = (k) => INCIDENCIA_CATEGORIES.find((c) => c.key === k);

/**
 * Modal de incidencia — crea una nueva o gestiona una existente
 * (editar campos, cambiar estado, comentar, borrar).
 */
export default function IncidenciaModal({ mode = "create", incidencia = null, therapists = [], patients = [], isAdmin = false, onClose, onSaved }) {
  const [inc, setInc] = useState(incidencia); // se refresca tras cada PATCH
  const isNew = mode === "create" && !inc;

  const [title, setTitle] = useState(inc?.title ?? "");
  const [category, setCategory] = useState(inc?.category ?? "terapeutica");
  const [subcategory, setSubcategory] = useState(inc?.subcategory ?? "");
  const [priority, setPriority] = useState(inc?.priority ?? "medium");
  const [date, setDate] = useState(inc?.date ?? new Date().toISOString().slice(0, 10));
  const [patientId, setPatientId] = useState(inc?.patientId ?? "");
  const [assignedToId, setAssignedToId] = useState(inc?.assignedToId ?? "");
  const [description, setDescription] = useState(inc?.description ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const subs = catOf(category)?.subcategories ?? [];

  const patch = async (bodyObj) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/clinica/incidencias/${inc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo actualizar");
      setInc(j.data);
      onSaved?.();
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createOrSaveFields = async () => {
    setErr(null);
    if (!title.trim()) { setErr("El título es obligatorio."); return; }
    const fields = {
      title: title.trim(), category, subcategory: subcategory || null, priority,
      incidenceDate: date, patientId: patientId || null, assignedToId: assignedToId || null,
      description: description || null,
    };
    if (isNew) {
      setBusy(true);
      try {
        const r = await fetch("/api/clinica/incidencias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...fields, date }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "No se pudo crear");
        onSaved?.();
        onClose?.();
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    } else {
      const okp = await patch(fields);
      if (okp) setErr(null);
    }
  };

  const delIncidencia = async () => {
    if (!window.confirm("¿Eliminar esta incidencia del todo? No se puede deshacer.")) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/clinica/incidencias/${inc.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo eliminar");
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    const okp = await patch({ comment: comment.trim() });
    if (okp) setComment("");
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400";

  return (
    <div className="fixed inset-0 z-50 flex items-start lg:items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => !busy && onClose?.()}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-lg text-[var(--ink-900)]">{isNew ? "Nueva incidencia" : "Incidencia"}</h3>
            {!isNew && <p className="text-[11px] text-neutral-400 mt-0.5">Registrada por {inc?.reportedBy?.name ?? "—"} · {fmt(inc?.createdAt)}</p>}
          </div>
          <button onClick={() => !busy && onClose?.()} className="p-1.5 text-neutral-400 hover:text-neutral-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Estado (solo existentes) */}
          {!isNew && (
            <div className="flex items-center gap-2">
              {STATUS_BTN.map((s) => (
                <button key={s.key} disabled={busy} onClick={() => patch({ status: s.key })}
                  className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${inc?.status === s.key ? s.on : s.off}`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Título</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="Resumen breve de la incidencia" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Categoría</label>
              <Select value={category} onChange={(v) => { setCategory(v); setSubcategory(""); }}
                options={INCIDENCIA_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
                className={`mt-1 ${inputCls} bg-white`} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Subcategoría</label>
              {subs.length ? (
                <Select value={subcategory} onChange={setSubcategory}
                  options={[{ value: "", label: "—" }, ...subs.map((s) => ({ value: s, label: s }))]}
                  className={`mt-1 ${inputCls} bg-white`} />
              ) : (
                <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="Opcional" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Prioridad</label>
              <Select value={priority} onChange={setPriority}
                options={Object.values(INCIDENCIA_PRIORITY).map((p) => ({ value: p.key, label: p.label }))}
                className={`mt-1 ${inputCls} bg-white`} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Fecha</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`mt-1 ${inputCls}`} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Responsable</label>
              <Select value={assignedToId} onChange={setAssignedToId}
                options={[{ value: "", label: "Sin asignar" }, ...therapists.map((t) => ({ value: t.id, label: t.name }))]}
                className={`mt-1 ${inputCls} bg-white`} />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Paciente (opcional)</label>
            <Select value={patientId} onChange={setPatientId}
              options={[{ value: "", label: "Ninguno" }, ...patients.map((p) => ({ value: p.id, label: p.name }))]}
              className={`mt-1 ${inputCls} bg-white`} />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Descripción</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`mt-1 ${inputCls} resize-none`} placeholder="Detalle de la incidencia…" />
          </div>

          {/* Comentarios (solo existentes) */}
          {!isNew && (
            <div className="border-t border-neutral-100 pt-3">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-2">Comentarios</div>
              <div className="space-y-2 mb-2 max-h-40 overflow-y-auto">
                {(inc?.comments ?? []).length === 0 && <p className="text-[11px] text-neutral-400">Sin comentarios.</p>}
                {(inc?.comments ?? []).map((c, i) => (
                  <div key={i} className="rounded-lg bg-neutral-50 border border-neutral-100 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-neutral-700">{c.authorName}</span>
                      <span className="text-[10px] text-neutral-400">{fmtDT(c.at)}</span>
                    </div>
                    <p className="text-xs text-neutral-600 mt-0.5 whitespace-pre-wrap">{c.text}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComment()} className={inputCls} placeholder="Escribe un comentario y pulsa Enter" />
                <button disabled={busy || !comment.trim()} onClick={addComment} className="text-[11px] px-3 py-2 rounded-lg text-white disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>Añadir</button>
              </div>
            </div>
          )}

          {err && <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{err}</div>}
        </div>

        <div className="px-5 py-4 border-t border-neutral-100 flex items-center justify-between gap-2">
          <div>
            {!isNew && isAdmin && (
              <button onClick={delIncidencia} disabled={busy} className="text-[11px] text-rose-600 hover:underline disabled:opacity-50">Eliminar</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => !busy && onClose?.()} disabled={busy} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cerrar</button>
            <button onClick={createOrSaveFields} disabled={busy} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
              {busy ? "Guardando…" : isNew ? "Crear incidencia" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
