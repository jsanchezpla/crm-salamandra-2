"use client";

/**
 * NutricionFoodsModule — Catálogo de alimentos (Sprint C1 nutri-laura).
 *
 * Listado paginado (20 por página) con buscador, botón "Añadir alimento"
 * (modal FoodEditModal) y botón "Buscar online" (modal
 * FoodSearchExternalModal). Permite editar inline las 4 macros y archivar
 * con la papelera. Cambiar nombre / unidad / tags se hace desde el modal
 * de edición completo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import FoodEditModal from "./FoodEditModal.jsx";
import FoodSearchExternalModal from "./FoodSearchExternalModal.jsx";

const PAGE_SIZE = 20;

const UNIT_LABEL = { g: "g", ml: "ml", unidad: "unidad" };

function fmtMacro(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1).replace(/\.0$/, "");
}

export default function NutricionFoodsModule() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // food | "new"
  const [externalOpen, setExternalOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  // Debounce buscador (350ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      if (debouncedSearch) params.set("q", debouncedSearch);
      const r = await fetch(`/api/nutricion/foods?${params}`);
      const j = await r.json();
      if (j.ok) {
        setItems(j.items ?? []);
        setTotal(j.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  // Volver a página 1 al cambiar la búsqueda
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  async function patchFood(id, updates) {
    const r = await fetch(`/api/nutricion/foods/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const j = await r.json();
    if (j.ok) {
      setItems((prev) => prev.map((f) => (f.id === id ? { ...f, ...j.data } : f)));
      setToast({ kind: "ok", text: "Guardado" });
      return true;
    }
    setToast({ kind: "err", text: j.error || "Error al guardar" });
    return false;
  }

  async function archiveFood(id) {
    if (!window.confirm("¿Archivar este alimento? Quedará oculto del catálogo.")) return;
    const r = await fetch(`/api/nutricion/foods/${id}`, { method: "DELETE" });
    if (r.status === 204) {
      setToast({ kind: "ok", text: "Alimento archivado" });
      load();
    } else {
      const j = await r.json().catch(() => ({}));
      setToast({ kind: "err", text: j.error || "Error al archivar" });
    }
  }

  function handleSaved(saved, kind) {
    setEditing(null);
    setToast({
      kind: "ok",
      text: kind === "new" ? "Alimento añadido" : "Cambios guardados",
    });
    load();
  }

  function handleImported() {
    setExternalOpen(false);
    setToast({ kind: "ok", text: "Alimento añadido al catálogo" });
    load();
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-accent,#F7F1EB)]/30">
      {/* Header */}
      <div className="px-6 lg:px-10 pt-8 pb-5 shrink-0 border-b border-gray-100 bg-white">
        <div className="flex items-end justify-between gap-6 flex-wrap mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400 mb-1">
              Nutrición · Recetario
            </div>
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900 leading-tight">
              Catálogo de alimentos
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              {total} {total === 1 ? "alimento" : "alimentos"} en tu catálogo local.
            </p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <button
              onClick={() => setExternalOpen(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition flex items-center gap-1.5"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-3.5 h-3.5"
              >
                <circle cx="11" cy="11" r="7" />
                <path strokeLinecap="round" d="m20 20-3.5-3.5" />
              </svg>
              Buscar online
            </button>
            <button
              onClick={() => setEditing("new")}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 transition flex items-center gap-1"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                className="w-3.5 h-3.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Añadir alimento
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar alimentos por nombre…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 lg:px-10 py-6">
        <div className="max-w-6xl mx-auto">
          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">
              Cargando catálogo…
            </div>
          ) : items.length === 0 ? (
            <EmptyState onAdd={() => setEditing("new")} onSearch={() => setExternalOpen(true)} />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-2.5 font-semibold">Nombre</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Unidad</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Proteínas</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Carbs</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Grasas</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Fibra</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Origen</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((food) => (
                    <FoodRow
                      key={food.id}
                      food={food}
                      onEdit={() => setEditing(food)}
                      onArchive={() => archiveFood(food.id)}
                      onPatchMacro={(field, value) =>
                        patchFood(food.id, { [field]: value })
                      }
                    />
                  ))}
                </tbody>
              </table>

              {totalPages > 1 && (
                <Pagination page={page} totalPages={totalPages} onChange={setPage} />
              )}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <FoodEditModal
          food={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => handleSaved(saved, editing === "new" ? "new" : "edit")}
        />
      )}

      {externalOpen && (
        <FoodSearchExternalModal
          onClose={() => setExternalOpen(false)}
          onImported={handleImported}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-md shadow-lg text-sm font-medium ${
            toast.kind === "ok"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function FoodRow({ food, onEdit, onArchive, onPatchMacro }) {
  return (
    <tr className="hover:bg-gray-50/60">
      <td className="px-4 py-2.5">
        <div className="font-medium text-gray-900">{food.name}</div>
        {Array.isArray(food.tags) && food.tags.length > 0 && (
          <div className="mt-0.5 flex gap-1 flex-wrap">
            {food.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="inline-flex px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-center text-xs text-gray-600">
        {UNIT_LABEL[food.defaultUnit] ?? food.defaultUnit}
      </td>
      <EditableMacro value={food.proteinPer100} onSave={(v) => onPatchMacro("proteinPer100", v)} />
      <EditableMacro value={food.carbsPer100} onSave={(v) => onPatchMacro("carbsPer100", v)} />
      <EditableMacro value={food.fatPer100} onSave={(v) => onPatchMacro("fatPer100", v)} />
      <EditableMacro value={food.fiberPer100} onSave={(v) => onPatchMacro("fiberPer100", v)} />
      <td className="px-3 py-2.5 text-center">
        {food.source === "openfoodfacts" ? (
          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20">
            OpenFoodFacts
          </span>
        ) : (
          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
            Local
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <button
          onClick={onEdit}
          className="text-gray-400 hover:text-[var(--color-primary)] transition p-1"
          title="Editar"
          aria-label="Editar"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
          </svg>
        </button>
        <button
          onClick={onArchive}
          className="text-gray-400 hover:text-red-600 transition p-1 ml-1"
          title="Archivar"
          aria-label="Archivar"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

function EditableMacro({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit() {
    const trimmed = String(draft).trim();
    const next = trimmed === "" ? null : Number(trimmed);
    const current = value === null || value === undefined ? null : Number(value);
    if (next === current || (next === null && current === null)) {
      setEditing(false);
      return;
    }
    if (next !== null && !Number.isFinite(next)) {
      setEditing(false);
      setDraft(value ?? "");
      return;
    }
    const okSaved = await onSave(next);
    if (okSaved) setEditing(false);
    else setDraft(value ?? "");
  }

  if (editing) {
    return (
      <td className="px-3 py-1 text-right">
        <input
          autoFocus
          type="number"
          step="0.1"
          min="0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(value ?? "");
              setEditing(false);
            }
          }}
          className="w-20 px-2 py-1 text-xs text-right rounded border border-[var(--color-primary)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
        />
      </td>
    );
  }

  return (
    <td
      className="px-3 py-2.5 text-right text-xs text-gray-700 tabular-nums cursor-pointer hover:bg-gray-50"
      onClick={() => setEditing(true)}
      title="Click para editar"
    >
      {fmtMacro(value)}
    </td>
  );
}

function Pagination({ page, totalPages, onChange }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between border-t border-gray-100 bg-white">
      <div className="text-xs text-gray-500">
        Página {page} de {totalPages}
      </div>
      <div className="flex gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          Anterior
        </button>
        <button
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onAdd, onSearch }) {
  return (
    <div className="py-16 text-center bg-white border border-gray-200 rounded-xl">
      <div className="text-base text-gray-700 font-medium">Aún no hay alimentos en tu catálogo</div>
      <p className="text-xs text-gray-400 mt-1">
        Crea uno manualmente o búscalo en OpenFoodFacts.
      </p>
      <div className="mt-5 flex gap-2 items-center justify-center">
        <button
          onClick={onAdd}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 transition"
        >
          Añadir alimento
        </button>
        <button
          onClick={onSearch}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
        >
          Buscar online
        </button>
      </div>
    </div>
  );
}
