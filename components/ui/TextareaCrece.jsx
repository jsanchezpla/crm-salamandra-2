"use client";

import { useEffect, useRef } from "react";

/**
 * Un textarea que crece con lo que lleva dentro (03/09/2026, AV-0036 de
 * Aumenta: «es bastante tedioso leer bien el mensaje que pone en el apartado
 * de acción realizada»).
 *
 * ── POR QUÉ ────────────────────────────────────────────────────────────────
 * Las cajas de la ficha de una incidencia tenían dos y tres filas fijas y
 * `resize-none`: quien la escribió no lo nota, pero quien la RECIBE lee un
 * texto de doce líneas por una ranura de tres. Esta caja empieza en `rows`,
 * crece hasta `maxAlto` (por defecto el 45 % del alto visible) y a partir de
 * ahí hace scroll dentro; y se puede estirar a mano (`resize-y`).
 *
 * Es un `<textarea>` normal: acepta todo lo que acepte uno (value, onChange,
 * placeholder, className…). El alto se recalcula cada vez que cambia `value`,
 * así que también crece al cargar una incidencia ya escrita.
 */
export default function TextareaCrece({ value, rows = 3, maxAlto = "45dvh", className = "", style, ...rest }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A «auto» primero: si no, al borrar texto el alto se quedaría en el
    // máximo alcanzado.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={rows}
      className={`resize-y ${className}`}
      style={{ maxHeight: maxAlto, overflowY: "auto", ...style }}
      {...rest}
    />
  );
}
