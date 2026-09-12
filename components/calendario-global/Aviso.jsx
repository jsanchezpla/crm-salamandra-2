"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconoCerrar } from "./Iconos.jsx";
import { FOCO } from "./estilos.js";

/**
 * Aviso del calendario global (12/09/2026): una franja FINA encima del
 * contenido, no una caja.
 *
 * La pantalla de antes metía los errores en un recuadro rojo de lado a lado
 * que empujaba el calendario hacia abajo; con un arrastre fallido cada poco,
 * la rejilla bailaba. Esto ocupa una línea, se descarta con la equis y, si es
 * una confirmación (`tono: "ok"`), se va sola a los cuatro segundos.
 *
 * `accion` = `{ texto, onClick }` para lo que se arregla con un botón
 * («Reintentar», «Ver todos»).
 */

const TONO = {
  error: "border-[#F0D5D2] bg-[#FBEFEE] text-[#8A2A24]",
  info: "border-[#E7E7E1] bg-white text-[#3F4845]",
  ok: "border-[#CFDDD6] bg-[#EEF4F1] text-[#2F5A4B]",
};

export default function Aviso({ tono = "error", children, accion = null, onCerrar = null }) {
  return (
    <div
      role={tono === "error" ? "alert" : "status"}
      className={`flex items-center gap-3 min-h-8 rounded-md border px-3 py-1 text-[12.5px] leading-snug ${TONO[tono] ?? TONO.info}`}
    >
      <span className="flex-1 min-w-0">{children}</span>
      {accion && (
        <button
          type="button"
          onClick={accion.onClick}
          className={`shrink-0 font-medium underline underline-offset-2 hover:no-underline rounded-sm ${FOCO}`}
        >
          {accion.texto}
        </button>
      )}
      {onCerrar && (
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar aviso"
          className={`shrink-0 -mr-1.5 w-6 h-6 inline-flex items-center justify-center rounded opacity-60 hover:opacity-100 ${FOCO}`}
        >
          <IconoCerrar className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/** `{ aviso, avisar(texto, tono = "error"), cerrarAviso }` para una pantalla. */
export function useAviso() {
  const [aviso, setAviso] = useState(null);
  const temporizador = useRef(null);

  const cerrarAviso = useCallback(() => {
    clearTimeout(temporizador.current);
    setAviso(null);
  }, []);

  const avisar = useCallback((texto, tono = "error") => {
    clearTimeout(temporizador.current);
    setAviso({ texto: String(texto || "Algo ha fallado. Vuelve a probar."), tono });
    if (tono === "ok") temporizador.current = setTimeout(() => setAviso(null), 4000);
  }, []);

  useEffect(() => {
    const t = temporizador;
    return () => clearTimeout(t.current);
  }, []);

  return { aviso, avisar, cerrarAviso };
}
