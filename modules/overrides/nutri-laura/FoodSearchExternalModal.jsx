"use client";

/**
 * FoodSearchExternalModal — busca alimentos en OpenFoodFacts vía
 * /api/nutricion/foods/search-external y los importa al catálogo con
 * /api/nutricion/foods/import-external.
 *
 * Auto-search 500 ms tras teclear (mín. 2 caracteres). Si OFF cae,
 * muestra mensaje claro sin romper el catálogo local.
 */

import { useEffect, useState } from "react";

function fmtMacro(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1).replace(/\.0$/, "")} g`;
}

export default function FoodSearchExternalModal({ onClose, onImported }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [externalError, setExternalError] = useState(false);
  const [importingId, setImportingId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 500);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (debounced.length < 2) {
      setItems([]);
      setExternalError(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/nutricion/foods/search-external?q=${encodeURIComponent(debounced)}`
        );
        const j = await r.json();
        if (cancelled) return;
        if (!j.ok) {
          setItems([]);
          setError(j.error || "Error al buscar");
          return;
        }
        setItems(Array.isArray(j.items) ? j.items : []);
        setExternalError(!!j.external_error);
      } catch (err) {
        if (!cancelled) {
          setItems([]);
          setExternalError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleImport(item) {
    setImportingId(item.external_id);
    setError(null);
    try {
      const r = await fetch("/api/nutricion/foods/import-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ external_id: item.external_id }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Error al importar");
        return;
      }
      onImported?.(j.data);
    } catch (err) {
      setError(err.message || "Error de red");
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside
        className="
          relative ml-auto bg-white shadow-2xl overflow-y-auto
          w-full max-w-xl flex flex-col
          fixed right-0 top-14 lg:top-0 bottom-0
        "
      >
        <header className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0 sticky top-0 bg-white z-10">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">
              OpenFoodFacts
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Buscar online</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="relative">
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
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Atún en lata, plátano, garbanzos…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            Busca por nombre. Resultados de OpenFoodFacts — base de datos
            abierta de productos alimentarios.
          </p>
        </div>

        <div className="flex-1 px-6 py-4 space-y-3 overflow-y-auto">
          {loading && (
            <div className="py-8 text-center text-sm text-gray-400">
              Buscando…
            </div>
          )}

          {!loading && externalError && (
            <div className="px-3 py-3 bg-amber-50 border border-amber-100 rounded-md text-xs text-amber-800">
              No hemos podido conectar con OpenFoodFacts. Inténtalo en unos minutos o
              crea el alimento manualmente desde el catálogo.
            </div>
          )}

          {!loading && !externalError && debounced.length >= 2 && items.length === 0 && (
            <div className="py-8 text-center text-sm text-gray-400">
              Sin resultados para "{debounced}".
            </div>
          )}

          {!loading && debounced.length < 2 && (
            <div className="py-8 text-center text-xs text-gray-400">
              Escribe al menos 2 caracteres para buscar.
            </div>
          )}

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">
              {error}
            </div>
          )}

          {items.map((item) => (
            <article
              key={item.external_id}
              className="bg-white border border-gray-200 rounded-lg p-3 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 text-sm leading-tight">
                  {item.name || "(sin nombre)"}
                </div>
                {item.brand && (
                  <div className="text-[11px] text-gray-500 mt-0.5">{item.brand}</div>
                )}
                <div className="mt-1.5 grid grid-cols-4 gap-2 text-[11px] text-gray-600">
                  <Macro label="Prot." value={item.protein_per_100} />
                  <Macro label="Carbs" value={item.carbs_per_100} />
                  <Macro label="Grasas" value={item.fat_per_100} />
                  <Macro label="Fibra" value={item.fiber_per_100} />
                </div>
                <div className="text-[10px] text-gray-400 mt-1 font-mono">
                  code: {item.external_id}
                </div>
              </div>
              <button
                onClick={() => handleImport(item)}
                disabled={importingId === item.external_id}
                className="shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 transition whitespace-nowrap"
              >
                {importingId === item.external_id ? "Importando…" : "Añadir a mi catálogo"}
              </button>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Macro({ label, value }) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] uppercase text-gray-400">{label}</div>
      <div className="font-mono">{fmtMacro(value)}</div>
    </div>
  );
}
