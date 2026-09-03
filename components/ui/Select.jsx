"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { coincidePorNombre } from "../../lib/utils/busqueda.js";

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
 *     options={[{ value, label, disabled?, pinned? }]}  // pinned: no se filtra al buscar
 *     placeholder="— Seleccionar —"
 *     disabled
 *     searchable            // opt-in: añade un buscador que filtra por label
 *     className="..."   // clases extra para el botón trigger
 *   />
 *
 * BUSCAR EN EL SERVIDOR (28/08/2026). `searchable` filtra sobre las opciones
 * que le den, y eso solo vale cuando caben todas. Con 1.083 fichas no caben:
 * la pantalla se bajaba 200 y el buscador filtraba encima, así que 883 familias
 * no aparecían escribieras lo que escribieras. Para eso están estos cuatro:
 *
 *     onQueryChange={(texto) => ...}   lo tecleado, para ir a preguntar
 *     filtrarEnCliente={false}         no filtrar aquí: el servidor ya filtró
 *     mensajeVacio="Buscando…"         qué poner cuando no hay nada que enseñar
 *     pie={<p>…</p>}                   una línea bajo la lista (el «hay más»)
 *
 * Quien los use NO debería hablar con la API a mano: para fichas de cliente ya
 * está `components/clients/SelectorCliente.jsx`, que es quien sabe la regla.
 */
/**
 * Hasta dónde puede extenderse el panel sin que lo corten: el área de
 * contenido (sin barra de scroll ni relleno) del primer antepasado con
 * overflow que recorta; si no hay ninguno, la ventana con un margen. Un
 * `overflow-y: auto` recorta también en horizontal, y hacia la izquierda no
 * hay scroll que valga: lo que se sale, desaparece. Y hacia la derecha pasa
 * lo contrario: un píxel de más sobre la barra o el relleno y el cajón entero
 * gana scroll horizontal y se corre (03/09/2026, Aumenta lo vio).
 */
function limitesDelRecorte(nodo) {
  let el = nodo?.parentElement;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) {
      const r = el.getBoundingClientRect();
      const left = r.left + el.clientLeft + parseFloat(cs.paddingLeft || 0);
      const right = r.left + el.clientLeft + el.clientWidth - parseFloat(cs.paddingRight || 0);
      return { left, right };
    }
    el = el.parentElement;
  }
  const MARGEN = 16;
  return { left: MARGEN, right: window.innerWidth - MARGEN };
}

