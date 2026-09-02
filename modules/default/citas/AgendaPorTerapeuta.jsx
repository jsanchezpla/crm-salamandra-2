"use client";

/**
 * AgendaPorTerapeuta — un día, una columna por terapeuta, y las citas se
 * ARRASTRAN de una columna a otra (02/09/2026, AV-0016 de Aumenta; decidido
 * por Rodrigo: «deja que lo cambien sin problema»).
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * «Una entrevista inicial que iba a hacer una terapeuta la hace otra, y
 * quiero, viendo los dos horarios a la vez, mover la sesión de una agenda a
 * la otra.» Cambiar la terapeuta ya se podía desde la ficha de la cita, pero
 * la vista combinada pintaba a todo el mundo en la misma columna del día: no
 * había «otra agenda» a la que arrastrar.
 *
 * ── CÓMO ESTÁ HECHO, Y POR QUÉ ASÍ ─────────────────────────────────────────
 * FullCalendar solo sabe partir un día en columnas por persona con su plugin
 * de recursos, que es de pago. Aquí cada columna es un calendario de día
 * entero e independiente, y se usa lo que la librería sí trae de fábrica:
 * arrastrar un evento de un calendario a otro (`droppable` + `eventReceive`
 * en el que recibe, `eventLeave` en el que suelta). Al soltar, un solo PATCH
 * a la cita con la terapeuta de la columna y la hora donde cayó; el servidor
 * valida el solape y, si no deja, la cita vuelve a su sitio con el aviso.
 *
 * Lo que NO se hace aquí: bloqueos arrastrables, clic derecho, crear citas.
 * Para eso está la agenda de siempre, a un clic («Volver»).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { COLOR_BLOQUEO_POR_DEFECTO, colorTextoSobre } from "@/lib/citas/coloresBloqueo.js";
import { COLOR_CITA_POR_DEFECTO } from "@/lib/citas/filtros.js";

/** Con más columnas que esto el día no se lee; se avisa y se enseñan las primeras. */
const MAX_COLUMNAS = 8;

