"use client";

/**
 * CourseRegistrationsList — lista paginada de registros previos de un
 * curso, con filtros, búsqueda debounced, paginación, export CSV y
 * click-fila → drawer detalle.
 *
 * Responsive:
 *   - ≥sm: tabla con columnas.
 *   - <sm: cards apiladas con la misma info.
 *
 * Filtros plegables en mobile (≤sm) — botón "Mostrar filtros" en cabecera.
 *
 * Animaciones: transitions discretas en hover/click (200-300ms). Las barras
 * de stats animan width 500ms (en CourseRegistrationStats).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Select from "@/components/ui/Select.jsx";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const DATE_PRESETS = [
  { key: "all", label: "Todo", days: null },
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
];

function isoDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
  const d = Math.floor(h / 24);
  if (d === 1) return "hace 1 día";
  if (d < 30) return `hace ${d} días`;
  const months = Math.floor(d / 30);
  return months === 1 ? "hace 1 mes" : `hace ${months} meses`;
}

function fmtDateExact(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function motivationToneClasses(v) {
  if (v == null) return "bg-neutral-100 text-neutral-400";
  if (v <= 2) return "bg-red-100 text-red-700";
  if (v === 3) return "bg-yellow-100 text-yellow-700";
  return "bg-green-100 text-green-700";
}

export function CourseRegistrationsList({ courseId, onSelect, onCountChange, onFiltersChange }) {
  // Filtros
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [companies, setCompanies] = useState([]);
  const [filtersOpenMobile, setFiltersOpenMobile] = useState(false);

  // Paginación
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // Datos
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Debounce search 300ms
  const searchTimer = useRef(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Cargar empresas para el dropdown (una vez)
  useEffect(() => {
    fetch("/api/training/companies")
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && Array.isArray(j.data)) setCompanies(j.data);
      })
      .catch(() => {/* dropdown queda vacío, no crítico */});
  }, []);

  // Calcular from/to efectivos a partir del preset o custom
  const effectiveDates = useEffectiveDates(datePreset, customFrom, customTo);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        courseId,
        page: String(page),
        limit: String(limit),
      });
      if (searchDebounced) params.set("search", searchDebounced);
      if (companyId) params.set("companyId", companyId);
      if (effectiveDates.from) params.set("from", effectiveDates.from);
      if (effectiveDates.to) params.set("to", effectiveDates.to);

      const r = await fetch(`/api/training/course-registrations?${params.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Error desconocido");
      // El endpoint envuelve con ok({ total, page, limit, data: [...] }), de
      // modo que `j.data` es el objeto paginado completo, no el array.
      // El array de filas vive en `j.data.data`.
      const payload = j.data ?? {};
      const rows = Array.isArray(payload.data) ? payload.data : [];
      setItems(rows);
      setTotal(typeof payload.total === "number" ? payload.total : 0);
      onCountChange?.(typeof payload.total === "number" ? payload.total : 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [
    courseId, page, limit, searchDebounced, companyId,
    effectiveDates.from, effectiveDates.to, onCountChange,
  ]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Reset a página 1 si cambian filtros que no son search (search ya lo hace en su effect)
  useEffect(() => { setPage(1); }, [companyId, datePreset, customFrom, customTo]);

  // Propaga los filtros efectivos al parent (RegistrationsTab) para que
  // las stats puedan refetcharse con los mismos filtros que la lista.
  // Es one-way: List es la única fuente del estado de filtros; el parent
  // solo lo observa para mantener coherencia con Stats.
  useEffect(() => {
    onFiltersChange?.({
      search: searchDebounced,
      companyId,
      from: effectiveDates.from,
      to: effectiveDates.to,
    });
  }, [searchDebounced, companyId, effectiveDates.from, effectiveDates.to, onFiltersChange]);

  // Defensive guard: si `items` quedara en un estado anómalo (race con un
  // setError previo, payload corrupto en BD), no rompemos el render entero.
  const safeItems = Array.isArray(items) ? items : [];
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasActiveFilters =
    searchDebounced || companyId || datePreset !== "all" || customFrom || customTo;

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ courseId });
      if (searchDebounced) params.set("search", searchDebounced);
      if (companyId) params.set("companyId", companyId);
      if (effectiveDates.from) params.set("from", effectiveDates.from);
      if (effectiveDates.to) params.set("to", effectiveDates.to);

      const r = await fetch(`/api/training/course-registrations/export?${params.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Filename del header Content-Disposition prevalece; mantenemos un fallback.
      const cd = r.headers.get("content-disposition") || "";
      const m = /filename="([^"]+)"/.exec(cd);
      a.download = m?.[1] || `registros-curso-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Error al exportar: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      {/* Cabecera con search + acciones */}
      <div className="px-4 py-3 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar email, centro o NIF…"
            className="w-full sm:max-w-sm rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
            aria-label="Buscar registros"
          />
          <button
            type="button"
            onClick={() => setFiltersOpenMobile((v) => !v)}
            className="sm:hidden text-xs font-medium text-neutral-600 border border-neutral-200 rounded-lg px-3 py-2 hover:bg-neutral-50 transition shrink-0"
          >
            Filtros{hasActiveFilters ? " •" : ""}
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading}
            className="text-xs font-semibold text-white rounded-lg px-3 py-2 transition-opacity hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
            style={{ background: "var(--color-primary)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {exporting ? "Exportando…" : "Exportar Excel"}
          </button>
        </div>
      </div>

      {/* Filtros (empresa + fecha) — visible siempre en ≥sm, plegable <sm */}
      <div className={`px-4 py-3 border-b border-neutral-100 bg-neutral-50/50 ${filtersOpenMobile ? "block" : "hidden sm:block"}`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold shrink-0">Empresa</span>
            <Select
              value={companyId}
              onChange={(v) => setCompanyId(v)}
              options={[
                { value: "", label: "Todas" },
                ...companies.map((c) => ({ value: c.id, label: c.name })),
              ]}
              className="text-xs rounded-lg px-2 py-1.5 border border-neutral-200 bg-white focus:outline-none focus:border-neutral-400 transition min-w-0 max-w-[200px]"
            />
          </label>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold mr-1">Fecha</span>
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => { setDatePreset(p.key); setCustomFrom(""); setCustomTo(""); }}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  datePreset === p.key && !customFrom && !customTo
                    ? "bg-neutral-900 text-white"
                    : "bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {p.label}
              </button>
            ))}
            <input
              type="date"
              value={customFrom}
              onChange={(e) => { setCustomFrom(e.target.value); setDatePreset("custom"); }}
              className="text-[11px] rounded-md px-2 py-1 border border-neutral-200 bg-white"
              aria-label="Desde"
            />
            <span className="text-[11px] text-neutral-400">–</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => { setCustomTo(e.target.value); setDatePreset("custom"); }}
              className="text-[11px] rounded-md px-2 py-1 border border-neutral-200 bg-white"
              aria-label="Hasta"
            />
          </div>
        </div>
      </div>

      {/* Error inline */}
      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-xs text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchList}
            className="text-[11px] font-semibold underline hover:no-underline"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Tabla en ≥sm */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
              {["Nombre + email", "Empresa", "NIF centro", "Recibido", "Motivación", ""].map((h) => (
                <th key={h} className="text-left py-3 px-4 text-[11px] font-semibold text-white/70 uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, rowIndex) => (
                <tr key={rowIndex} className="border-b border-neutral-50">
                  {Array.from({ length: 6 }).map((_, headerIndex) => (
                    <td key={headerIndex} className="py-3 px-4">
                      {/* Width determinista (era Math.random → hydration mismatch). */}
                      <div
                        className="h-4 bg-neutral-100 rounded animate-pulse"
                        style={{ width: `${50 + ((headerIndex * 17 + rowIndex * 13) % 40)}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : safeItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-neutral-400">
                  {hasActiveFilters
                    ? "No hay registros con esos filtros."
                    : "Aún no hay registros para este curso."}
                </td>
              </tr>
            ) : (
              safeItems.map((r) => (
                <RowDesktop key={r.id} row={r} onSelect={onSelect} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Cards apiladas en <sm */}
      <div className="sm:hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 bg-neutral-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : safeItems.length === 0 ? (
          <div className="py-12 text-center text-sm text-neutral-400">
            {hasActiveFilters
              ? "No hay registros con esos filtros."
              : "Aún no hay registros para este curso."}
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {safeItems.map((r) => (
              <li key={r.id}>
                <RowMobile row={r} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Paginación */}
      {!loading && total > 0 && (
        <div className="px-4 py-3 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-[11px] text-neutral-500">
            Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, total)} de {total} registros
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-neutral-500">
              Por página
              <Select
                value={limit}
                onChange={(v) => { setLimit(parseInt(v, 10)); setPage(1); }}
                options={PAGE_SIZE_OPTIONS.map((o) => ({ value: o, label: String(o) }))}
                className="text-[11px] rounded-md px-1.5 py-0.5 border border-neutral-200 bg-white focus:outline-none focus:border-neutral-400"
              />
            </label>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="text-[11px] px-2.5 py-1 rounded-md border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition-colors"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="text-[11px] px-2.5 py-1 rounded-md border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition-colors"
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-componentes de fila ─────────────────────────────────────────────────

function RowDesktop({ row, onSelect }) {
  const motivation = row.diagnosisData?.motivationCurrent ?? row.motivationCurrent;
  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={() => onSelect(row)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(row); }
      }}
      className="border-b border-neutral-50 last:border-0 cursor-pointer hover:bg-neutral-50/80 focus:outline-none focus-visible:bg-neutral-50/80 transition-colors"
    >
      <td className="py-3 px-4">
        <div className="text-sm font-medium text-neutral-900 truncate max-w-[260px]">
          {row.trainingUser?.name || row.email}
        </div>
        <div className="text-[11px] text-neutral-400 truncate max-w-[260px]">{row.email}</div>
      </td>
      <td className="py-3 px-4">
        {row.company ? (
          <span
            className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium text-white"
            style={{ background: "var(--color-primary)" }}
          >
            {row.company.name}
          </span>
        ) : (
          <span className="text-neutral-300 text-xs">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-xs text-neutral-600 tabular-nums">
        {row.centerNif || <span className="text-neutral-300">—</span>}
      </td>
      <td className="py-3 px-4 text-[11px] text-neutral-500" title={fmtDateExact(row.submittedAt)}>
        {fmtRelative(row.submittedAt)}
      </td>
      <td className="py-3 px-4">
        <MotivationBadge value={motivation} />
      </td>
      <td className="py-3 px-4 text-right">
        <span
          className="text-[11px] font-semibold text-neutral-500 px-2 py-1 rounded-md group-hover:bg-neutral-100"
        >
          Ver →
        </span>
      </td>
    </tr>
  );
}

function RowMobile({ row, onSelect }) {
  const motivation = row.diagnosisData?.motivationCurrent ?? row.motivationCurrent;
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      className="w-full text-left p-4 hover:bg-neutral-50 active:bg-neutral-100 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <div className="text-sm font-medium text-neutral-900 truncate">
            {row.trainingUser?.name || row.email}
          </div>
          <div className="text-[11px] text-neutral-400 truncate">{row.email}</div>
        </div>
        <MotivationBadge value={motivation} />
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-neutral-500">
        <span className="truncate">
          {row.company?.name || <span className="text-neutral-300">Sin empresa</span>}
          {row.centerNif && <span className="text-neutral-300"> · {row.centerNif}</span>}
        </span>
        <span title={fmtDateExact(row.submittedAt)} className="shrink-0">{fmtRelative(row.submittedAt)}</span>
      </div>
    </button>
  );
}

function MotivationBadge({ value }) {
  if (value == null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-neutral-100 text-neutral-400">
        —
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${motivationToneClasses(value)}`}>
      {value}/5
    </span>
  );
}

// ── Hooks ───────────────────────────────────────────────────────────────────

function useEffectiveDates(preset, customFrom, customTo) {
  // Antes esta función se llamaba en cada render y devolvía un objeto NUEVO
  // con `new Date().toISOString()` (timestamp con ms en cada call). Su valor
  // entraba como dep de fetchList → cambiaba de identidad cada render →
  // bucle infinito de fetch + parpadeo. Con useMemo solo se recalcula
  // cuando preset/customFrom/customTo cambian de verdad.
  return useMemo(() => {
    if (customFrom || customTo) {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : null,
        to: customTo ? new Date(customTo + "T23:59:59").toISOString() : null,
      };
    }
    const p = DATE_PRESETS.find((d) => d.key === preset);
    if (!p || p.days == null) return { from: null, to: null };
    const from = new Date();
    from.setDate(from.getDate() - p.days);
    return { from: from.toISOString(), to: null };
  }, [preset, customFrom, customTo]);
}
