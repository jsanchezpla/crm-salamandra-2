"use client";

import { useState } from "react";
import Select from "@/components/ui/Select.jsx";
import { INCIDENCIA_CATEGORIES, INCIDENCIA_PRIORITY, INCIDENCIA_VERIFICATIONS } from "@/lib/clinica/incidencias.js";

/**
 * Un solo control para el resultado: la VERIFICACIÓN, que arrastra el estado
 * (Aumenta, 04/08/2026). Antes había tres botones de estado sin sitio para «a
 * medias», que es el resultado más común de una incidencia organizativa.
 */
const VERIF_BTN = [
  { key: "", label: "Sin verificar", on: "bg-neutral-500 text-white", off: "bg-neutral-100 text-neutral-600" },
  ...INCIDENCIA_VERIFICATIONS.map((v) => ({
    key: v.key,
    label: v.label,
    on: v.level === "green" ? "bg-emerald-500 text-white" : v.level === "amber" ? "bg-amber-500 text-white" : "bg-rose-500 text-white",
    off: v.level === "green" ? "bg-emerald-50 text-emerald-700" : v.level === "amber" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700",
  })),
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
  // Multi-responsable: se parte de `assignees` (nuevo) y se cae al legacy
  // `assignedToId` para las incidencias creadas antes del cambio.
  const [assigneeIds, setAssigneeIds] = useState(() => {
    if (Array.isArray(inc?.assignees) && inc.assignees.length) return inc.assignees.map((a) => a.id);
    return inc?.assignedToId ? [inc.assignedToId] : [];
  });
  const toggleAssignee = (id) =>
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const [description, setDescription] = useState(inc?.description ?? "");
  const [resolution, setResolution] = useState(inc?.resolution ?? "");
  const [verification, setVerification] = useState(inc?.verification ?? "");
  const [reportedById, setReportedById] = useState(inc?.reportedById ?? "");
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
      incidenceDate: date, patientId: patientId || null, assigneeIds,
      description: description || null,
      resolution: resolution || null,
      verification: verification || null,
    };
    // Vacío = «lo registro yo»: el servidor resuelve al usuario logueado. Si se
    // mandara `null` se perdería ese automático y la incidencia quedaría sin
    // autor, que es justo el dato que Aumenta quiere ver.
    if (reportedById) fields.reportedById = reportedById;
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
    // Guard de busy también aquí: el botón se deshabilita, pero Enter en el
    // input llamaba directo y un doble Enter duplicaba el comentario.
    if (busy || !comment.trim()) return;
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
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Incidencia <span className="normal-case tracking-normal text-neutral-300">· descripción breve</span></label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="Qué ha pasado, en una línea" />
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
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">
                Responsables
                {assigneeIds.length > 1 && <span className="ml-1 text-neutral-300">· {assigneeIds.length}</span>}
              </label>
              {/* Varias personas pueden estar al cargo de una misma incidencia
                  (sprint 2026-07-29). El PRIMERO que se marca queda como
                  responsable principal, que es el que sale en los listados. */}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {therapists.length === 0 && (
                  <span className="text-xs text-neutral-400">No hay profesionales activos.</span>
                )}
                {therapists.map((t) => {
                  const puesto = assigneeIds.indexOf(t.id);
                  const marcado = puesto >= 0;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleAssignee(t.id)}
                      aria-pressed={marcado}
                      className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                        marcado
                          ? "border-transparent text-white"
                          : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                      }`}
                      style={marcado ? { background: "var(--color-primary, #1B3A2D)" } : undefined}
                    >
                      {t.name}
                      {puesto === 0 && assigneeIds.length > 1 && <span className="ml-1 opacity-70">· principal</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Paciente (si procede)</label>
              <Select value={patientId} onChange={setPatientId}
                options={[{ value: "", label: "Ninguno" }, ...patients.map((p) => ({ value: p.id, label: p.name }))]}
                className={`mt-1 ${inputCls} bg-white`} />
            </div>
            <div>
              {/* Quién la registra sale relleno con quien está usando el CRM,
                  pero recepción apunta cosas que le cuenta otra persona. */}
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Quién la registra</label>
              <Select value={reportedById} onChange={setReportedById}
                options={[{ value: "", label: inc?.reportedBy?.name ?? "Yo" }, ...therapists.map((t) => ({ value: t.id, label: t.name }))]}
                className={`mt-1 ${inputCls} bg-white`} />
            </div>
          </div>

          <div>
            {/* La columna existía desde el principio; el formulario no la
                enseñaba, así que no había forma de escribirla (04/08/2026). */}
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Acción realizada</label>
            <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className={`mt-1 ${inputCls} resize-none`} placeholder="Qué se ha hecho para resolverla…" />
          </div>

          {/* Verificación: en las existentes se guarda al pulsar (es lo que se
              toca a diario); en una nueva viaja con el resto del formulario. */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Verificación</label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {VERIF_BTN.map((v) => {
                const actual = (isNew ? verification : (inc?.verification ?? "")) === v.key;
                return (
                  <button key={v.key || "sin"} type="button" disabled={busy}
                    onClick={() => {
                      setVerification(v.key);
                      if (!isNew) patch({ verification: v.key || null });
                    }}
                    className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${actual ? v.on : v.off}`}>
                    {v.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-neutral-400 mt-1.5">
              Mueve sola el estado: resuelta la cierra, parcial y no resuelta la dejan en proceso.
            </p>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Observaciones</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`mt-1 ${inputCls} resize-none`} placeholder="Contexto, detalle, lo que haga falta recordar…" />
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
