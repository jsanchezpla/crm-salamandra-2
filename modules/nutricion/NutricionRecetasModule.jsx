"use client";

/**
 * NutricionRecetasModule — catálogo de recetas del recetario (Sprint 8.2).
 * Cards con FOTO del plato (rework 2026-07-22), nombre, nº ingredientes, nº de
 * pasos y macros. Crear/editar/archivar. Solo nutri_laura (y demo por fallback
 * del override).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import RecipeEditModal from "./RecipeEditModal.jsx";

function fmt(v) {
  return v === null || v === undefined ? "—" : Math.round(v * 10) / 10;
}

const POR_PAGINA = 48;
/** Atajos de tiempo. Son los que pide una consulta real, no una escala. */
const TIEMPOS = [
  { min: 10, label: "≤ 10 min" },
  { min: 20, label: "≤ 20 min" },
  { min: 30, label: "≤ 30 min" },
];

export default function NutricionRecetasModule() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // recipe | "new" | null
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  // Filtros. `sinAlergeno` va por EXCLUSIÓN: es como se usa de verdad —nadie
  // busca recetas CON gluten, se busca que no salgan—.
  const [facetas, setFacetas] = useState(null);
  const [tipo, setTipo] = useState("");
  const [sinAlergeno, setSinAlergeno] = useState([]);
  const [preferencia, setPreferencia] = useState([]);
  const [etiqueta, setEtiqueta] = useState([]);
  const [maxMinutos, setMaxMinutos] = useState(null);

  const load = useCallback(async (query, pag, f) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ q: query ?? "", page: String(pag), limit: String(POR_PAGINA) });
      if (f.tipo) p.set("tipo", f.tipo);
      if (f.sinAlergeno.length) p.set("sinAlergeno", f.sinAlergeno.join(","));
      if (f.preferencia.length) p.set("preferencia", f.preferencia.join(","));
      if (f.etiqueta.length) p.set("etiqueta", f.etiqueta.join(","));
      if (f.maxMinutos) p.set("maxMinutos", String(f.maxMinutos));
      const r = await fetch(`/api/nutricion/recipes?${p}`);
      const j = await r.json();
      setItems(j.items ?? []);
      setTotal(j.total ?? 0);
    } catch {
      setItems([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Las facetas se piden UNA vez: no cambian al teclear en el buscador.
  useEffect(() => {
    fetch("/api/nutricion/recipes/facetas")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.ok && setFacetas(j))
      .catch(() => {});
  }, []);

  const filtros = { tipo, sinAlergeno, preferencia, etiqueta, maxMinutos };
  const claveFiltros = JSON.stringify(filtros);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(q, pagina, JSON.parse(claveFiltros)), 300);
    return () => timer.current && clearTimeout(timer.current);
  }, [q, pagina, claveFiltros, load]);

  // Cambiar un filtro vuelve a la página 1: quedarse en la 7 de un listado que
  // ahora tiene 2 páginas enseña un vacío que parece un error.
  useEffect(() => { setPagina(1); }, [claveFiltros, q]);

  const alternar = (valor, lista, set) =>
    set(lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor]);

  const hayFiltros = tipo || sinAlergeno.length || preferencia.length || etiqueta.length || maxMinutos;
  function limpiar() {
    setTipo(""); setSinAlergeno([]); setPreferencia([]); setEtiqueta([]); setMaxMinutos(null);
  }
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  async function archive(recipe) {
    if (!confirm(`¿Archivar la receta "${recipe.name}"?`)) return;
    const r = await fetch(`/api/nutricion/recipes/${recipe.id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 204) {
      const j = await r.json().catch(() => ({}));
      setToast(j.error || "No se pudo archivar");
      return;
    }
    setToast("Receta archivada");
    load(q, pagina, filtros);
  }

  function onSaved() {
    setEditing(null);
    setToast("Receta guardada");
    load(q, pagina, filtros);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 lg:px-8 pt-6 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          {/* «Recetario» sube al título (04/08/2026, Rodrigo): la pantalla se
              llama así en el menú, y el rótulo de encima se queda con el módulo
              a secas para no decir «Recetario» dos veces seguidas. */}
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Nutrición</div>
          <h1 className="text-xl font-semibold text-gray-900">Recetario</h1>
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

      <div className="px-4 lg:px-8 pb-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar receta…"
            className="flex-1 sm:flex-none sm:w-72 px-3 py-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
          {(facetas?.tipos?.length ?? 0) > 0 && (
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="px-3 py-2 text-sm rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            >
              <option value="">Cualquier momento del día</option>
              {facetas.tipos.map((t) => <option key={t.clave} value={t.clave}>{t.etiqueta} ({t.n})</option>)}
            </select>
          )}
          {TIEMPOS.map((t) => (
            <Chip key={t.min} activo={maxMinutos === t.min} onClick={() => setMaxMinutos(maxMinutos === t.min ? null : t.min)}>
              {t.label}
            </Chip>
          ))}
          {facetas?.preferencias?.map((p) => (
            <Chip key={p.clave} activo={preferencia.includes(p.clave)} onClick={() => alternar(p.clave, preferencia, setPreferencia)}>
              {p.etiqueta} ({p.n})
            </Chip>
          ))}
          {hayFiltros && (
            <button onClick={limpiar} className="text-xs text-gray-500 hover:text-gray-800 underline px-1">
              Quitar filtros
            </button>
          )}
        </div>

        {/* Alérgenos por EXCLUSIÓN: se marca lo que la paciente NO puede tomar. */}
        {(facetas?.alergenos?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-gray-400 mr-0.5">Sin:</span>
            {facetas.alergenos.map((a) => (
              <Chip key={a.clave} pequeno activo={sinAlergeno.includes(a.clave)} onClick={() => alternar(a.clave, sinAlergeno, setSinAlergeno)}>
                {a.etiqueta}
              </Chip>
            ))}
          </div>
        )}

        {(facetas?.etiquetas?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-gray-400 mr-0.5">Etiquetas:</span>
            {/* Solo las 14 más usadas: con 110, enseñarlas todas es una pared. */}
            {facetas.etiquetas.slice(0, 14).map((t) => (
              <Chip key={t.clave} pequeno activo={etiqueta.includes(t.clave)} onClick={() => alternar(t.clave, etiqueta, setEtiqueta)}>
                {t.clave} ({t.n})
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 lg:px-8 pb-8">
        {!loading && total > 0 && (
          <div className="text-[11px] text-gray-400 pb-2">
            {total} receta{total === 1 ? "" : "s"}
            {paginas > 1 && <> · página {pagina} de {paginas}</>}
          </div>
        )}
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            {q || hayFiltros ? "No hay recetas que coincidan." : "Aún no hay recetas. Crea la primera."}
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
                className="border border-gray-200 rounded-xl bg-white overflow-hidden hover:shadow-sm hover:border-[var(--color-primary)]/30 transition group cursor-pointer"
              >
                {/* Foto del plato: cabecera visual de la card. ?v=updatedAt
                    invalida la caché del navegador al cambiar la foto. */}
                {r.hasPhoto && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/nutricion/recipes/${r.id}/photo?v=${encodeURIComponent(r.updatedAt ?? "")}`}
                    alt={`Foto de ${r.name}`}
                    loading="lazy"
                    className="w-full h-32 object-cover border-b border-gray-100"
                  />
                )}
                <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-left flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{r.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {r.ingredientCount} ingrediente{r.ingredientCount === 1 ? "" : "s"}
                      {Array.isArray(r.steps) && r.steps.length > 0 && <> · {r.steps.length} paso{r.steps.length === 1 ? "" : "s"}</>}
                    </div>
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
              </div>
            ))}
          </div>
        )}

        {paginas > 1 && !loading && (
          <div className="flex items-center justify-center gap-2 pt-6">
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina === 1}
              className="px-3 py-1.5 text-xs rounded-md border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50"
            >
              ← Anterior
            </button>
            <span className="text-xs text-gray-500 tabular">{pagina} / {paginas}</span>
            <button
              onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
              disabled={pagina >= paginas}
              className="px-3 py-1.5 text-xs rounded-md border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50"
            >
              Siguiente →
            </button>
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

/** Botón de filtro. Encendido = está filtrando por eso. */
function Chip({ activo, onClick, pequeno, children }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={activo}
      className={`rounded-full border transition ${pequeno ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1.5"} ${
        activo
          ? "text-white border-transparent"
          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
      }`}
      style={activo ? { background: "var(--color-primary)" } : undefined}
    >
      {children}
    </button>
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
