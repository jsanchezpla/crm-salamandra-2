"use client";

/**
 * RecipePickerModal — buscador de recetas para añadir a una comida del menú
 * (rediseño 2026-07-22). Se abre desde el "+ Añadir receta" de cada una de las
 * 5 grandes comidas del día.
 *
 * Cards con la foto del plato, nombre, nº de ingredientes/pasos y macros; clic
 * → se añade a la comida. Si la receta no existe todavía, el botón
 * "Crear receta" abre el editor completo (RecipeEditModal, con foto y pasos)
 * encima, y al guardar se añade directamente al menú sin pasos extra.
 */

import { useEffect, useRef, useState } from "react";
import RecipeEditModal from "./RecipeEditModal.jsx";

function fmt(v) {
  return v === null || v === undefined ? "—" : Math.round(v * 10) / 10;
}

export default function RecipePickerModal({ title, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false); // RecipeEditModal abierto
  const [adding, setAdding] = useState(null); // id de la receta en vuelo
  const timer = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Esc cierra el picker SOLO si el editor de crear receta no está encima.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !creating) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, creating]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/nutricion/recipes?q=${encodeURIComponent(q.trim())}&limit=30`);
        const j = await r.json();
        setItems(j.items ?? []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => timer.current && clearTimeout(timer.current);
  }, [q]);

  async function pick(recipe) {
    if (adding) return;
    setAdding(recipe.id);
    try {
      await onPick?.(recipe);
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <header className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Añadir receta</div>
            <h3 className="text-base font-semibold text-gray-900 truncate">{title}</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90"
            >
              + Crear receta
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1" aria-label="Cerrar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </header>

        <div className="px-5 py-3 shrink-0">
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar receta por nombre…"
            className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">Buscando…</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              {q.trim() ? (
                <>No hay recetas que coincidan con «{q.trim()}».<br />Créala con el botón «+ Crear receta».</>
              ) : (
                <>Aún no hay recetas en el recetario.<br />Crea la primera con «+ Crear receta».</>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {items.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={adding !== null}
                  onClick={() => pick(r)}
                  className="text-left border border-gray-200 rounded-lg overflow-hidden bg-white hover:border-[var(--color-primary)]/50 hover:shadow-sm transition disabled:opacity-60"
                >
                  {r.hasPhoto && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/nutricion/recipes/${r.id}/photo?v=${encodeURIComponent(r.updatedAt ?? "")}`}
                      alt={`Foto de ${r.name}`}
                      loading="lazy"
                      className="w-full h-24 object-cover border-b border-gray-100"
                    />
                  )}
                  <div className="p-3">
                    <div className="font-medium text-sm text-gray-900 truncate">
                      {adding === r.id ? "Añadiendo…" : r.name}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {r.ingredientCount} ing.
                      {Array.isArray(r.steps) && r.steps.length > 0 && <> · {r.steps.length} pasos</>}
                      <span className="ml-1">· P {fmt(r.macros?.protein)} C {fmt(r.macros?.carbs)} G {fmt(r.macros?.fat)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Crear receta sin salir del flujo: al guardar, se añade directamente. */}
      {creating && (
        <RecipeEditModal
          recipe={null}
          onClose={() => setCreating(false)}
          onSaved={async (data) => {
            setCreating(false);
            await pick(data);
          }}
        />
      )}
    </div>
  );
}
