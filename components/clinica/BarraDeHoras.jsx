"use client";

import { formatoHoras } from "../../lib/clinica/diagnostico.js";

/**
 * BarraDeHoras — las horas de un diagnóstico, de un vistazo (12/09/2026).
 *
 * Cuatro tramos que suman el tope, en el orden en que pasan las cosas:
 * [entrevista | hechas | reservadas | libres]. Los anchos y el rótulo («3 de
 * 10 h · 2 reservadas») vienen ya calculados de `lib/clinica/diagnostico.js`
 * (`tramosDeBarra`, `rotuloDeBarra`) a través de la fila de la API: aquí no
 * se cuenta nada, solo se pinta. Contar en la pantalla es como acabaría
 * habiendo una barra que dice 11 h en un producto de 10.
 *
 * Colores sobrios y distintos entre sí sin depender del color del centro:
 * la entrevista en el color del tenant (es lo primero y lo único), las
 * hechas en verde apagado, las reservadas en ámbar claro (están en la agenda,
 * aún se pueden mover) y lo libre en gris.
 */

const COLOR = {
  entrevista: "bg-[var(--color-primary,#1B3A2D)]",
  hechas: "bg-emerald-600/80",
  reservadas: "bg-amber-300",
  libres: "bg-neutral-200",
};

const NOMBRE = {
  entrevista: "Entrevista inicial",
  hechas: "Horas dadas",
  reservadas: "Horas reservadas en la agenda",
  libres: "Horas libres",
};

export default function BarraDeHoras({ tramos = [], rotulo = "", agotado = false, compacta = false }) {
  const titulo = tramos
    .filter((t) => t.horas > 0)
    .map((t) => `${NOMBRE[t.clave] ?? t.clave}: ${formatoHoras(t.horas)} h`)
    .join(" · ");
  return (
    <div className={compacta ? "min-w-[120px]" : "min-w-[160px]"} title={titulo || rotulo}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={rotulo}>
        {tramos.map((t) =>
          t.pct > 0 ? (
            <div key={t.clave} className={`${COLOR[t.clave] ?? "bg-neutral-300"} h-full`} style={{ width: `${t.pct}%` }} />
          ) : null
        )}
      </div>
      <div className={`mt-1 text-[11px] tabular ${agotado ? "text-amber-700 font-medium" : "text-neutral-500"}`}>
        {rotulo}
        {agotado && " · sin horas libres"}
      </div>
    </div>
  );
}

/** La leyenda de los cuatro colores, para ponerla una vez encima de la lista. */
export function LeyendaDeHoras() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
      {["entrevista", "hechas", "reservadas", "libres"].map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2 w-3 rounded-sm ${COLOR[k]}`} />
          {NOMBRE[k]}
        </span>
      ))}
    </div>
  );
}
