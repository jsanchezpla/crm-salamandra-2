"use client";

import { useMemo, useState } from "react";
import SECTORES from "./sectores.json";

// Normaliza para buscar sin distinguir mayúsculas ni acentos (café → cafe).
const norm = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Selector de sector para "Buscar nuevos": un acordeón por cada sector
 * (categoría) con los tipos de empresa dentro, en nombre plano. Todos los
 * grupos empiezan plegados. El buscador filtra por nombre de sector O por tipo
 * de empresa, según lo que se escriba. El valor elegido es el tipo (string).
 */
export default function SectorPicker({ value, onChange }) {
  const [query, setQuery] = useState("");
  const [openCats, setOpenCats] = useState(() => new Set());

  const q = norm(query.trim());
  const isSearching = q.length > 0;

  // Al buscar: si el término coincide con el nombre del sector se muestran
  // todos sus tipos; si no, solo los tipos que coincidan. Sin término, todos.
  const groups = useMemo(() => {
    if (!q) return SECTORES.map((c) => ({ categoria: c.categoria, sectores: c.sectores }));
    return SECTORES.map((c) => {
      const catMatch = norm(c.categoria).includes(q);
      const sectores = catMatch ? c.sectores : c.sectores.filter((s) => norm(s).includes(q));
      return { categoria: c.categoria, sectores };
    }).filter((g) => g.sectores.length > 0);
  }, [q]);

  const toggleCat = (cat) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden bg-white">
      {/* Buscador general (sector o tipo de empresa) */}
      <div className="p-2 border-b border-neutral-100">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar sector o tipo de empresa…"
          className="w-full rounded-md px-3 py-2 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-400"
        />
      </div>

      {/* Selección actual */}
      {value && (
        <div className="px-3 py-2 flex items-center justify-between bg-emerald-50/60 border-b border-neutral-100">
          <span className="text-xs text-neutral-600 truncate">
            Seleccionado: <span className="font-medium text-neutral-800">{value}</span>
          </span>
          <button
            type="button"
            onClick={() => onChange("")}
            className="shrink-0 text-xs text-neutral-400 hover:text-neutral-700"
          >
            Quitar
          </button>
        </div>
      )}

      {/* Lista de acordeones */}
      <div className="max-h-72 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-3 py-4 text-xs text-neutral-400">Sin resultados para «{query}».</p>
        ) : (
          groups.map((g) => {
            const open = isSearching || openCats.has(g.categoria);
            return (
              <div key={g.categoria} className="border-b border-neutral-100 last:border-0">
                <button
                  type="button"
                  onClick={() => toggleCat(g.categoria)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-neutral-50 transition-colors"
                >
                  <span className="text-sm font-medium text-neutral-700">{g.categoria}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-neutral-400">{g.sectores.length}</span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className={`w-4 h-4 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </button>

                {open && (
                  <ul className="pb-1">
                    {g.sectores.map((s) => {
                      const active = s === value;
                      return (
                        <li key={s}>
                          <button
                            type="button"
                            onClick={() => onChange(s)}
                            className={`w-full text-left pl-6 pr-3 py-1.5 text-sm transition-colors ${
                              active ? "text-white" : "text-neutral-600 hover:bg-neutral-50"
                            }`}
                            style={active ? { backgroundColor: "var(--color-primary)" } : undefined}
                          >
                            {s}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
