"use client";

/**
 * NutricionPlantillasModule — listado de plantillas de plan nutricional
 * para la vista admin. Sprint nutri-laura Recetario C3.
 *
 * Grid responsive de cards:
 *   - 1 col móvil
 *   - 2 cols tablet (sm)
 *   - 3-4 cols desktop (lg+)
 *
 * Cada card muestra:
 *   - Nombre de la plantilla
 *   - Lista resumida de comidas con su nº de opciones
 *   - Indicador de asignaciones activas
 *   - Acciones: Editar (modal), Duplicar (copy + abre nueva), Archivar
 *
 * El listado pega contra `GET /api/nutricion/plans?type=template&withSummary=true`
 * para obtener todo lo necesario en una sola llamada (sin N+1).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import PlanEditorModal from "./PlanEditorModal.jsx";

export default function NutricionPlantillasModule() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("type", "template");
      params.set("withSummary", "true");
      params.set("limit", "100");
      if (debouncedSearch) params.set("q", debouncedSearch);
      const r = await fetch(`/api/nutricion/plans?${params}`);
      const j = await r.json();
      if (j.ok) {
        setItems(j.items || []);
        setTotal(j.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    const name = window.prompt("Nombre del nuevo menú", "Menú 1");
    if (!name || !name.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/nutricion/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const j = await r.json();
      if (j.ok) {
        setToast({ kind: "ok", text: "Menú creado" });
        await load();
        setEditingId(j.data?.id ?? null);
      } else {
        setToast({ kind: "err", text: j.error || "No se pudo crear" });
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDuplicate(plan) {
    const r = await fetch(`/api/nutricion/plans/${plan.id}/duplicate`, { method: "POST" });
    const j = await r.json();
    if (j.ok) {
      setToast({ kind: "ok", text: "Menú duplicado" });
      await load();
      setEditingId(j.data?.id ?? null);
    } else {
      setToast({ kind: "err", text: j.error || "No se pudo duplicar" });
    }
  }

  async function handleArchive(plan) {
    if (plan.activeAssignmentsCount > 0) {
      const cont = window.confirm(
        `Este menú tiene ${plan.activeAssignmentsCount} asignaciones activas. ` +
        `Archivarla NO afecta a los planes ya asignados (siguen vivos), pero la ` +
        `plantilla dejará de aparecer en el listado. ¿Continuar?`
      );
      if (!cont) return;
    } else if (!window.confirm(`¿Archivar el menú "${plan.name}"?`)) {
      return;
    }
    const r = await fetch(`/api/nutricion/plans/${plan.id}`, { method: "DELETE" });
    if (r.status === 204) {
      setToast({ kind: "ok", text: "Menú archivado" });
      load();
    } else {
      const j = await r.json().catch(() => ({}));
      setToast({ kind: "err", text: j.error || "Error al archivar" });
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-accent,#F7F1EB)]/30">
      {/* Header */}
      <div className="px-4 sm:px-6 lg:px-10 pt-6 lg:pt-8 pb-4 lg:pb-5 shrink-0 border-b border-gray-100 bg-white">
        <div className="flex items-start lg:items-end justify-between gap-4 flex-wrap mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400 mb-1">
              Nutrición · Recetario
            </div>
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900 leading-tight">
              Menús
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              {total} {total === 1 ? "menú" : "menús"} guardados.
            </p>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 transition flex items-center gap-1"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nuevo menú
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar menús por nombre…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-3 sm:px-4 lg:px-10 py-4 lg:py-6">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">Cargando menús…</div>
          ) : items.length === 0 ? (
            <EmptyState onCreate={handleCreate} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-4">
              {items.map((p) => (
                <PlantillaCard
                  key={p.id}
                  plan={p}
                  onEdit={() => setEditingId(p.id)}
                  onDuplicate={() => handleDuplicate(p)}
                  onArchive={() => handleArchive(p)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {editingId && (
        <PlanEditorModal
          planId={editingId}
          // Pasamos el contador inicial de asignaciones para que el modal
          // pueda mostrar el banner "no se propaga" desde la primera carga
          // (sin esperar a un PATCH posterior).
          initialAssignmentsCount={
            items.find((p) => p.id === editingId)?.activeAssignmentsCount ?? 0
          }
          onClose={() => { setEditingId(null); load(); }}
          onSaved={() => { /* el reload lo hace onClose */ }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-md shadow-lg text-sm font-medium ${
            toast.kind === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function PlantillaCard({ plan, onEdit, onDuplicate, onArchive }) {
  const meals = Array.isArray(plan.mealsSummary) ? plan.mealsSummary : [];
  const assignments = plan.activeAssignmentsCount ?? 0;

  return (
    <article
      className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 flex flex-col gap-3 cursor-pointer hover:border-[var(--color-primary)]/40 hover:shadow transition"
      onClick={onEdit}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate" title={plan.name}>
            {plan.name}
          </h3>
          {plan.description && (
            <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{plan.description}</p>
          )}
        </div>
        <div className="flex gap-0.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="text-gray-400 hover:text-[var(--color-primary)] transition p-1.5 -m-1.5"
            title="Duplicar"
            aria-label="Duplicar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4">
              <rect x="8" y="8" width="12" height="12" rx="2" />
              <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="text-gray-400 hover:text-red-600 transition p-1.5 -m-1.5"
            title="Archivar"
            aria-label="Archivar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-[60px]">
        {meals.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic">Sin comidas todavía.</p>
        ) : (
          <ul className="text-[11px] text-gray-700 space-y-0.5">
            {meals.slice(0, 5).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{m.name}</span>
                <span className="text-gray-400 shrink-0">
                  ({m.optionCount} {m.optionCount === 1 ? "op." : "ops."})
                </span>
              </li>
            ))}
            {meals.length > 5 && (
              <li className="text-[10px] text-gray-400">+ {meals.length - 5} más…</li>
            )}
          </ul>
        )}
      </div>

      <footer className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px]">
        {assignments > 0 ? (
          <span className="inline-flex px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium border border-[var(--color-primary)]/20">
            {assignments} {assignments === 1 ? "asignación activa" : "asignaciones activas"}
          </span>
        ) : (
          <span className="text-gray-400">Sin asignaciones</span>
        )}
        <span className="text-[var(--color-primary)] hover:underline">Editar →</span>
      </footer>
    </article>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div className="py-16 text-center bg-white border border-gray-200 rounded-xl max-w-xl mx-auto">
      <div className="text-base text-gray-700 font-medium">Aún no hay menús</div>
      <p className="text-xs text-gray-400 mt-1">
        Crea una plantilla reutilizable y úsala como base para tus pacientes.
      </p>
      <div className="mt-5">
        <button
          onClick={onCreate}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 transition"
        >
          Crea tu primera plantilla
        </button>
      </div>
    </div>
  );
}
