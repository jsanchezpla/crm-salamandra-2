"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coincidePorNombre } from "../../lib/utils/busqueda.js";

/**
 * MultiSelect — el hermano de `Select.jsx` para elegir VARIAS cosas.
 *
 * Nació para el filtro de la agenda (12/08/2026). Aumenta tiene 57 tipos de
 * cita y 15 profesionales, y el filtro los pintaba todos como botones: 74
 * chips en 10 filas, 379 px de alto. Medido en producción, los filtros
 * ocupaban MÁS que la agenda que hay debajo (335 px), así que el día empezaba
 * haciendo scroll para ver a qué hora era la primera cita.
 *
 * POR QUÉ NO UN <select> NORMAL
 * Porque el filtro es de selección múltiple y eso se usa: ver dos tipos a la
 * vez, o a dos profesionales. Un desplegable normal elige una cosa y se lleva
 * eso por delante. Aquí el desplegable ocupa lo mismo cerrado y no quita nada.
 *
 * ── EL CONTRATO DEL VALOR ───────────────────────────────────────────────────
 *   null  → «todos» (que NO es lo mismo que tenerlos todos marcados)
 *   [a,b] → solo esos
 *   []    → NO EXISTE. Quedarse sin nada vuelve a `null`.
 *
 * Esa última línea es una decisión, no un descuido (Jorge, 12/08/2026): con
 * casillas, vaciar la lista está a un clic, y un calendario en blanco se lee
 * como «han desaparecido las citas», no como «no has pedido nada».
 *
 * ── EL PRIMER CLIC AÍSLA ────────────────────────────────────────────────────
 * Partiendo de «todos», marcar uno deja SOLO ese; los siguientes suman. Es la
 * regla que Rodrigo pidió el 02/08 para el filtro de profesional, y que aquí se
 * aplica también al de tipo: con 57 tipos, ir desmarcando 56 no es un filtro.
 * Vive en `alternar()`, para que las dos listas no puedan volver a divergir.
 *
 * API:
 *   <MultiSelect
 *     value={null | string[]}
 *     onChange={(siguiente) => ...}      // null | string[], nunca []
 *     options={[{ value, label, color? }]}
 *     etiquetaTodos="Todos"
 *     resumen={(n) => `${n} tipos`}      // texto cuando hay más de uno marcado
 *     searchable                          // buscador dentro del desplegable
 *     className="..."                     // clases extra del botón
 *   />
 */
