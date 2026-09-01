// «Mi trabajo» — la mitad derecha de la portada para quien NO está adherido a
// facturación (29/08/2026, Rodrigo: sin gráficas de ningún tipo; a cambio, lo
// operativo). Tres cajas con la misma receta visual que el resto de la portada,
// cada una solo si su dueño tiene algo que ver: la bandeja (informes +
// incidencias asignadas), la semana que viene, los documentos que le han pedido
// leer y las tareas propias. El gating vive en el servidor
// (lib/home/summary.js → buildTrabajo); aquí solo se pinta.
//
// Componente de SERVIDOR a propósito: no hay estado que mantener, y las horas
// se formatean en Madrid explícitamente (no en la zona del servidor).

const CHIP_INCIDENCIA = {
  pending: { texto: "Pendiente", clase: "bg-amber-100 text-amber-800" },
  in_progress: { texto: "En proceso", clase: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]" },
};

const PUNTO_PRIORIDAD = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-[var(--ink-300)]",
};

function hora(iso) {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}

function diaCorto(iso) {
  return new Date(iso)
    .toLocaleDateString("es-ES", { weekday: "short", day: "numeric", timeZone: "Europe/Madrid" })
    .replace(",", "");
}

// Para las fechas civiles (DATEONLY): se leen en UTC para que no se muevan.
function diaCivil(yyyymmdd) {
  return new Date(yyyymmdd + "T00:00:00Z")
    .toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .replace(",", "");
}

function Caja({ titulo, href, hrefLabel, className = "", children }) {
  return (
    <div className={`bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] p-4 lg:p-5 flex flex-col ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-[13px] font-semibold text-[var(--ink-900)]">{titulo}</div>
        {href && (
          <a href={href} className="text-[11px] text-[var(--ink-400)] hover:text-[var(--color-primary)] transition-colors">
            {hrefLabel} →
          </a>
        )}
      </div>
      {children}
    </div>
  );
}

export default function MiTrabajo({ trabajo }) {
  if (!trabajo) return null;
  const { bandeja, proximas, tareas, lecturas } = trabajo;

  return (
    <>
      {bandeja && (
        <Caja titulo="Mi bandeja" href="/equipo/bandeja" hrefLabel="Abrir bandeja" className="shrink-0">
          <div className="text-[11px] text-[var(--ink-400)] mb-2">
            {bandeja.informes > 0 && (
              <span className={bandeja.vencidos > 0 ? "text-red-600 font-medium" : undefined}>
                {bandeja.informes} {bandeja.informes === 1 ? "informe pendiente" : "informes pendientes"}
                {bandeja.vencidos > 0 && ` (${bandeja.vencidos} ${bandeja.vencidos === 1 ? "vencido" : "vencidos"})`}
              </span>
            )}
            {bandeja.informes > 0 && bandeja.incidenciasTotal > 0 && " · "}
            {bandeja.incidenciasTotal > 0 &&
              `${bandeja.incidenciasTotal} ${bandeja.incidenciasTotal === 1 ? "incidencia abierta" : "incidencias abiertas"}`}
          </div>
          {bandeja.incidencias.map((inc) => {
            const chip = CHIP_INCIDENCIA[inc.estado] || null;
            return (
              <div
                key={inc.id}
                className="flex items-center gap-2.5 py-1.5 border-t border-[var(--ink-100)] first:border-t-0 text-[13px]"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${PUNTO_PRIORIDAD[inc.prioridad] || PUNTO_PRIORIDAD.low}`}
                  title={`Prioridad ${inc.prioridadLabel?.toLowerCase() || ""}`}
                />
                <span className="flex-1 min-w-0 truncate text-[var(--ink-900)]">{inc.titulo}</span>
                {chip && (
                  <span className={`shrink-0 text-[9px] font-semibold rounded-full px-2 py-0.5 ${chip.clase}`}>
                    {chip.texto}
                  </span>
                )}
              </div>
            );
          })}
        </Caja>
      )}

      {proximas && (
        <Caja titulo="Próximas citas" href="/citas" hrefLabel="Abrir agenda" className="flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto max-h-[320px] lg:max-h-none pr-1">
            {proximas.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2.5 py-1.5 border-t border-[var(--ink-100)] first:border-t-0 text-[13px]"
              >
                <span className="font-mono text-[11px] w-[4.5rem] shrink-0 text-[var(--ink-400)]">
                  {diaCorto(c.scheduledAt)} {hora(c.scheduledAt)}
                </span>
                <span className="flex-1 min-w-0 truncate text-[var(--ink-900)]">{c.clientName || "Sin nombre"}</span>
                {c.tipo && (
                  <span className="hidden sm:block shrink-0 max-w-[40%] truncate text-[10px] text-[var(--ink-400)]">
                    {c.tipo}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Caja>
      )}

      {lecturas && (
        <Caja titulo="Por leer" href="/documentos/lecturas" hrefLabel="Ver todos" className="shrink-0">
          {/* El enlace ES la descarga: abrir el documento es lo que sella la
              lectura (lib/documents/lecturas.js), así que no hay un paso
              intermedio entre verlo aquí y darlo por leído. */}
          {lecturas.map((d) => (
            <a
              key={d.id}
              href={d.href}
              className="flex items-center gap-2.5 py-1.5 border-t border-[var(--ink-100)] first:border-t-0 text-[13px] hover:text-[var(--color-primary)] transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-400" />
              <span className="flex-1 min-w-0 truncate text-[var(--ink-900)]">{d.nombre}</span>
            </a>
          ))}
        </Caja>
      )}

      {tareas && (
        <Caja titulo="Mis tareas" href="/calendario" hrefLabel="Abrir calendario" className="shrink-0">
          {tareas.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2.5 py-1.5 border-t border-[var(--ink-100)] first:border-t-0 text-[13px]"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PUNTO_PRIORIDAD[t.priority] || PUNTO_PRIORIDAD.low}`} />
              <span className="flex-1 min-w-0 truncate text-[var(--ink-900)]">{t.title}</span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--ink-400)]">
                {diaCivil(t.startDate)}
                {t.startTime ? ` · ${t.startTime.slice(0, 5)}` : ""}
              </span>
            </div>
          ))}
        </Caja>
      )}
    </>
  );
}
