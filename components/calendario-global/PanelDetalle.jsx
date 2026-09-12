"use client";

import { useEffect, useId, useRef } from "react";
import { IconoCerrar } from "./Iconos.jsx";
import { FOCO } from "./estilos.js";

/**
 * PanelDetalle — la ficha lateral del calendario global (12/09/2026).
 *
 * Sustituye al modal centrado de la pantalla de antes. Un modal en medio
 * tapaba justo la semana que se estaba repasando; un panel a la derecha deja
 * ver el calendario y se cierra tocando fuera. En el móvil (<640 px) sale
 * como hoja desde abajo, que es donde llega el pulgar.
 *
 * Es GENÉRICO a propósito: lo usan la ficha de un evento del calendario
 * (`DetalleEvento`) y la de una tarjeta del tablero de la pestaña Proyectos.
 * Capas según la regla 13 del CLAUDE.md: fondo `z-40`, panel `z-50`.
 *
 * Props:
 *   onCerrar    () => void (también Escape y tocar fuera)
 *   cliente     { nombre, color } — la línea de arriba, con su color
 *   tipo        «Evento», «Tarea de proyecto», «Hito»… tras el cliente
 *   titulo      el título grande
 *   chips       nodo con los chips de estado bajo el título
 *   filas       [{ etiqueta, valor }] — las vacías (null, "", false) no salen
 *   children    lo que vaya debajo de las filas (una nota, una lista)
 *   error       texto de un fallo de las acciones, encima del pie
 *   acciones    nodo del pie (botones)
 */
export default function PanelDetalle({
  onCerrar,
  cliente = null,
  tipo = null,
  titulo,
  chips = null,
  filas = [],
  children = null,
  error = null,
  acciones = null,
}) {
  const idTitulo = useId();
  const cerrarRef = useRef(null);
  const onCerrarRef = useRef(onCerrar);

  useEffect(() => {
    onCerrarRef.current = onCerrar;
  }, [onCerrar]);

  useEffect(() => {
    cerrarRef.current?.focus({ preventScroll: true });
    const alTeclear = (e) => {
      if (e.key === "Escape") onCerrarRef.current?.();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, []);

  const filasConValor = filas.filter((f) => f && f.valor != null && f.valor !== "" && f.valor !== false);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25 sm:bg-black/10" onClick={() => onCerrarRef.current?.()} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className="fixed z-50 inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[380px] sm:max-h-none sm:rounded-none sm:border-t-0 sm:border-l border-[#E7E7E1] bg-white flex flex-col shadow-[0_-6px_20px_rgba(0,0,0,0.08)] sm:shadow-[-6px_0_20px_rgba(0,0,0,0.06)]"
      >
        <header className="shrink-0 px-5 pt-4 pb-3.5 border-b border-[#EDEDE8]">
          <div className="flex items-center gap-2 min-h-6">
            {cliente && (
              <span className="flex items-center gap-1.5 min-w-0 text-[12px] text-[#5C6461]">
                <span aria-hidden="true" className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: cliente.color || "#94A3B8" }} />
                <span className="truncate">{cliente.nombre}</span>
              </span>
            )}
            {cliente && tipo && <span aria-hidden="true" className="text-[#C9CCC9]">·</span>}
            {tipo && <span className="shrink-0 text-[12px] text-[#8A918E]">{tipo}</span>}
            <button
              ref={cerrarRef}
              type="button"
              onClick={() => onCerrarRef.current?.()}
              aria-label="Cerrar"
              className={`ml-auto -mr-1.5 w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md text-[#8A918E] hover:bg-[#F2F2EE] hover:text-[#1C2B27] ${FOCO}`}
            >
              <IconoCerrar className="w-4 h-4" />
            </button>
          </div>
          <h2 id={idTitulo} className="mt-1 text-[15px] font-semibold leading-snug text-[#1C2B27] break-words">
            {titulo}
          </h2>
          {chips && <div className="mt-2 flex flex-wrap items-center gap-1.5">{chips}</div>}
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {filasConValor.length > 0 && (
            <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
              {filasConValor.map((f) => (
                <div key={f.etiqueta} className="contents">
                  <dt className="text-[#8A918E]">{f.etiqueta}</dt>
                  <dd className="text-[#1C2B27] break-words">{f.valor}</dd>
                </div>
              ))}
            </dl>
          )}
          {children}
        </div>

        {(error || acciones) && (
          <footer className="shrink-0 border-t border-[#EDEDE8] px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col gap-2">
            {error && (
              <p role="alert" className="text-[12.5px] leading-snug text-[#8A2A24]">
                {error}
              </p>
            )}
            {acciones && <div className="flex flex-wrap items-start gap-2">{acciones}</div>}
          </footer>
        )}
      </section>
    </>
  );
}
