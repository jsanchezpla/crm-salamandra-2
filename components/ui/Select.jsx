"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Select — desplegable propio con control total del estilo.
 *
 * Sustituye al <select> nativo (cuyo resalte azul al hover lo pinta el
 * navegador y CSS no puede cambiar). Aquí el resalte de la opción activa
 * (hover o teclado) y de la seleccionada usan el color del tenant
 * (var --color-primary).
 *
 * API:
 *   <Select
 *     value={string}
 *     onChange={(value) => ...}
 *     options={[{ value, label, disabled? }]}
 *     placeholder="— Seleccionar —"
 *     disabled
 *     className="..."   // clases extra para el botón trigger
 *   />
 */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = "— Seleccionar —",
  disabled = false,
  className = "",
  id,
  "aria-label": ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  const selectedIndex = options.findIndex((o) => String(o.value) === String(value));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const close = useCallback(() => setOpen(false), []);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, close]);

  // Al abrir, resaltar la seleccionada y hacerla visible
  useEffect(() => {
    if (open) {
      setActive(selectedIndex >= 0 ? selectedIndex : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.querySelector(`[data-idx="${active}"]`);
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [active, open]);

  function pick(idx) {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange?.(opt.value);
    close();
  }

  function moveActive(dir) {
    if (!options.length) return;
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i]?.disabled) break;
    }
    setActive(i);
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
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(options.length - 1); break;
      case "Enter": case " ": e.preventDefault(); pick(active); break;
      case "Escape": e.preventDefault(); close(); break;
      case "Tab": close(); break;
      default: break;
    }
  }

  // Estructura (siempre) + visual (de className del formulario, o un default).
  const structural = "w-full flex items-center justify-between gap-2 text-left transition-colors focus:outline-none";
  const defaultVisual = "rounded-md px-2.5 py-2 text-sm bg-white border border-neutral-200 focus:border-neutral-400 text-neutral-800";

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
        <span className={`truncate ${selected ? "text-neutral-800" : "text-neutral-400"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg py-1"
        >
          {options.length === 0 && (
            <li className="px-3 py-2 text-sm text-neutral-400">Sin opciones</li>
          )}
          {options.map((opt, idx) => {
            const isSelected = String(opt.value) === String(value);
            const isActive = idx === active;
            const highlight = isActive; // hover/teclado
            return (
              <li
                key={opt.value ?? idx}
                data-idx={idx}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => !opt.disabled && setActive(idx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(idx)}
                className={`px-3 py-1.5 text-sm truncate ${opt.disabled ? "text-neutral-300 cursor-not-allowed" : "cursor-pointer"} ${
                  !highlight && isSelected ? "font-medium" : ""
                }`}
                style={
                  highlight
                    ? { background: "var(--color-primary, #1B3A2D)", color: "#fff" }
                    : isSelected
                      ? { background: "color-mix(in srgb, var(--color-primary, #1B3A2D) 10%, white)" }
                      : undefined
                }
              >
                {opt.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
