"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Select from "@/components/ui/Select.jsx";
import { TASK_PRIORITIES, DEFAULT_TASK_PRIORITY } from "@/lib/projects/taskPriority.js";

/**
 * TaskDrawer — drawer lateral derecho para ver/editar/crear una task.
 *
 * Modos:
 *   - view: cargar GET /api/tasks/[id] y editar campos. Cada commit (blur o
 *     change estable) dispara PATCH /api/tasks/[id]. Indicador
 *     SaveStatusIndicator con estados idle | saving | saved | error.
 *   - create: pre-rellena boardColumnId. Solo guarda al pulsar "Crear" — los
 *     campos editables no persisten hasta que el POST devuelva 201.
 *
 * Reglas:
 *   - top-14 lg:top-0 (regla #13 del proyecto: respeta barra móvil).
 *   - bottom-0, right-0, ancho 100% mobile / 480-600px desktop.
 *   - Backdrop con opacidad 50%, click para cerrar.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

function initials(name) {
  if (!name) return "??";
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}

function SaveStatusIndicator({ status }) {
  const map = {
    idle: { dot: "bg-neutral-300", text: "" },
    saving: { dot: "bg-amber-400 animate-pulse", text: "Guardando..." },
    saved: { dot: "bg-emerald-500", text: "Guardado" },
    error: { dot: "bg-rose-500", text: "Error al guardar" },
  };
  const m = map[status] ?? map.idle;
  return (
    <span className="inline-flex items-center gap-2 text-xs text-neutral-500">
      <span className={`w-2 h-2 rounded-full ${m.dot}`} />
      {m.text}
    </span>
  );
}

export default function TaskDrawer({
  projectId,
  taskId,
  mode = "view",
  createInColumnId,
  columns = [],
  teamMembers = [],
  onClose,
  onSaved,
  onCreated,
  onDeleted,
}) {
  const [task, setTask] = useState(null);
  const [phases, setPhases] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [error, setError] = useState(null);

  // Form state local
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: DEFAULT_TASK_PRIORITY,
    boardColumnId: createInColumnId ?? null,
    phaseId: null,
    milestoneId: null,
    dueDate: "",
    estimatedHours: "",
    assigneeIds: [],
    checklist: [],
    tags: [],
  });
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [newTag, setNewTag] = useState("");

  const saveTimer = useRef(null);

  // ── Cargar fases + hitos del proyecto ─────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [phRes, miRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/phases`).then((r) => r.json()),
          fetch(`/api/projects/${projectId}/milestones`).then((r) => r.json()),
        ]);
        setPhases(phRes?.data ?? []);
        setMilestones(miRes?.data ?? []);
      } catch {}
    })();
  }, [projectId]);

  // ── Cargar task (modo view) o inicializar (modo create) ───────────────
  useEffect(() => {
    if (mode === "create") {
      setForm({
        title: "",
        description: "",
        boardColumnId: createInColumnId ?? null,
        phaseId: null,
        milestoneId: null,
        dueDate: "",
        estimatedHours: "",
        assigneeIds: [],
        checklist: [],
        tags: [],
      });
      setLoading(false);
      return;
    }
    if (!taskId) return;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/tasks/${taskId}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Error cargando tarea");
        const t = j.data;
        setTask(t);
        setForm({
          title: t.title ?? "",
          description: t.description ?? "",
          priority: t.priority ?? DEFAULT_TASK_PRIORITY,
          boardColumnId: t.boardColumnId ?? null,
          phaseId: t.phaseId ?? null,
          milestoneId: t.milestoneId ?? null,
          dueDate: t.dueDate ?? "",
          estimatedHours: t.estimatedHours != null ? String(t.estimatedHours) : "",
          assigneeIds: (t.assignees ?? []).map((a) => a.id ?? a.teamMemberId).filter(Boolean),
          checklist: Array.isArray(t.checklist) ? t.checklist : [],
          tags: Array.isArray(t.tags) ? t.tags : [],
        });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [taskId, mode, createInColumnId]);

  // ── Auto-save (solo modo view) ────────────────────────────────────────
  const persistField = useCallback(
    async (patch) => {
      if (mode !== "view" || !taskId) return;
      setSaveStatus("saving");
      try {
        const r = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => null);
          throw new Error(j?.error || "Error guardando");
        }
        setSaveStatus("saved");
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => setSaveStatus("idle"), 1200);
        onSaved?.();
      } catch (e) {
        setSaveStatus("error");
        setError(e.message);
      }
    },
    [mode, taskId, onSaved]
  );

  // ── Crear (modo create) ───────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.title.trim()) {
      setError("El título es obligatorio");
      return;
    }
    setSaveStatus("saving");
    setError(null);
    try {
      const body = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: form.priority,
        boardColumnId: form.boardColumnId ?? undefined,
        phaseId: form.phaseId ?? undefined,
        milestoneId: form.milestoneId ?? undefined,
        dueDate: form.dueDate || undefined,
        estimatedHours: form.estimatedHours === "" ? undefined : Number(form.estimatedHours),
        assigneeIds: form.assigneeIds,
        checklist: form.checklist,
        tags: form.tags,
      };
      const r = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error creando tarea");
      setSaveStatus("saved");
      onCreated?.(j.data?.id);
    } catch (e) {
      setSaveStatus("error");
      setError(e.message);
    }
  };

  // ── Borrar ────────────────────────────────────────────────────────────
  const remove = async () => {
    if (!taskId) return;
    if (!confirm("¿Eliminar esta tarea? Esta acción no se puede deshacer.")) return;
    try {
      const r = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || "Error borrando");
      }
      onDeleted?.();
    } catch (e) {
      setError(e.message);
    }
  };

  // ── Helpers de checklist + tags ───────────────────────────────────────
  const addChecklistItem = () => {
    const text = newChecklistItem.trim();
    if (!text) return;
    const next = [...form.checklist, { id: crypto.randomUUID(), text, done: false }];
    setForm({ ...form, checklist: next });
    setNewChecklistItem("");
    if (mode === "view") persistField({ checklist: next });
  };
  const toggleChecklistItem = (id) => {
    const next = form.checklist.map((it) => (it.id === id ? { ...it, done: !it.done } : it));
    setForm({ ...form, checklist: next });
    if (mode === "view") persistField({ checklist: next });
  };
  const removeChecklistItem = (id) => {
    const next = form.checklist.filter((it) => it.id !== id);
    setForm({ ...form, checklist: next });
    if (mode === "view") persistField({ checklist: next });
  };
  const addTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    if (form.tags.includes(tag)) {
      setNewTag("");
      return;
    }
    const next = [...form.tags, tag];
    setForm({ ...form, tags: next });
    setNewTag("");
    if (mode === "view") persistField({ tags: next });
  };
  const removeTag = (tag) => {
    const next = form.tags.filter((t) => t !== tag);
    setForm({ ...form, tags: next });
    if (mode === "view") persistField({ tags: next });
  };

  const toggleAssignee = (tmId) => {
    const next = form.assigneeIds.includes(tmId)
      ? form.assigneeIds.filter((id) => id !== tmId)
      : [...form.assigneeIds, tmId];
    setForm({ ...form, assigneeIds: next });
    if (mode === "view") persistField({ assigneeIds: next });
  };

  const isCreate = mode === "create";

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 z-40"
        aria-hidden="true"
      />
      <aside
        className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] lg:w-[600px] bg-white border-l border-neutral-200 shadow-xl z-50 flex flex-col"
        role="dialog"
        aria-label={isCreate ? "Nueva tarea" : "Detalle de tarea"}
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-neutral-200 flex items-start gap-3">
          <input
            className="flex-1 text-lg font-medium text-neutral-800 bg-transparent outline-none border-b border-transparent focus:border-neutral-300 transition"
            placeholder="Título de la tarea"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            onBlur={(e) => {
              if (mode === "view" && e.target.value.trim() && e.target.value !== task?.title) {
                persistField({ title: e.target.value.trim() });
              }
            }}
          />
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 text-xl leading-none w-8 h-8 flex items-center justify-center"
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>

        {/* Status row */}
        <div className="px-5 py-2 border-b border-neutral-100 flex items-center justify-between text-xs">
          {isCreate ? (
            <span className="text-neutral-500">Nueva tarea</span>
          ) : (
            <SaveStatusIndicator status={saveStatus} />
          )}
          {error && <span className="text-rose-600">{error}</span>}
        </div>

        {loading ? (
          <div className="flex-1 p-6 text-sm text-neutral-400">Cargando...</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Columna + Prioridad */}
            <div className="grid grid-cols-2 gap-3">
              <Section label="Columna">
                <Select
                  className={inputCls}
                  value={form.boardColumnId ?? ""}
                  onChange={(val) => {
                    const v = val || null;
                    setForm({ ...form, boardColumnId: v });
                    if (mode === "view") persistField({ boardColumnId: v });
                  }}
                  options={[
                    { value: "", label: "— Sin columna —" },
                    ...columns.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </Section>
              <Section label="Prioridad">
                <Select
                  className={inputCls}
                  value={form.priority}
                  onChange={(val) => {
                    setForm({ ...form, priority: val });
                    if (mode === "view") persistField({ priority: val });
                  }}
                  options={TASK_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
                />
              </Section>
            </div>

            {/* Descripción */}
            <Section label="Descripción">
              <textarea
                className={inputCls}
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                onBlur={(e) => {
                  if (mode === "view" && e.target.value !== (task?.description ?? "")) {
                    persistField({ description: e.target.value });
                  }
                }}
                placeholder="Notas, contexto, criterios de aceptación..."
              />
            </Section>

            {/* Fecha + Horas */}
            <div className="grid grid-cols-2 gap-3">
              <Section label="Fecha límite">
                <input
                  type="date"
                  className={inputCls}
                  value={form.dueDate ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setForm({ ...form, dueDate: v });
                    if (mode === "view") persistField({ dueDate: v });
                  }}
                />
              </Section>
              <Section label="Horas estimadas">
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className={inputCls}
                  value={form.estimatedHours}
                  onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })}
                  onBlur={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    if (mode === "view") persistField({ estimatedHours: v });
                  }}
                />
              </Section>
            </div>

            {/* Fase + Hito */}
            <div className="grid grid-cols-2 gap-3">
              <Section label="Fase">
                <Select
                  className={inputCls}
                  value={form.phaseId ?? ""}
                  onChange={(val) => {
                    const v = val || null;
                    setForm({ ...form, phaseId: v });
                    if (mode === "view") persistField({ phaseId: v });
                  }}
                  options={[
                    { value: "", label: "— Sin fase —" },
                    ...phases.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </Section>
              <Section label="Hito">
                <Select
                  className={inputCls}
                  value={form.milestoneId ?? ""}
                  onChange={(val) => {
                    const v = val || null;
                    setForm({ ...form, milestoneId: v });
                    if (mode === "view") persistField({ milestoneId: v });
                  }}
                  options={[
                    { value: "", label: "— Sin hito —" },
                    ...milestones.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
              </Section>
            </div>

            {/* Asignados */}
            <Section label={`Asignados (${form.assigneeIds.length})`}>
              {teamMembers.length === 0 ? (
                <p className="text-xs text-neutral-400">Sin miembros disponibles en el equipo.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {teamMembers.map((tm) => {
                    const checked = form.assigneeIds.includes(tm.id);
                    return (
                      <button
                        key={tm.id}
                        onClick={() => toggleAssignee(tm.id)}
                        className={
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-full text-xs border transition " +
                          (checked
                            ? "bg-neutral-800 text-white border-neutral-800"
                            : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400")
                        }
                      >
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={
                            checked
                              ? { background: "white", color: "#262626" }
                              : { background: tm.avatarColor ?? "#E5E5E5", color: "white" }
                          }
                        >
                          {initials(tm.displayName)}
                        </span>
                        {tm.displayName}
                      </button>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Checklist */}
            <Section label={`Checklist (${form.checklist.filter((it) => it.done).length}/${form.checklist.length})`}>
              <ul className="space-y-1 mb-2">
                {form.checklist.map((it) => (
                  <li key={it.id} className="flex items-center gap-2 group">
                    <input
                      type="checkbox"
                      checked={!!it.done}
                      onChange={() => toggleChecklistItem(it.id)}
                      className="rounded"
                    />
                    <span className={`flex-1 text-sm ${it.done ? "line-through text-neutral-400" : "text-neutral-700"}`}>
                      {it.text}
                    </span>
                    <button
                      onClick={() => removeChecklistItem(it.id)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-rose-600 hover:text-rose-700 transition-opacity"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input
                  className={inputCls + " text-xs"}
                  placeholder="+ Añadir ítem"
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChecklistItem(); } }}
                />
                <button
                  onClick={addChecklistItem}
                  disabled={!newChecklistItem.trim()}
                  className="px-3 py-2 rounded-lg bg-neutral-800 text-white text-xs disabled:opacity-50"
                >
                  +
                </button>
              </div>
            </Section>

            {/* Tags */}
            <Section label="Etiquetas">
              <div className="flex flex-wrap gap-1 mb-2">
                {form.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-neutral-100 text-neutral-700 border border-neutral-200">
                    {t}
                    <button onClick={() => removeTag(t)} className="text-rose-600 hover:text-rose-700">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className={inputCls + " text-xs"}
                  placeholder="+ Etiqueta"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                />
                <button
                  onClick={addTag}
                  disabled={!newTag.trim()}
                  className="px-3 py-2 rounded-lg bg-neutral-800 text-white text-xs disabled:opacity-50"
                >
                  +
                </button>
              </div>
            </Section>
          </div>
        )}

        {/* Footer */}
        <footer className="px-5 py-3 border-t border-neutral-200 flex items-center justify-between">
          {isCreate ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-neutral-600 hover:bg-neutral-100"
              >
                Cancelar
              </button>
              <button
                onClick={submitCreate}
                disabled={!form.title.trim() || saveStatus === "saving"}
                className="px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium disabled:opacity-50"
              >
                {saveStatus === "saving" ? "Creando..." : "Crear tarea"}
              </button>
            </>
          ) : (
            <button
              onClick={remove}
              className="px-4 py-2 rounded-lg border border-rose-200 text-sm text-rose-700 hover:bg-rose-50"
            >
              Eliminar tarea
            </button>
          )}
        </footer>
      </aside>
    </>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
