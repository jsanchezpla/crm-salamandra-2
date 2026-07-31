"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select.jsx";
import PriorityBadge, { PRIORITY_OPTIONS } from "@/components/projects/PriorityBadge.jsx";

/**
 * AiProjectModal — drawer lateral para crear un proyecto entero desde un
 * prompt con IA.
 *
 * Paso 1 (prompt): textarea + selector opcional de cliente + "Generar con IA"
 *   → POST /api/projects/ai/generate  { prompt, clientId? } → { plan, fake }
 * Paso 2 (preview): cabecera editable inline + fases en acordeón con tareas,
 *   hitos y miembros. "Crear proyecto"
 *   → POST /api/projects/ai/create    { plan, clientId? } → { project }
 *   → router.push('/proyectos/' + id)
 *
 * Reglas:
 *   - top-14 lg:top-0 (regla #13: respeta la barra móvil).
 *   - Backdrop z-40 + panel z-50.
 *   - Los errores del backend (503 sin clave, 403 veto/demo) se muestran
 *     tal cual en un banner rojo.
 */

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const ROLE_LABELS = { lead: "Lead", member: "Miembro", viewer: "Observador" };

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("es-ES") : "—";
}
function initials(name) {
  if (!name) return "??";
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}

export default function AiProjectModal({ clients = [], onClose }) {
  const router = useRouter();

  const [step, setStep] = useState("prompt"); // "prompt" | "preview"
  const [prompt, setPrompt] = useState("");
  const [clientId, setClientId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const [plan, setPlan] = useState(null);
  const [fake, setFake] = useState(false);
  const [openPhases, setOpenPhases] = useState(new Set());

  // Equipo del tenant, para pintar nombres de asignados y miembros del plan.
  const [teamMembers, setTeamMembers] = useState([]);
  useEffect(() => {
    fetch("/api/team?limit=200")
      .then((r) => r.json())
      .then((j) => setTeamMembers(j?.data?.members ?? j?.data ?? []))
      .catch(() => {});
  }, []);

  const memberById = useMemo(() => {
    const map = new Map();
    for (const tm of teamMembers) map.set(tm.id, tm);
    return map;
  }, [teamMembers]);

  const memberName = (id) => memberById.get(id)?.displayName ?? "—";

  const totalTasks = useMemo(
    () => (plan?.phases ?? []).reduce((acc, ph) => acc + (ph.tasks?.length ?? 0), 0),
    [plan]
  );

  // ── Paso 1 → generar ───────────────────────────────────────────────────
  const generate = async () => {
    if (prompt.trim().length < 10) {
      setError("Describe el proyecto con un poco más de detalle (mínimo 10 caracteres)");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch("/api/projects/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), clientId: clientId || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error generando el proyecto");
      setPlan(j?.data?.plan ?? null);
      setFake(!!j?.data?.fake);
      setOpenPhases(new Set([0]));
      setStep("preview");
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // ── Paso 2 → crear ─────────────────────────────────────────────────────
  const create = async () => {
    if (!plan) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/projects/ai/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, clientId: clientId || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error creando el proyecto");
      const newId = j?.data?.project?.id ?? j?.data?.id;
      if (newId) {
        router.push(`/proyectos/${newId}`);
      } else {
        onClose?.();
      }
    } catch (e) {
      setError(e.message);
      setCreating(false);
    }
  };

  const togglePhase = (idx) => {
    setOpenPhases((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const setPlanField = (field, value) => {
    setPlan((p) => ({ ...p, [field]: value }));
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/40 z-40" aria-hidden="true" />
      <aside
        className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[520px] lg:w-[640px] bg-white border-l border-neutral-200 shadow-2xl z-50 flex flex-col"
        role="dialog"
        aria-label="Crear proyecto con IA"
      >
        <header className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="font-[Fraunces] text-xl text-neutral-800">
            <span aria-hidden="true">✦</span> Crear proyecto con IA
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 text-xl leading-none w-8 h-8 flex items-center justify-center"
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>

        {error && (
          <div className="mx-5 mt-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* ── Paso 1: prompt ─────────────────────────────────────────────── */}
        {step === "prompt" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Describe el proyecto
              </label>
              <textarea
                className={inputCls}
                rows={8}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={4000}
                placeholder="Lanzamiento de la nueva web: diseño en enero, desarrollo en febrero, pruebas y publicación en marzo. Participan Marta (diseño) y Jorge (desarrollo)..."
              />
              <p className="mt-1 text-xs text-neutral-400">
                La IA propondrá nombre, fases, tareas, hitos y miembros. Podrás revisarlo todo antes de crear nada.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Cliente (opcional)</label>
              <Select
                className={inputCls}
                value={clientId}
                onChange={(v) => setClientId(v)}
                placeholder="— Sin cliente (proyecto interno) —"
                options={[
                  { value: "", label: "— Sin cliente (proyecto interno) —" },
                  ...clients.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
          </div>
        )}

        {/* ── Paso 2: vista previa ───────────────────────────────────────── */}
        {step === "preview" && plan && (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {fake && (
              <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                Vista previa generada en modo demostración
              </div>
            )}

            {/* Cabecera editable */}
            <section className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre</label>
                <input
                  className={inputCls}
                  value={plan.name ?? ""}
                  maxLength={200}
                  onChange={(e) => setPlanField("name", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Descripción</label>
                <textarea
                  className={inputCls}
                  rows={3}
                  value={plan.description ?? ""}
                  onChange={(e) => setPlanField("description", e.target.value || null)}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Prioridad</label>
                  <Select
                    className={inputCls}
                    value={plan.priority ?? "medium"}
                    onChange={(v) => setPlanField("priority", v)}
                    options={PRIORITY_OPTIONS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Inicio</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={plan.startDate ?? ""}
                    onChange={(e) => setPlanField("startDate", e.target.value || null)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Fecha límite</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={plan.dueDate ?? ""}
                    onChange={(e) => setPlanField("dueDate", e.target.value || null)}
                  />
                </div>
              </div>
              {plan.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {plan.tags.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-full text-[11px] bg-neutral-100 text-neutral-600 border border-neutral-200"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* Fases en acordeón */}
            <section>
              <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                Fases ({plan.phases?.length ?? 0}) · {totalTasks} tarea{totalTasks !== 1 ? "s" : ""}
              </h3>
              {(plan.phases ?? []).length === 0 ? (
                <p className="text-sm text-neutral-400">Sin fases propuestas.</p>
              ) : (
                <ul className="space-y-2">
                  {plan.phases.map((ph, idx) => {
                    const open = openPhases.has(idx);
                    return (
                      <li key={idx} className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={() => togglePhase(idx)}
                          className="w-full px-3 py-2.5 flex items-center gap-2 text-left hover:bg-neutral-50 transition"
                        >
                          <span
                            className={`text-neutral-400 text-xs transition-transform ${open ? "rotate-90" : ""}`}
                            aria-hidden="true"
                          >
                            ▶
                          </span>
                          <span className="flex-1 text-sm font-medium text-neutral-800">{ph.name}</span>
                          <span className="text-xs text-neutral-400">
                            {ph.tasks?.length ?? 0} tarea{(ph.tasks?.length ?? 0) !== 1 ? "s" : ""}
                          </span>
                          {(ph.startDate || ph.endDate) && (
                            <span className="hidden sm:inline text-xs text-neutral-400">
                              {ph.startDate ? fmtDate(ph.startDate) : "?"} → {ph.endDate ? fmtDate(ph.endDate) : "?"}
                            </span>
                          )}
                        </button>
                        {open && (
                          <div className="px-3 pb-3 border-t border-neutral-100">
                            {ph.description && (
                              <p className="text-xs text-neutral-500 mt-2">{ph.description}</p>
                            )}
                            <ul className="mt-2 space-y-2">
                              {(ph.tasks ?? []).map((t, ti) => (
                                <TaskPreview key={ti} task={t} memberName={memberName} />
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Hitos */}
            {(plan.milestones ?? []).length > 0 && (
              <section>
                <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                  Hitos ({plan.milestones.length})
                </h3>
                <ul className="space-y-1.5">
                  {plan.milestones.map((m, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-2 h-2 rounded-full bg-neutral-300 flex-shrink-0" aria-hidden="true" />
                      <span className="flex-1 text-neutral-700">{m.name}</span>
                      <span className="text-xs text-neutral-400">{fmtDate(m.dueDate)}</span>
                      {m.phaseIndex != null && plan.phases?.[m.phaseIndex] && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500 border border-neutral-200">
                          {plan.phases[m.phaseIndex].name}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Miembros */}
            {(plan.members ?? []).length > 0 && (
              <section>
                <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                  Miembros ({plan.members.length})
                </h3>
                <ul className="space-y-2">
                  {plan.members.map((m, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <span className="w-7 h-7 rounded-full bg-neutral-200 flex items-center justify-center text-[11px] font-medium text-neutral-600">
                        {initials(memberName(m.teamMemberId))}
                      </span>
                      <span className="flex-1 text-neutral-800">{memberName(m.teamMemberId)}</span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] border bg-neutral-100 text-neutral-600 border-neutral-200">
                        {ROLE_LABELS[m.role] ?? m.role}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="px-5 py-3 border-t border-neutral-200 flex items-center gap-2">
          {step === "prompt" ? (
            <>
              <button
                type="button"
                onClick={generate}
                disabled={generating || prompt.trim().length < 10}
                className="flex-1 px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium hover:bg-neutral-700 disabled:opacity-50 transition"
              >
                {generating ? "Generando..." : "Generar con IA"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50"
              >
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setStep("prompt"); setError(null); }}
                disabled={creating}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                Volver a generar
              </button>
              <button
                type="button"
                onClick={create}
                disabled={creating || !plan?.name?.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium hover:bg-neutral-700 disabled:opacity-50 transition"
              >
                {creating ? "Creando..." : "Crear proyecto"}
              </button>
            </>
          )}
        </footer>
      </aside>
    </>
  );
}

function TaskPreview({ task, memberName }) {
  const [showChecklist, setShowChecklist] = useState(false);
  const checklist = Array.isArray(task.checklist) ? task.checklist : [];

  return (
    <li className="p-2.5 rounded-lg border border-neutral-200 bg-neutral-50/50">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-neutral-800">{task.title}</div>
          {task.description && (
            <div className="text-xs text-neutral-500 mt-0.5 line-clamp-2">{task.description}</div>
          )}
        </div>
        <PriorityBadge value={task.priority ?? "medium"} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
        {task.dueDate && <span>{fmtDateShort(task.dueDate)}</span>}
        {task.estimatedHours != null && <span>{task.estimatedHours} h</span>}
        {(task.assigneeIds ?? []).length > 0 && (
          <span className="truncate">
            {task.assigneeIds.map((id) => memberName(id)).join(", ")}
          </span>
        )}
        {checklist.length > 0 && (
          <button
            type="button"
            onClick={() => setShowChecklist((v) => !v)}
            className="text-neutral-500 hover:text-neutral-700 underline decoration-dotted"
          >
            Checklist ({checklist.length}) {showChecklist ? "▴" : "▾"}
          </button>
        )}
      </div>
      {showChecklist && checklist.length > 0 && (
        <ul className="mt-2 space-y-1">
          {checklist.map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-neutral-600">
              <span className="w-3.5 h-3.5 rounded border border-neutral-300 bg-white flex-shrink-0" aria-hidden="true" />
              {typeof item === "string" ? item : item?.text}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function fmtDateShort(d) {
  return d ? new Date(d).toLocaleDateString("es-ES") : "—";
}
