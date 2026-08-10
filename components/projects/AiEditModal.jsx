"use client";

import { useState } from "react";

/**
 * AiEditModal — drawer lateral para reorganizar un proyecto existente con IA.
 *
 * Paso 1 (instrucción): textarea + "Proponer cambios"
 *   → POST /api/projects/[id]/ai/edit  { instruction }
 *   → { summary, operations, warnings, fake }
 * Paso 2 (revisión): summary arriba, lista de operaciones con icono por tipo
 *   y su `description`; las destructivas (deleteTask/deletePhase/removeMember)
 *   en rojo y con checkbox para excluirlas individualmente (por defecto todas
 *   marcadas). "Aplicar cambios"
 *   → POST /api/projects/[id]/ai/apply { operations } → { applied, skipped }
 * Paso 3 (hecho): cuántos cambios entraron y cuántos se descartaron.
 *   → el callback onApplied() del padre se dispara AL CERRAR, no al aplicar
 *     (el porqué, en `cerrar`).
 *
 * Reglas:
 *   - top-14 lg:top-0 (regla #13: respeta la barra móvil).
 *   - Backdrop z-40 + panel z-50.
 *   - Los errores del backend (503 sin clave, 403 veto/demo) se muestran
 *     tal cual en un banner rojo.
 */

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const DESTRUCTIVE_OPS = new Set(["deleteTask", "deletePhase", "removeMember"]);

const OP_META = {
  updateProject: { icon: "✎", cls: "bg-sky-50 text-sky-700 border-sky-100", label: "Proyecto" },
  createPhase: { icon: "+", cls: "bg-emerald-50 text-emerald-700 border-emerald-100", label: "Fase" },
  updatePhase: { icon: "✎", cls: "bg-sky-50 text-sky-700 border-sky-100", label: "Fase" },
  deletePhase: { icon: "×", cls: "bg-rose-50 text-rose-700 border-rose-100", label: "Fase" },
  createTask: { icon: "+", cls: "bg-emerald-50 text-emerald-700 border-emerald-100", label: "Tarea" },
  updateTask: { icon: "✎", cls: "bg-sky-50 text-sky-700 border-sky-100", label: "Tarea" },
  deleteTask: { icon: "×", cls: "bg-rose-50 text-rose-700 border-rose-100", label: "Tarea" },
  addMember: { icon: "+", cls: "bg-emerald-50 text-emerald-700 border-emerald-100", label: "Miembro" },
  removeMember: { icon: "×", cls: "bg-rose-50 text-rose-700 border-rose-100", label: "Miembro" },
};

