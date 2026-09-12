"use client";

import { useEffect, useState } from "react";
import { IconoLista } from "./Iconos.jsx";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO } from "./estilos.js";

/**
 * MarcoGlobal — «barra lateral + contenido» de las pestañas del calendario
 * global (12/09/2026).
 *
 * En escritorio (lg, ≥1024 px) la barra va fija a la izquierda, 256 px, con su
 * propio desplazamiento: con todos los clientes de Salamandra la lista es más
 * larga que la pantalla y no debe arrastrar al calendario al bajar.
 *
 * Por debajo, la barra desaparece y en su lugar sale un botón «Clientes (n)»
 * que abre la misma barra en un panel desde la izquierda (regla 13 del
 * CLAUDE.md: fondo `z-40`, panel `z-50`). Aquí no hay barra móvil del CRM que
 * respetar —este host no monta el menú del dashboard—, así que el panel ocupa
 * el alto entero. Se cierra con «Hecho», tocando fuera o con Escape; no se
 * cierra al marcar un cliente porque lo normal es marcar varios.
 *
 * Props:
 *   lateral     el contenido de la barra (normalmente `<SelectorClientes>`)
 *   contador    el número del botón del móvil (clientes a la vista)
 *   barraMovil  nodo opcional a la derecha del botón, solo en móvil
 *   children    el contenido de la pestaña
 *
 * El contenido tiene su propio desplazamiento vertical: la pestaña Proyectos
 * puede ser una lista larga y el calendario, si la ventana es baja, también.
 */
export default function MarcoGlobal({ lateral, contador = null, barraMovil = null, children }) {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return undefined;
    const alTeclear = (e) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  return (
    <div className="flex-1 min-h-0 flex">
      <aside
        aria-label="Clientes"
        className="hidden lg:flex w-64 shrink-0 flex-col min-h-0 border-r border-[#E7E7E1] bg-white"
      >
        {lateral}
      </aside>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto">
        <div className="lg:hidden flex items-center gap-2 px-3 pt-3">
          <button
            type="button"
            onClick={() => setAbierto(true)}
            aria-haspopup="dialog"
            aria-expanded={abierto}
            className={BOTON_SECUNDARIO}
          >
            <IconoLista className="w-4 h-4 text-[#5C6461]" />
            Clientes{contador != null ? ` (${contador})` : ""}
          </button>
          {barraMovil && <div className="flex-1 min-w-0 flex items-center justify-end gap-2">{barraMovil}</div>}
        </div>
        {children}
      </div>

      {abierto && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setAbierto(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Clientes"
            className="lg:hidden fixed inset-y-0 left-0 z-50 w-[min(320px,88vw)] flex flex-col bg-white border-r border-[#E7E7E1] shadow-[4px_0_16px_rgba(0,0,0,0.08)]"
          >
            <div className="flex-1 min-h-0 flex flex-col">{lateral}</div>
            <div className="shrink-0 border-t border-[#E7E7E1] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button type="button" onClick={() => setAbierto(false)} className={`${BOTON_PRIMARIO} w-full`}>
                Hecho
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
