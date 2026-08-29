"use client";

// La gráfica única de la portada (26/08/2026, Rodrigo): las vistas por módulo
// van en UNA tarjeta que rota sola cada 5 segundos, se para mientras el ratón
// esté encima y se cambia a mano con las flechas o los puntitos. Sin números
// fijos sobre las barras: el dato sale en un globito al pasar el ratón, por
// delante de todo (por eso la tarjeta no recorta su overflow).

import { useEffect, useRef, useState } from "react";

const eur = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    Number(n || 0)
  );

function formatea(valor, unidad) {
  if (unidad === "eur") return eur(valor);
  if (unidad === "pct") return `${valor} %`;
  const [sing, plur] = unidad;
  if (valor === 0) return `sin ${plur}`;
  return `${valor} ${valor === 1 ? sing : plur}`;
}

export default function GraficaRotatoria({ vistas }) {
  const [idx, setIdx] = useState(0);
  const encima = useRef(false);

  useEffect(() => {
    if (!vistas || vistas.length < 2) return;
    const t = setInterval(() => {
      if (!encima.current) setIdx((i) => (i + 1) % vistas.length);
    }, 5000);
    return () => clearInterval(t);
  }, [vistas?.length]);

  if (!vistas || vistas.length === 0) return null;
  const actual = Math.min(idx, vistas.length - 1);
  const v = vistas[actual];
  // Un porcentaje se mide contra 100, no contra el máximo de la serie: media
  // agenda ocupada tiene que verse como media barra (puede pasar de 100 si
  // alguien hizo más horas que su objetivo).
  const max = Math.max(...v.datos.map((d) => d.valor), v.unidad === "pct" ? 100 : 1);
  const ultimo = v.datos.length - 1;

  return (
    <div
      className="flex-1 min-h-[220px] lg:min-h-0 flex flex-col bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] p-4 lg:p-5 relative"
      onMouseEnter={() => (encima.current = true)}
      onMouseLeave={() => (encima.current = false)}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[13px] font-semibold text-[var(--ink-900)] truncate">{v.titulo}</div>
        {vistas.length > 1 && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-1">
              {vistas.map((x, i) => (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setIdx(i)}
                  aria-label={x.titulo}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === actual ? "bg-[var(--color-primary)]" : "bg-[var(--ink-200)] hover:bg-[var(--ink-300)]"
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIdx((actual - 1 + vistas.length) % vistas.length)}
              aria-label="Gráfica anterior"
              className="w-6 h-6 rounded-full border border-[var(--ink-200)] text-[var(--ink-500)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors flex items-center justify-center"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setIdx((actual + 1) % vistas.length)}
              aria-label="Gráfica siguiente"
              className="w-6 h-6 rounded-full border border-[var(--ink-200)] text-[var(--ink-500)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors flex items-center justify-center"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Las barras, siempre hacia arriba. El globito se ancla al borde en la
          primera y la última para no salirse de la tarjeta. */}
      <div
        className="flex-1 min-h-0 flex items-end gap-2 sm:gap-3 border-b border-[var(--ink-200)]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to top, transparent 0, transparent calc(25% - 1px), var(--ink-100) calc(25% - 1px), var(--ink-100) 25%)",
        }}
      >
        {v.datos.map((d, i) => {
          const pct = Math.round((d.valor / max) * 100);
          const anclaje =
            i === 0 ? "left-0" : i === ultimo ? "right-0" : "left-1/2 -translate-x-1/2";
          return (
            <div key={i} className="group relative flex-1 h-full flex flex-col items-center justify-end min-w-0">
              <div
                className={`absolute ${anclaje} z-30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap rounded-md bg-[var(--ink-900)] text-white text-[11px] font-mono px-2 py-1 shadow-lg`}
                style={{ bottom: `calc(${pct}% + 6px)` }}
              >
                {d.tooltip} · {formatea(d.valor, v.unidad)}
              </div>
              <div
                className={`w-full max-w-[44px] rounded-t ${
                  d.resalte ? "bg-[var(--color-primary)]" : "bg-[var(--color-primary)]/55"
                }`}
                style={{ height: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 sm:gap-3 mt-1.5">
        {v.datos.map((d, i) => (
          <div
            key={i}
            className="flex-1 min-w-0 truncate text-center font-mono text-[9px] uppercase tracking-wide text-[var(--ink-400)]"
          >
            {d.etiqueta}
          </div>
        ))}
      </div>
    </div>
  );
}
