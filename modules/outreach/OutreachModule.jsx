"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Select from "../../components/ui/Select.jsx";
import SECTORES from "./sectores.json";
import { scoreBand, analysisFor, SOURCES, sourceLabel } from "./scores.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const SECTOR_OPTIONS = [
  { value: "", label: "Todos los sectores" },
  ...SECTORES.flatMap((c) => c.sectores.map((s) => ({ value: s, label: `${c.categoria} · ${s}` }))),
];

const EMPTY_FORM = { name: "", sector: "", location: "", website: "", phone: "", email: "" };

function ScoreBadge({ score }) {
  const { label, badge } = scoreBand(score);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${badge}`}
      title={label}
    >
      {score == null ? "—" : score}
    </span>
  );
}

// Cabecera de columna ordenable: pulsar cambia el orden (asc/desc).
function SortTh({ col, onSort, arrow, children }) {
  return (
    <th
      className="px-4 py-3 font-medium cursor-pointer select-none hover:text-neutral-900"
      onClick={() => onSort(col)}
    >
      {children}
      <span className="text-neutral-400">{arrow}</span>
    </th>
  );
}

export default function OutreachModule() {
  const [leads, setLeads] = useState([]);
  const [lines, setLines] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("");
  const [source, setSource] = useState("");
  const [analyzed, setAnalyzed] = useState("");
  const [minScore, setMinScore] = useState("");
  const [scoreLine, setScoreLine] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [showSearch, setShowSearch] = useState(false);
  const [searchForm, setSearchForm] = useState({ sector: "", location: "", sources: ["paginas_amarillas"] });
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [googleUsage, setGoogleUsage] = useState(null);

  const [location, setLocation] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [hasEmail, setHasEmail] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [dir, setDir] = useState("DESC");

  const [selected, setSelected] = useState(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Debounce del buscador: no queremos una request por tecla.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const t = setTimeout(() => setLocation(locationInput), 300);
    return () => clearTimeout(t);
  }, [locationInput]);

  useEffect(() => {
    fetch("/api/outreach/business-lines")
      .then((r) => r.json())
      .then((j) => setLines(j?.data?.items ?? []))
      .catch(() => {});
  }, []);

  // Cuántas búsquedas de Google quedan este mes (contador propio del CRM).
  useEffect(() => {
    fetch("/api/outreach/google-usage")
      .then((r) => r.json())
      .then((j) => j?.ok && setGoogleUsage(j.data))
      .catch(() => {});
  }, []);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setSelected(new Set()); // la selección no sobrevive a un recargado de filtros
    try {
      const p = new URLSearchParams();
      if (search) p.set("q", search);
      if (sector) p.set("sector", sector);
      if (location) p.set("location", location);
      if (source) p.set("source", source);
      if (analyzed) p.set("analyzed", analyzed);
      if (hasEmail) p.set("hasEmail", hasEmail);
      if (minScore && scoreLine) {
        p.set("minScore", minScore);
        p.set("line", scoreLine);
      }
      p.set("sort", sort);
      p.set("dir", dir);
      p.set("limit", "100");

      const r = await fetch(`/api/outreach/leads?${p.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error cargando leads");
      setLeads(j?.data?.items ?? []);
      setTotal(j?.data?.total ?? 0);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [search, sector, location, source, analyzed, hasEmail, minScore, scoreLine, sort, dir]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const submitCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setErrorMsg("El nombre de la empresa es obligatorio");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v.trim() || undefined])
      );
      const r = await fetch("/api/outreach/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error creando el lead");
      setForm(EMPTY_FORM);
      setShowCreate(false);
      loadLeads();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSource = (value) =>
    setSearchForm((f) => ({
      ...f,
      sources: f.sources.includes(value) ? f.sources.filter((s) => s !== value) : [...f.sources, value],
    }));

  const submitSearch = async (e) => {
    e.preventDefault();
    setSearching(true);
    setSearchResult(null);
    setSearchError(null);
    try {
      const r = await fetch("/api/outreach/leads/buscar-nuevos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sector: searchForm.sector || undefined,
          location: searchForm.location || undefined,
          sources: searchForm.sources,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "El scraping ha fallado");
      setSearchResult(j.data);
      if (j.data?.googleUsage) setGoogleUsage(j.data.googleUsage);
      loadLeads();
    } catch (e2) {
      setSearchError(e2.message);
    } finally {
      setSearching(false);
    }
  };

  const lineOptions = useMemo(
    () => [{ value: "", label: "— línea —" }, ...lines.map((l) => ({ value: l.key, label: l.name }))],
    [lines]
  );

  const decisionMakers = (lead) => (lead.contacts ?? []).filter((c) => c.isDecisionMaker).length;

  const toggleSort = (col) => {
    if (sort === col) setDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    else {
      setSort(col);
      setDir("ASC");
    }
  };
  const sortArrow = (col) => (sort === col ? (dir === "ASC" ? " ↑" : " ↓") : "");

  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  const toggleOne = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const doBulkDelete = async () => {
    setDeleting(true);
    setErrorMsg(null);
    try {
      const r = await fetch("/api/outreach/leads/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error borrando");
      setConfirmBulk(false);
      loadLeads();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-[1400px] mx-auto">
      <header className="flex flex-col lg:flex-row lg:items-end gap-4 mb-6">
        <div className="flex-1">
          <h1 className="font-[Fraunces] text-3xl lg:text-4xl text-neutral-800">Captación</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {total} empresa{total !== 1 ? "s" : ""} captada{total !== 1 ? "s" : ""}
            {search || sector || source || analyzed || minScore ? " (filtradas)" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/outreach/configuracion"
            className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-700 hover:bg-neutral-50 transition"
          >
            Configuración
          </Link>
          {/* "Buscar nuevos" dispara el scraping en n8n. Nunca se llama solo:
              cuesta tiempo, y por eso el modo por defecto solo lee de BD. */}
          <button
            type="button"
            onClick={() => {
              setShowSearch(true);
              setSearchResult(null);
              setSearchError(null);
            }}
            className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-700 hover:bg-neutral-50 transition"
          >
            Buscar nuevos
          </button>
          <button
            onClick={() => {
              setShowCreate(true);
              setForm(EMPTY_FORM);
            }}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium transition hover:opacity-90"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            + Nuevo lead
          </button>
        </div>
      </header>

      {/* Filtros. "Ver ya buscados" es el modo por defecto: solo lee de BD. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <input
          className={inputCls}
          placeholder="Buscar por nombre de empresa..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <Select className={inputCls} value={sector} onChange={setSector} options={SECTOR_OPTIONS} />
        <Select
          className={inputCls}
          value={source}
          onChange={setSource}
          options={[{ value: "", label: "Todas las fuentes" }, ...SOURCES]}
        />
        <Select
          className={inputCls}
          value={analyzed}
          onChange={setAnalyzed}
          options={[
            { value: "", label: "Analizados y sin analizar" },
            { value: "true", label: "Solo analizados" },
            { value: "false", label: "Solo sin analizar" },
          ]}
        />
        <input
          className={inputCls}
          placeholder="Filtrar por ubicación..."
          value={locationInput}
          onChange={(e) => setLocationInput(e.target.value)}
        />
        <Select
          className={inputCls}
          value={hasEmail}
          onChange={setHasEmail}
          options={[
            { value: "", label: "Con y sin email" },
            { value: "true", label: "Solo con email" },
            { value: "false", label: "Solo sin email" },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <span className="text-xs text-neutral-500">Filtrar por score mínimo:</span>
        {/* El ancho va en el contenedor: `inputCls` ya trae `w-full` y ganaría
            a cualquier `w-24` aplicado sobre el propio input. */}
        <div className="w-24">
          <input
            type="number"
            min={0}
            max={100}
            placeholder="70"
            className={inputCls}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
          />
        </div>
        <span className="text-xs text-neutral-500">en</span>
        <div className="w-56">
          <Select className={inputCls} value={scoreLine} onChange={setScoreLine} options={lineOptions} />
        </div>
        {minScore && !scoreLine && (
          <span className="text-xs text-amber-700">Elige una línea de negocio para aplicar el filtro</span>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700">
          {errorMsg}
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-200 text-sm">
          <span className="text-neutral-600">
            {selected.size} seleccionado{selected.size !== 1 ? "s" : ""}
          </span>
          <button
            onClick={() => setConfirmBulk(true)}
            className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold bg-red-600 hover:bg-red-700 transition"
          >
            Eliminar seleccionados
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-neutral-500 hover:text-neutral-800">
            Deseleccionar
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b border-neutral-200">
              <tr className="text-left text-neutral-600">
                <th className="pl-4 pr-1 py-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Seleccionar todo" />
                </th>
                <SortTh col="name" onSort={toggleSort} arrow={sortArrow("name")}>Empresa</SortTh>
                <SortTh col="sector" onSort={toggleSort} arrow={sortArrow("sector")}>Sector</SortTh>
                <SortTh col="location" onSort={toggleSort} arrow={sortArrow("location")}>Ubicación</SortTh>
                {lines.map((l) => (
                  <th key={l.id} className="px-4 py-3 font-medium text-center whitespace-nowrap">
                    {l.name}
                  </th>
                ))}
                <th className="px-4 py-3 font-medium">Contactos</th>
                <SortTh col="source" onSort={toggleSort} arrow={sortArrow("source")}>Fuente</SortTh>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7 + lines.length} className="px-4 py-6 text-center text-neutral-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loading && leads.length === 0 && (
                <tr>
                  <td colSpan={7 + lines.length} className="px-4 py-10 text-center text-neutral-400">
                    Sin leads captados todavía.
                  </td>
                </tr>
              )}
              {!loading &&
                leads.map((lead) => {
                  const dm = decisionMakers(lead);
                  return (
                    <tr key={lead.id} className="border-b border-neutral-100 hover:bg-neutral-50 transition">
                      <td className="pl-4 pr-1 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          onChange={() => toggleOne(lead.id)}
                          aria-label={`Seleccionar ${lead.name}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/outreach/${lead.id}`}
                          className="font-medium text-neutral-800 hover:text-neutral-600"
                        >
                          {lead.name}
                        </Link>
                        {!lead.analyzed && (
                          <div className="text-[11px] text-neutral-400 mt-0.5">sin analizar</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">{lead.sector ?? "—"}</td>
                      <td className="px-4 py-3 text-neutral-600">{lead.location ?? "—"}</td>
                      {lines.map((l) => (
                        <td key={l.id} className="px-4 py-3 text-center">
                          <ScoreBadge score={analysisFor(lead, l.id)?.score ?? null} />
                        </td>
                      ))}
                      <td className="px-4 py-3 text-neutral-600">
                        {lead.contacts?.length ?? 0}
                        {dm > 0 && (
                          <span className="ml-1 text-amber-600" title={`${dm} decisor(es)`}>
                            ★
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-500 text-xs whitespace-nowrap">{sourceLabel(lead.source)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/outreach/${lead.id}`}
                          className="text-sm text-neutral-500 hover:text-neutral-800 whitespace-nowrap"
                        >
                          Ver ficha →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de confirmación de borrado en bulk. */}
      {confirmBulk && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !deleting && setConfirmBulk(false)}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-[Fraunces] text-xl text-neutral-800">
              Eliminar {selected.size} lead{selected.size !== 1 ? "s" : ""}
            </h3>
            <p className="text-sm text-neutral-600 mt-2">
              Esta acción no se puede deshacer. Se borrarán los leads seleccionados junto con sus contactos y análisis.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConfirmBulk(false)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={doBulkDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-white text-sm font-medium bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer de scraping. Respeta la barra superior móvil (regla #13). */}
      {showSearch && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowSearch(false)}>
          <aside
            className="absolute right-0 top-14 lg:top-0 bottom-0 w-full sm:w-[480px] bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
              <h2 className="font-[Fraunces] text-xl text-neutral-800">Buscar nuevos</h2>
              <button
                onClick={() => setShowSearch(false)}
                className="text-neutral-400 hover:text-neutral-600 text-xl"
                aria-label="Cerrar"
              >
                ×
              </button>
            </header>
            <form onSubmit={submitSearch} className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-xs text-neutral-500">
                Rastrea empresas en las fuentes elegidas y las guarda como leads sin analizar. Las que ya
                tengas no se duplican.
              </p>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Sector</label>
                <Select
                  className={inputCls}
                  value={searchForm.sector}
                  onChange={(v) => setSearchForm({ ...searchForm, sector: v })}
                  options={SECTOR_OPTIONS}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Ubicación</label>
                <input
                  className={inputCls}
                  placeholder="Salamanca"
                  value={searchForm.location}
                  onChange={(e) => setSearchForm({ ...searchForm, location: e.target.value })}
                />
              </div>
              <div>
                <span className="block text-xs font-medium text-neutral-600 mb-2">Fuentes</span>
                <div className="space-y-2">
                  {SOURCES.filter((s) => s.value !== "manual").map((s) => (
                    <label key={s.value} className="flex items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={searchForm.sources.includes(s.value)}
                        onChange={() => toggleSource(s.value)}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>

              {googleUsage && (
                <p className={`text-xs ${googleUsage.remaining <= 50 ? "text-amber-700 font-medium" : "text-neutral-400"}`}>
                  Google: te quedan <span className="font-semibold">{googleUsage.remaining}</span> de {googleUsage.limit} búsquedas este mes.
                </p>
              )}

              <p className="text-xs text-neutral-400">
                Indica al menos un sector o una ubicación, y una fuente. El scraping puede tardar.
              </p>

              {searchError && (
                <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700">
                  {searchError}
                </div>
              )}

              {searchResult && (
                <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-sm text-emerald-800">
                  {searchResult.inserted} nuevos
                  {searchResult.refreshed > 0 && ` · ${searchResult.refreshed} actualizados`}
                  {searchResult.keptAnalyzed > 0 && ` · ${searchResult.keptAnalyzed} ya analizados (intactos)`}
                  {searchResult.keptClient > 0 && ` · ${searchResult.keptClient} ya clientes`}
                  {searchResult.ignored > 0 && ` · ${searchResult.ignored} descartados`} (de {searchResult.total})
                  {searchResult.enriched > 0 && ` · ${searchResult.enriched} con email`}
                  {searchResult.googleUsage && (
                    <div className="mt-1 text-xs text-emerald-700">
                      Google: {searchResult.googleUsage.count}/{searchResult.googleUsage.limit} búsquedas este mes
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={searching || searchForm.sources.length === 0 || (!searchForm.sector && !searchForm.location)}
                  className="flex-1 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 transition hover:opacity-90"
                  style={{ backgroundColor: "var(--color-primary)" }}
                >
                  {searching ? "Buscando..." : "Buscar"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSearch(false)}
                  className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50"
                >
                  Cerrar
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {/* Drawer de alta manual. Respeta la barra superior móvil (regla #13). */}
      {showCreate && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowCreate(false)}>
          <aside
            className="absolute right-0 top-14 lg:top-0 bottom-0 w-full sm:w-[480px] bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
              <h2 className="font-[Fraunces] text-xl text-neutral-800">Nuevo lead</h2>
              <button
                onClick={() => setShowCreate(false)}
                className="text-neutral-400 hover:text-neutral-600 text-xl"
                aria-label="Cerrar"
              >
                ×
              </button>
            </header>
            <form onSubmit={submitCreate} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Empresa *</label>
                <input
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  maxLength={200}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Sector</label>
                <Select
                  className={inputCls}
                  value={form.sector}
                  onChange={(v) => setForm({ ...form, sector: v })}
                  options={SECTOR_OPTIONS}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Ubicación</label>
                  <input
                    className={inputCls}
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Teléfono</label>
                  <input
                    className={inputCls}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Web</label>
                <input
                  className={inputCls}
                  placeholder="https://"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Email</label>
                <input
                  type="email"
                  className={inputCls}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <p className="text-xs text-neutral-400">
                No se puede repetir la misma empresa con la misma ubicación y fuente.
              </p>
              <div className="pt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 transition hover:opacity-90"
                  style={{ backgroundColor: "var(--color-primary)" }}
                >
                  {submitting ? "Creando..." : "Crear lead"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}
