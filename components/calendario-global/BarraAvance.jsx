/**
 * Barra de avance de un proyecto en el calendario global (12/09/2026): una
 * línea fina con el porcentaje al lado.
 *
 * El número es el de `lib/projects/faseProgreso.js` (tareas hechas y hitos
 * completados de todas las fases), el mismo que enseña la ficha del proyecto
 * en el CRM. Un proyecto sin tareas ni hitos no está al 0 %: no hay nada que
 * contar, y se pinta con una raya para no meterlo entre los atascados.
 */
export default function BarraAvance({ valor = null, className = "" }) {
  const hay = typeof valor === "number" && Number.isFinite(valor);
  const pct = hay ? Math.max(0, Math.min(100, Math.round(valor))) : null;
  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <span
        role="progressbar"
        aria-label="Avance"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={hay ? pct : undefined}
        aria-valuetext={hay ? `${pct} %` : "Sin tareas ni hitos"}
        className="relative flex-1 min-w-10 h-1.5 rounded-full bg-[#EDEDE8] overflow-hidden"
      >
        {hay && (
          <span
            className={`absolute inset-y-0 left-0 rounded-full ${pct === 100 ? "bg-[#1F3B34]" : "bg-[#5E7F78]"}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </span>
      <span className="shrink-0 w-9 text-right text-[12px] tabular-nums text-[#5C6461]">{hay ? `${pct} %` : "—"}</span>
    </span>
  );
}
