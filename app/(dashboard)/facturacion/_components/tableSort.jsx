"use client";

import { useMemo, useState } from "react";

/**
 * Hook que solo gestiona el estado de ordenación (sortKey + sortDir + toggle).
 * Úsalo cuando la ordenación se hace en el BACKEND: la página observa
 * sortKey/sortDir y los manda como query params en el fetch.
 *
 * Uso:
 *   const { sortKey, sortDir, toggle } = useSortState("issueDate", "desc");
 *   useEffect(() => { fetch(`?sortBy=${sortKey}&sortDir=${sortDir}`); }, [sortKey, sortDir]);
 *   <SortableTh k="issueDate" label="Fecha" {...{ sortKey, sortDir, onClick: toggle }} />
 */
export function useSortState(defaultKey, defaultDir = "desc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  function toggle(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return { sortKey, sortDir, toggle };
}

/**
 * Hook de ordenación CLIENTE para tablas. Útil cuando la página ya
 * tiene cargada una página de resultados y queremos ordenar lo visible
 * sin nuevas llamadas al backend.
 *
 * Uso:
 *   const { sorted, sortKey, sortDir, toggle } = useTableSort(rows, "issueDate", "desc");
 *   <SortableTh k="issueDate" label="Fecha" {...{ sortKey, sortDir, onClick: toggle }} />
 *
 * El path de la key admite acceso anidado: "client.name", "employee.displayName".
 */
export function useTableSort(rows, defaultKey, defaultDir = "desc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  function toggle(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey || !Array.isArray(rows)) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = getPath(a, sortKey);
      const bv = getPath(b, sortKey);
      // nulls al final independientemente del sentido
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      // numérico
      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn) && (typeof av === "number" || /^[0-9.\-]+$/.test(String(av)))) {
        return sortDir === "asc" ? an - bn : bn - an;
      }
      // string
      const sa = String(av).toLowerCase();
      const sb = String(bv).toLowerCase();
      if (sa < sb) return sortDir === "asc" ? -1 : 1;
      if (sa > sb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggle };
}

function getPath(obj, path) {
  if (obj == null) return undefined;
  return path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

/**
 * Cabecera de columna con indicador de orden.
 * Si onClick no se pasa, queda como cabecera no ordenable.
 *
 * `after` es un adorno opcional a la derecha de la flecha (típicamente un
 * HelpTooltip). Va dentro del <th> pero con el clic detenido, así que pulsarlo
 * NO reordena la tabla y la columna se sigue ordenando desde toda la celda,
 * igual que las demás.
 */
export function SortableTh({ k, label, sortKey, sortDir, onClick, align = "left", className = "", after = null }) {
  const active = sortKey === k;
  const sortable = typeof onClick === "function";
  const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const cursorCls = sortable ? "cursor-pointer select-none hover:text-neutral-700" : "";
  const colorCls = active ? "text-neutral-900" : "text-neutral-400";

  return (
    <th
      onClick={sortable ? () => onClick(k) : undefined}
      className={`${alignCls} px-4 py-3 text-[10px] font-semibold uppercase tracking-widest transition-colors ${cursorCls} ${colorCls} ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortable && (
          <span className={`text-[8px] ${active ? "opacity-100" : "opacity-30"}`}>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        )}
        {after && (
          <span className="inline-flex cursor-default" onClick={(e) => e.stopPropagation()}>
            {after}
          </span>
        )}
      </span>
    </th>
  );
}
