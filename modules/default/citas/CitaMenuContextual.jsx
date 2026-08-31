"use client";

import { useEffect, useRef } from "react";

/**
 * El menú contextual de una cita (31/08/2026, Rodrigo en la formación): clic
 * derecho sobre la caja → información del paciente, cortar, copiar y cobrar.
 *
 * Solo pinta: recibe las acciones ya decididas (rótulo, deshabilitada y qué
 * hacer) desde CitasModule, que es quien sabe de módulos y de estado. Se
 * cierra con Escape, pulsando fuera o al elegir una acción.
 */
export function CitaMenuContextual({ menu, acciones, onCerrar }) {
  const ref = useRef(null);

  useEffect(() => {
    function fuera(e) {
      if (ref.current && !ref.current.contains(e.target)) onCerrar();
    }
    function tecla(e) {
      if (e.key === "Escape") onCerrar();
    }
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [onCerrar]);

  if (!menu) return null;

  // Que no se salga de la pantalla si el clic fue pegado al borde.
  const ancho = 232;
  const alto = 40 * acciones.length + 34;
  const left = Math.max(4, Math.min(menu.x, window.innerWidth - ancho - 8));
  const top = Math.max(4, Math.min(menu.y, window.innerHeight - alto - 8));

  return (
    <div
      ref={ref}
      className="fixed z-50 w-[232px] bg-white rounded-xl shadow-pop border border-neutral-100 py-1"
      style={{ left, top }}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-neutral-400 truncate border-b border-neutral-50">
        {menu.titulo}
      </div>
      {acciones.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={a.deshabilitada}
          title={a.deshabilitada && a.motivo ? a.motivo : undefined}
          onClick={a.onClick}
          className="w-full text-left px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-300 disabled:cursor-not-allowed disabled:hover:bg-white flex items-center gap-2 transition-colors"
        >
          <span className="w-4 text-center">{a.icono}</span>
          {a.rotulo}
        </button>
      ))}
    </div>
  );
}