export default function AiEditModal({ projectId, onClose, onApplied }) {
  const [step, setStep] = useState("instruction"); // "instruction" | "review" | "done"
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  const [proposal, setProposal] = useState(null); // { summary, operations, warnings, fake }
  const [excluded, setExcluded] = useState(new Set()); // índices excluidos
  const [result, setResult] = useState(null); // { applied, skipped }

  const operations = proposal?.operations ?? [];
  const includedCount = operations.filter((_, i) => !excluded.has(i)).length;

  // ── Paso 1 → proponer ──────────────────────────────────────────────────
  const propose = async () => {
    if (instruction.trim().length < 5) {
      setError("Describe qué quieres cambiar (mínimo 5 caracteres)");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/ai/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error proponiendo cambios");
      setProposal(j?.data ?? null);
      setExcluded(new Set());
      setStep("review");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Paso 2 → aplicar ───────────────────────────────────────────────────
  const apply = async () => {
    const selected = operations.filter((_, i) => !excluded.has(i));
    if (selected.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/ai/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operations: selected }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error aplicando cambios");
      setResult(j?.data ?? { applied: selected.length, skipped: 0 });
      setStep("done");
      // OJO: el refresco del padre NO va aquí, va al cerrar (ver `cerrar`).
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  };

  /**
   * Cerrar, y AL CERRAR refrescar al padre.
   *
   * El refresco iba pegado al «Aplicar cambios», y con eso la pantalla de
   * confirmación no se llegaba a ver: `onApplied` es el `fetchAll` de la página
   * del proyecto, que mientras recarga pinta «Cargando proyecto...» EN LUGAR de
   * la página — y con la página se va este drawer, que vuelve a montarse en el
   * paso 1. Los cambios sí se habían aplicado, pero quien lo pulsaba veía el
   * formulario vacío otra vez, que se lee como que ha fallado.
   *
   * Aplazarlo al cierre arregla las dos cosas: la confirmación se queda a la
   * vista y el proyecto se recarga igual, cuando ya no hay nada que tapar.
   */
  const cerrar = () => {
    if (result) onApplied?.();
    onClose();
  };

  const toggleExcluded = (idx) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <>
      <div onClick={cerrar} className="fixed inset-0 bg-black/40 z-40" aria-hidden="true" />
      <aside
        className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[520px] lg:w-[600px] bg-white border-l border-neutral-200 shadow-2xl z-50 flex flex-col"
        role="dialog"
        aria-label="Reorganizar proyecto con IA"
      >
        <header className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="font-[Fraunces] text-xl text-neutral-800">
            <span aria-hidden="true">✦</span> Reorganizar con IA
          </h2>
          <button
            onClick={cerrar}
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

        {/* ── Paso 1: instrucción ────────────────────────────────────────── */}
        {step === "instruction" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                ¿Qué quieres cambiar?
              </label>
              <textarea
                className={inputCls}
                rows={6}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                maxLength={2000}
                placeholder="Entra una persona nueva al equipo, reparte las tareas de Marta y añade una fase de QA antes de la entrega..."
              />
              <p className="mt-1 text-xs text-neutral-400">
                La IA propondrá una lista de operaciones. Nada se aplica hasta que las revises y confirmes.
              </p>
            </div>
          </div>
        )}

        {/* ── Paso 2: revisión ───────────────────────────────────────────── */}
        {step === "review" && proposal && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {proposal.fake && (
              <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                Propuesta generada en modo demostración
              </div>
            )}

            {proposal.summary && (
              <p className="text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2.5">
                {proposal.summary}
              </p>
            )}

            {(proposal.warnings ?? []).length > 0 && (
              <ul className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
                {proposal.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}

            <section>
              <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">
                Operaciones propuestas ({operations.length})
              </h3>
              {operations.length === 0 ? (
                <p className="text-sm text-neutral-400">
                  La IA no ha propuesto ningún cambio. Prueba a reformular la instrucción.
                </p>
              ) : (
                <ul className="space-y-2">
                  {operations.map((op, idx) => {
                    const meta = OP_META[op.op] ?? { icon: "•", cls: "bg-neutral-100 text-neutral-600 border-neutral-200", label: op.op };
                    const destructive = DESTRUCTIVE_OPS.has(op.op);
                    const isExcluded = excluded.has(idx);
                    return (
                      <li
                        key={idx}
                        className={
                          "flex items-start gap-3 p-3 rounded-lg border transition " +
                          (destructive
                            ? "border-rose-200 bg-rose-50/50"
                            : "border-neutral-200 bg-white") +
                          (isExcluded ? " opacity-50" : "")
                        }
                      >
                        {destructive && (
                          <input
                            type="checkbox"
                            className="mt-1 rounded"
                            checked={!isExcluded}
                            onChange={() => toggleExcluded(idx)}
                            aria-label="Incluir esta operación"
                          />
                        )}
                        <span
                          className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold flex-shrink-0 ${meta.cls}`}
                          aria-hidden="true"
                        >
                          {meta.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm ${destructive ? "text-rose-700" : "text-neutral-800"} ${isExcluded ? "line-through" : ""}`}>
                            {op.description ?? op.op}
                          </div>
                          <div className="text-[11px] text-neutral-400 mt-0.5">{meta.label}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* ── Paso 3: aplicado ───────────────────────────────────────────── */}
        {step === "done" && result && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-100 text-sm text-emerald-700">
              {result.applied} cambio{result.applied !== 1 ? "s" : ""} aplicado{result.applied !== 1 ? "s" : ""}
              {result.skipped > 0 && ` · ${result.skipped} descartado${result.skipped !== 1 ? "s" : ""}`}
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="px-5 py-3 border-t border-neutral-200 flex items-center gap-2">
          {step === "instruction" && (
            <>
              <button
                type="button"
                onClick={propose}
                disabled={loading || instruction.trim().length < 5}
                className="flex-1 px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium hover:bg-neutral-700 disabled:opacity-50 transition"
              >
                {loading ? "Analizando..." : "Proponer cambios"}
              </button>
              <button
                type="button"
                onClick={cerrar}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50"
              >
                Cancelar
              </button>
            </>
          )}
          {step === "review" && (
            <>
              <button
                type="button"
                onClick={() => { setStep("instruction"); setError(null); }}
                disabled={applying}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={applying || includedCount === 0}
                className="flex-1 px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium hover:bg-neutral-700 disabled:opacity-50 transition"
              >
                {applying
                  ? "Aplicando..."
                  : `Aplicar cambios (${includedCount})`}
              </button>
            </>
          )}
          {step === "done" && (
            <button
              type="button"
              onClick={cerrar}
              className="flex-1 px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium hover:bg-neutral-700 transition"
            >
              Cerrar
            </button>
          )}
        </footer>
      </aside>
    </>
  );
}