function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function sumarDias(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export default function AgendaPorTerapeuta({
  teamMembers = [],
  visibleTmIds = null,
  fecha,
  onFecha,
  vista,
  onEventClick,
  avisar,
  onVolver,
}) {
  const columnas = useMemo(() => {
    const lista = teamMembers.filter((m) => !visibleTmIds || visibleTmIds.includes(m.id));
    return lista.slice(0, MAX_COLUMNAS);
  }, [teamMembers, visibleTmIds]);
  const recortadas = teamMembers.filter((m) => !visibleTmIds || visibleTmIds.includes(m.id)).length - columnas.length;

  // Un ref por columna, para mover la fecha y refrescar todas a la vez.
  const refs = useRef(new Map());
  const refDe = useCallback((id) => (el) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  }, []);
  const refrescarTodas = useCallback(() => {
    for (const cal of refs.current.values()) cal.getApi?.().refetchEvents();
  }, []);

  useEffect(() => {
    for (const cal of refs.current.values()) cal.getApi?.().gotoDate(fecha);
  }, [fecha]);

  const [moviendo, setMoviendo] = useState(false);

  /** Las citas de UNA terapeuta para el día que se mira, tal como las sirve el calendario. */
  const eventosDe = useCallback(
    (teamMemberId) => async (info, success, failure) => {
      try {
        const params = new URLSearchParams({ start: info.startStr, end: info.endStr, teamMemberIds: teamMemberId });
        const r = await fetch(`/api/citas/bookings/calendar?${params}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "Error cargando citas");
        // Los bloqueos de esa persona y los cierres del centro, como bloques
        // fijos: aquí no se arrastran (para eso está la agenda de siempre).
        let fondos = [];
        try {
          const rb = await fetch(`/api/citas/bloqueos?from=${info.startStr}&to=${info.endStr}`, { cache: "no-store" });
          const jb = await rb.json();
          if (jb.ok) {
            fondos = (jb.data.bloqueos ?? [])
              .filter((b) => !b.teamMemberId || b.teamMemberId === teamMemberId)
              .map((b) => {
                const color = b.color || COLOR_BLOQUEO_POR_DEFECTO;
                return {
                  id: `bloqueo-${b.id}`,
                  title: [b.categoryLabel && b.categoryLabel !== b.label ? b.categoryLabel : null, b.label, b.teamMemberName || "Todo el centro"].filter(Boolean).join(" · "),
                  start: b.startAt,
                  end: b.endAt,
                  display: "block",
                  backgroundColor: color,
                  borderColor: color,
                  textColor: colorTextoSobre(color),
                  editable: false,
                  startEditable: false,
                  extendedProps: { esBloqueo: true, bloqueoId: b.id, label: b.label, categoryKey: b.categoryKey ?? null, tallerId: b.tallerId ?? null },
                };
              });
          }
        } catch {
          fondos = [];
        }
        success([...j.data, ...fondos]);
      } catch (err) {
        failure(err);
      }
    },
    []
  );

  /** La cita cae en OTRA columna: cambia de terapeuta (y de hora, si se soltó en otra). */
  async function recibir(teamMemberId, info) {
    const inicio = info.event.start ? info.event.start.toISOString() : null;
    if (!inicio || info.event.extendedProps?.esBloqueo) {
      info.revert();
      return;
    }
    setMoviendo(true);
    try {
      const r = await fetch(`/api/citas/bookings/${info.event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamMemberId, scheduledAt: inicio }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo pasar la cita a esa terapeuta");
    } catch (err) {
      info.revert();
      await avisar?.({ titulo: "La cita no se ha movido", texto: err.message });
    } finally {
      setMoviendo(false);
      refrescarTodas();
    }
  }

  /** La cita se mueve DENTRO de su columna: solo cambia la hora. */
  async function mover(info) {
    const inicio = info.event.start ? info.event.start.toISOString() : null;
    if (!inicio || info.event.extendedProps?.esBloqueo) {
      info.revert();
      return;
    }
    try {
      const r = await fetch(`/api/citas/bookings/${info.event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: inicio }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo mover la cita");
      refrescarTodas();
    } catch (err) {
      info.revert();
      await avisar?.({ titulo: "La cita no se ha movido", texto: err.message });
    }
  }

  const titulo = fecha.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const btn = "text-[12px] px-2.5 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="agenda-por-terapeuta">
      <div className="flex items-center gap-2 flex-wrap mb-2 shrink-0">
        <button type="button" onClick={onVolver} className={btn} title="Volver a la agenda de siempre">
          ← Volver
        </button>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onFecha(sumarDias(fecha, -1))} className={btn} aria-label="Día anterior">‹</button>
          <button type="button" onClick={() => onFecha(new Date())} className={btn}>Hoy</button>
          <button type="button" onClick={() => onFecha(sumarDias(fecha, 1))} className={btn} aria-label="Día siguiente">›</button>
        </div>
        <span className="font-display text-base text-[var(--ink-900)] capitalize">{titulo}</span>
        <span className="text-[11px] text-neutral-400 ml-auto">
          {moviendo ? "Moviendo…" : "Arrastra una cita a la columna de otra terapeuta para pasársela."}
        </span>
      </div>
      {recortadas > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-1.5 mb-2 shrink-0">
          Se enseñan {columnas.length} agendas; hay {recortadas} más. Acota con el filtro de profesionales para verlas.
        </p>
      )}
      {columnas.length === 0 ? (
        <p className="text-sm text-neutral-500 py-10 text-center">No hay ninguna terapeuta que enseñar. Elige alguna en el filtro de profesionales.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto">
          <div className="h-full flex gap-2" style={{ minWidth: `${columnas.length * 230}px` }}>
            {columnas.map((m) => {
              const color = m.avatarColor ?? COLOR_CITA_POR_DEFECTO;
              return (
                <div key={m.id} className="flex-1 min-w-[220px] min-h-0 flex flex-col bg-white border border-neutral-100 rounded-xl overflow-hidden agenda-columna">
                  <div className="px-3 py-2 border-b border-neutral-100 flex items-center gap-2 shrink-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[12px] font-medium text-neutral-800 truncate" title={m.displayName}>{m.displayName}</span>
                  </div>
                  <div className="flex-1 min-h-0">
                    <FullCalendar
                      ref={refDe(m.id)}
                      plugins={[timeGridPlugin, interactionPlugin]}
                      initialView="timeGridDay"
                      initialDate={ymd(fecha)}
                      headerToolbar={false}
                      dayHeaders={false}
                      allDaySlot={false}
                      locale="es"
                      firstDay={1}
                      slotMinTime={vista?.slotMinTime ?? "07:00:00"}
                      slotMaxTime={vista?.slotMaxTime ?? "22:00:00"}
                      displayEventEnd={false}
                      eventMinHeight={8}
                      slotEventOverlap={false}
                      expandRows={true}
                      height="100%"
                      events={eventosDe(m.id)}
                      eventClick={onEventClick}
                      editable={true}
                      eventDurationEditable={false}
                      droppable={true}
                      eventDrop={mover}
                      eventReceive={(info) => recibir(m.id, info)}
                      // El calendario de origen se queda sin la cita en cuanto
                      // la otra columna la acepta; si el PATCH falla, `revert`
                      // en el que recibe la devuelve y el refresco general
                      // vuelve a pintarla donde estaba.
                      eventLeave={() => {}}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
