"use client";

/**
 * NutricionRecetasModule — catálogo de recetas del recetario (Sprint 8.2).
 * Lista recetas (nombre + nº ingredientes + macros), crear/editar/archivar.
 * Solo nutri_laura (y demo por fallback del override).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import RecipeEditModal from "./RecipeEditModal.jsx";

function fmt(v) {
  return v === null || v === undefined ? "—" : Math.round(v * 10) / 10;
}

export default function NutricionRecetasModule() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // recipe | "new" | null
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async (query) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/nutricion/recipes?q=${encodeURIComponent(query ?? "")}&limit=100`);
      const j = await r.json();
      setItems(j.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(q), 300);
    return () => timer.current && clearTimeout(timer.current);
  }, [q, load]);

  async function archive(recipe) {
    if (!confirm(`¿Archivar la receta "${recipe.name}"?`)) return;
    const r = await fetch(`/api/nutricion/recipes/${recipe.id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 204) {
      const j = await r.json().catch(() => ({}));
      setToast(j.error || "No se pudo archivar");
      return;
    }
    setToast("Receta archivada");
    load(q);
  }

  function onSaved() {
    setEditing(null);
    setToast("Receta guardada");
    load(q);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 lg:px-8 pt-6 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Nutrición · Recetario</div>
          <h1 className="text-xl font-semibold text-gray-900">Recetas</h1>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: "var(--color-primary)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Nueva receta
        </button>
      </div>

      <div className="px-4 lg:px-8 pb-3">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar receta…"
          className="w-full sm:max-w-sm px-3 py-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
        />
      </div>

      <div className="flex-1 overflow-auto px-4 lg:px-8 pb-8">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            {q ? "No hay recetas que coincidan." : "Aún no hay recetas. Crea la primera."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((r) => (
              // Toda la card abre el editor (Nutrinotas item 4): también la zona
              // de macros P/C/G/F. El botón de archivar corta la propagación.
              <div
                key={r.id}
                onClick={() => setEditing(r)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(r); } }}
                className="border border-gray-200 rounded-xl bg-white p-4 hover:shadow-sm hover:border-[var(--color-primary)]/30 transition group cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-left flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{r.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{r.ingredientCount} ingrediente{r.ingredientCount === 1 ? "" : "s"}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); archive(r); }}
                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                    aria-label="Archivar"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2m-9 0v12a2 2 0 002 2h6a2 2 0 002-2V7" /></svg>
                  </button>
                </div>
                {r.description && <div className="text-xs text-gray-500 mt-2 line-clamp-2">{r.description}</div>}
                <div className="mt-3 flex gap-3 text-[11px] text-gray-500 border-t border-gray-50 pt-2">
                  <span>P <strong>{fmt(r.macros?.protein)}</strong></span>
                  <span>C <strong>{fmt(r.macros?.carbs)}</strong></span>
                  <span>G <strong>{fmt(r.macros?.fat)}</strong></span>
                  <span>F <strong>{fmt(r.macros?.fiber)}</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <RecipeEditModal
          recipe={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function Toast({ msg, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-gray-900 text-white text-xs px-4 py-2.5 shadow-lg">{msg}</div>
  );
}