export default function Select({
  value,
  onChange,
  options = [],
  placeholder = "— Seleccionar —",
  disabled = false,
  className = "",
  id,
  "aria-label": ariaLabel,
  searchable = false,
  onQueryChange,
  filtrarEnCliente = true,
  mensajeVacio = "Sin opciones",
  pie = null,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState("");
  // Por qué lado se despliega el panel y cuánto puede crecer. Desde que puede
  // ser MÁS ANCHO que el botón (para no cortar los nombres), uno pegado al
  // borde derecho se saldría de la pantalla: ahí se ancla a la derecha y crece
  // hacia dentro. Y el tope de ancho no es la pantalla sino lo que le deje el
  // primer antepasado que recorta (un cajón lateral con scroll, un modal):
  // dentro del cajón de «Nueva cita» (03/09/2026) el panel de «Tipo de cita»
  // crecía hacia la izquierda más allá del cajón y salía cortado.
  const [aLaDerecha, setALaDerecha] = useState(false);
  const [anchoMax, setAnchoMax] = useState(null);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);

  // Opciones visibles: si es searchable y hay texto, se filtran por label.
  // Sin searchable (o sin texto) => todas las opciones, comportamiento idéntico al previo.
  const filtered = useMemo(() => {
    // Con el servidor buscando, filtrar aquí otra vez solo puede QUITAR: la
    // lista que llega ya es la respuesta a lo tecleado.
    if (!filtrarEnCliente) return options;
    if (!searchable || !query.trim()) return options;
    // Las opciones `pinned` (p.ej. acciones "+ Añadir nuevo" o "Texto libre") no se
    // filtran nunca: deben seguir visibles justo cuando la búsqueda no encuentra nada.
    //
    // Todas las palabras, en cualquier orden y sin tildes (28/08/2026): antes
    // «laura ruiz» no encontraba a «Laura Gómez Ruiz» y «gomez» no encontraba a
    // «Gómez». Este desplegable lo usa medio CRM, así que se arregla en todos a
    // la vez. Ver `lib/utils/busqueda.js`.
    return options.filter((o) => o.pinned || coincidePorNombre(query, [o.label]));
  }, [options, query, searchable, filtrarEnCliente]);

  // La seleccionada se calcula sobre TODAS las opciones (para el texto del trigger).
  const selected = options.find((o) => String(o.value) === String(value)) ?? null;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, close]);

  // Al abrir, resaltar la seleccionada (o la primera) y enfocar el buscador
  useEffect(() => {
    if (open) {
      const idx = filtered.findIndex((o) => String(o.value) === String(value));
      setActive(idx >= 0 ? idx : 0);
      if (searchable && searchRef.current) searchRef.current.focus();
      // ANCHO_MAX es el mismo tope que la clase max-w del panel (30rem).
      const ANCHO_MAX = 480;
      const caja = rootRef.current?.getBoundingClientRect();
      if (caja) {
        const limite = limitesDelRecorte(rootRef.current);
        const haciaDerecha = limite.right - caja.left;
        const haciaIzquierda = caja.right - limite.left;
        // Cabe entero hacia la derecha: como siempre. Si no, por el lado con
        // más sitio, y con el ancho capado a ese sitio (nunca menos que el
        // botón, que ya cabe por definición).
        const derecha = haciaDerecha < ANCHO_MAX && haciaIzquierda > haciaDerecha;
        setALaDerecha(derecha);
        setAnchoMax(Math.max(caja.width, Math.min(ANCHO_MAX, derecha ? haciaIzquierda : haciaDerecha)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Al teclear en el buscador, reposicionar el resalte al principio de la lista filtrada
  useEffect(() => {
    if (open && searchable) setActive(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Lo tecleado, hacia fuera. Va en un efecto y no en el `onChange` del input
  // para que al cerrar (que vacía la caja) el de fuera también se entere y
  // vuelva a su lista corta; si no, reabrir enseñaría el resultado de la
  // búsqueda anterior con la caja en blanco.
  useEffect(() => {
    onQueryChange?.(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.querySelector(`[data-idx="${active}"]`);
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [active, open]);

  function pick(idx) {
    const opt = filtered[idx];
    if (!opt || opt.disabled) return;
    onChange?.(opt.value);
    close();
  }

  function moveActive(dir) {
    if (!filtered.length) return;
    let i = active;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + dir + filtered.length) % filtered.length;
      if (!filtered[i]?.disabled) break;
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
      // En modo searchable, Home/End mueven el cursor dentro del texto (nativo del input).
      case "Home": if (searchable) break; e.preventDefault(); setActive(0); break;
      case "End": if (searchable) break; e.preventDefault(); setActive(filtered.length - 1); break;
      case "Enter": e.preventDefault(); pick(active); break;
      case " ":
        // En el buscador, Espacio escribe un espacio; sin buscador, selecciona.
        if (searchable) break;
        e.preventDefault(); pick(active); break;
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
        title={selected && typeof selected.label === "string" ? selected.label : undefined}
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
        // El panel arranca en el ancho del botón y CRECE con el contenido
        // hasta un tope, en vez de estrangular las opciones largas.
        <div
          className={`absolute z-50 ${aLaDerecha ? "right-0" : "left-0"} min-w-full w-max max-w-[min(30rem,calc(100vw-2rem))] mt-1 rounded-md border border-neutral-200 bg-white shadow-lg overflow-hidden`}
          style={anchoMax ? { maxWidth: `${anchoMax}px` } : undefined}
        >
          {searchable && (
            <div className="p-1.5 border-b border-neutral-100">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Buscar…"
                className="w-full rounded px-2 py-1.5 text-sm text-neutral-800 border border-neutral-200 focus:outline-none focus:border-neutral-400"
              />
            </div>
          )}
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            className="max-h-60 overflow-auto py-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-neutral-400">{mensajeVacio}</li>
            )}
            {filtered.map((opt, idx) => {
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
                  title={typeof opt.label === "string" ? opt.label : undefined}
                  // Sin truncate: lo que no quepa a lo ancho baja de línea. Una
                  // opción cortada obliga a adivinar cuál se está eligiendo.
                  className={`px-3 py-1.5 text-sm break-words ${opt.disabled ? "text-neutral-300 cursor-not-allowed" : "cursor-pointer"} ${
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
          {pie}
        </div>
      )}
    </div>
  );
}