export default function MultiSelect({
  value = null,
  onChange,
  options = [],
  etiquetaTodos = "Todos",
  resumen,
  disabled = false,
  className = "",
  id,
  "aria-label": ariaLabel,
  searchable = false,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);

  const marcados = useMemo(() => new Set(value ?? []), [value]);
  const todos = value == null;

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    // Todas las palabras, en cualquier orden y sin tildes (28/08/2026). En la
    // agenda de Aumenta son 15 profesionales y 57 tipos de cita: quien recordaba
    // el segundo apellido y no el primero se quedaba sin filtro.
    return options.filter((o) => coincidePorNombre(query, [o.label]));
  }, [options, query, searchable]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      setActive(0);
      if (searchable && searchRef.current) searchRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && searchable) setActive(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.querySelector(`[data-idx="${active}"]`);
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [active, open]);

  /**
   * La regla, en un solo sitio.
   *
   * Desde «todos» (null), marcar uno AÍSLA. Desde una lista, suma o quita. Y si
   * al quitar no queda ninguno, vuelve a «todos» en vez de dejar la lista vacía.
   */
  function alternar(v) {
    if (value == null) return onChange?.([v]);
    if (value.includes(v)) {
      const resto = value.filter((x) => x !== v);
      return onChange?.(resto.length ? resto : null);
    }
    return onChange?.([...value, v]);
  }

  // El desplegable NO se cierra al marcar: elegir varios es el caso normal.
  function pick(idx) {
    const opt = filtered[idx];
    if (!opt) return;
    alternar(opt.value);
  }

  function moveActive(dir) {
    if (!filtered.length) return;
    setActive((i) => (i + dir + filtered.length) % filtered.length);
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); moveActive(1); break;
      case "ArrowUp": e.preventDefault(); moveActive(-1); break;
      case "Home": if (searchable) break; e.preventDefault(); setActive(0); break;
      case "End": if (searchable) break; e.preventDefault(); setActive(filtered.length - 1); break;
      case "Enter": e.preventDefault(); pick(active); break;
      case " ":
        if (searchable) break; // en el buscador, Espacio escribe un espacio
        e.preventDefault(); pick(active); break;
      case "Escape": e.preventDefault(); close(); break;
      case "Tab": close(); break;
      default: break;
    }
  }

  // Qué pone en el botón cerrado.
  const elegidas = options.filter((o) => marcados.has(o.value));
  let texto = etiquetaTodos;
  let punto = null;
  if (elegidas.length === 1) {
    texto = elegidas[0].label;
    punto = elegidas[0].color ?? null;
  } else if (elegidas.length > 1) {
    texto = resumen ? resumen(elegidas.length) : `${elegidas.length} seleccionados`;
  }

  const structural = "w-full flex items-center justify-between gap-2 text-left transition-colors focus:outline-none";
  const defaultVisual = "rounded-md px-2.5 py-1.5 text-[12px] bg-white border border-neutral-200 focus:border-neutral-400 text-neutral-700";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`${structural} ${className || defaultVisual} ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {punto && (
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: punto }} />
          )}
          <span className={`truncate ${todos ? "text-neutral-500" : "text-neutral-800"}`}>{texto}</span>
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          className={`w-3.5 h-3.5 text-neutral-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* `w-max` con tope: el desplegable se ensancha con la opción más larga en
          vez de partirla, pero no se come la pantalla. Los tipos de cita de
          Aumenta llegan a «INFORME PARA DIAGNOSTICO (PSICO - LOGO - I.S.-SOLO
          TEA)», y un nombre cortado no se distingue de otro que empiece igual —
          que ahí es lo normal. */}
      {open && (
        <div className="absolute z-50 left-0 mt-1 min-w-full w-max max-w-[min(28rem,90vw)] rounded-md border border-neutral-200 bg-white shadow-lg overflow-hidden">
          {searchable && (
            <div className="p-1.5 border-b border-neutral-100">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Buscar…"
                className="w-full rounded px-2 py-1.5 text-[12px] text-neutral-800 border border-neutral-200 focus:outline-none focus:border-neutral-400"
              />
            </div>
          )}

          {/* Volver a «todos» sin tener que desmarcar de uno en uno. */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange?.(null)}
            className={`w-full text-left px-3 py-1.5 text-[12px] border-b border-neutral-100 ${
              todos ? "font-medium text-neutral-800" : "text-neutral-500 hover:bg-neutral-50"
            }`}
          >
            {etiquetaTodos}
          </button>

          <ul ref={listRef} role="listbox" aria-multiselectable="true" tabIndex={-1} className="max-h-60 overflow-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-[12px] text-neutral-400">Sin resultados</li>
            )}
            {filtered.map((opt, idx) => {
              // Con «todos» puesto no se pinta ninguna casilla marcada: marcar
              // la primera AÍSLA, y enseñarlas todas marcadas haría creer que
              // el primer clic desmarca una de las 57.
              const isMarcado = marcados.has(opt.value);
              const isActive = idx === active;
              return (
                <li
                  key={opt.value ?? idx}
                  data-idx={idx}
                  role="option"
                  aria-selected={isMarcado}
                  onMouseEnter={() => setActive(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(idx)}
                  className="px-3 py-1.5 text-[12px] cursor-pointer flex items-center gap-2"
                  style={isActive ? { background: "var(--color-primary, #1B3A2D)", color: "#fff" } : undefined}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] border shrink-0"
                    style={{
                      borderColor: isActive ? "rgba(255,255,255,.7)" : "#d4d4d4",
                      background: isMarcado ? (isActive ? "#fff" : "var(--color-primary, #1B3A2D)") : "transparent",
                    }}
                  >
                    {isMarcado && (
                      <svg viewBox="0 0 24 24" fill="none" strokeWidth={3.5}
                        stroke={isActive ? "var(--color-primary, #1B3A2D)" : "#fff"} className="w-2.5 h-2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  {opt.color && (
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: opt.color }} />
                  )}
                  <span className="truncate">{opt.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
