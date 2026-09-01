// La agenda del CALENDARIO en la portada (01/09/2026, Rodrigo: «el inicio
// universal tiene una gráfica gigante y ya porque no hay agenda»).
//
// Quien no tiene Citas no tenía NADA en la mitad izquierda: la portada se
// quedaba coja y la gráfica se estiraba a lo ancho de la pantalla para tapar el
// hueco. Pero agenda sí hay —el Calendario del equipo—, y es la que se pinta
// aquí: reuniones, coordinaciones y lo que cada uno se apunta.
//
// Cuando hoy está vacío enseña LO QUE VIENE en las dos semanas siguientes, con
// su día delante, y lo dice en el rótulo. Un panel que contesta «no hay nada»
// un viernes por la tarde y se calla lo del lunes no sirve para organizarse.
//
// Gemela de MiAgenda.jsx a propósito: misma caja, mismas filas, mismo tamaño de
// letra. Las dos pueden convivir en la misma columna (un centro con Citas Y
// Calendario) y tienen que leerse como una sola cosa.

const PUNTO_SIN_CATEGORIA = "var(--ink-300)";

function Fila({ ev, conDia }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 border-t border-[var(--ink-100)] first:border-t-0 text-[13px]">
      <span
        className={`font-mono text-[11px] shrink-0 ${conDia ? "w-12" : "w-10"} ${
          ev.hecha ? "text-[var(--ink-300)]" : "text-[var(--ink-400)]"
        }`}
      >
        {conDia ? ev.dia : ev.todoElDia ? "todo" : (ev.hora ?? "—")}
      </span>
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: ev.color || PUNTO_SIN_CATEGORIA }}
        title={ev.categoria || "Sin categoría"}
      />
      <span className={`flex-1 min-w-0 truncate ${ev.hecha ? "text-[var(--ink-400)] line-through" : "text-[var(--ink-900)]"}`}>
        {ev.titulo}
      </span>
      {ev.categoria && (
        <span className="hidden sm:block shrink-0 max-w-[38%] truncate text-[10px] text-[var(--ink-400)]">
          {ev.categoria}
        </span>
      )}
    </div>
  );
}

export default function AgendaCalendario({ agenda }) {
  if (!agenda) return null;
  const { esHoy, eventos = [] } = agenda;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] p-4 lg:p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-[13px] font-semibold text-[var(--ink-900)]">
          {esHoy ? "Hoy en el calendario" : "Lo que viene"}
        </div>
        <a
          href="/calendario"
          className="text-[11px] text-[var(--ink-400)] hover:text-[var(--color-primary)] transition-colors shrink-0"
        >
          Abrir calendario →
        </a>
      </div>
      <div className="text-[11px] text-[var(--ink-400)] mb-2">
        {esHoy
          ? `${eventos.length} ${eventos.length === 1 ? "cosa apuntada para hoy" : "cosas apuntadas para hoy"}`
          : eventos.length > 0
            ? "Hoy no hay nada apuntado; esto es lo próximo"
            : "Las próximas dos semanas están libres"}
      </div>

      {eventos.length > 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto max-h-[320px] lg:max-h-none pr-1">
          {eventos.map((ev) => (
            <Fila key={ev.id} ev={ev} conDia={!esHoy} />
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-[var(--ink-400)] mt-1">
          Nada apuntado. Lo que se apunte en el Calendario aparecerá aquí.
        </div>
      )}
    </div>
  );
}
