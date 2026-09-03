"use client";

/**
 * AgendaPorTerapeuta — una columna por persona del equipo, cada columna en
 * el día que se quiera, y las citas se ARRASTRAN de una columna a otra
 * (02/09/2026, AV-0016 de Aumenta; decidido por Rodrigo: «deja que lo
 * cambien sin problema»).
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * «Una entrevista inicial que iba a hacer una terapeuta la hace otra, y
 * quiero, viendo los dos horarios a la vez, mover la sesión de una agenda a
 * la otra.» Cambiar la terapeuta ya se podía desde la ficha de la cita, pero
 * la vista combinada pintaba a todo el mundo en la misma columna del día: no
 * había «otra agenda» a la que arrastrar.
 *
 * ── UN DÍA POR COLUMNA (03/09/2026, Rodrigo) ───────────────────────────────
 * «Poder mover una cita de hoy jueves del terapeuta A a mañana viernes del
 * terapeuta B, o al lunes que viene, o cuando quiera.» Encima del nombre de
 * cada columna hay un selector de día: las columnas arrancan todas en el día
 * general (las flechas de arriba, «Hoy» o la columna de meses) y cada una
 * puede irse a otro. Al soltar la cita en una columna cambia de persona Y de
 * fecha y hora a la vez, con un solo PATCH; si las flechas de arriba mueven
 * el día general, todas las columnas vuelven a ese día.
 *
 * ── CÓMO ESTÁ HECHO, Y POR QUÉ ASÍ ─────────────────────────────────────────
 * FullCalendar solo sabe partir un día en columnas por persona con su plugin
 * de recursos, que es de pago. Aquí cada columna es un calendario de día
 * entero e independiente, y se usa lo que la librería sí trae de fábrica:
 * arrastrar un evento de un calendario a otro (`droppable` + `eventReceive`
 * en el que recibe, `eventLeave` en el que suelta). Al soltar, un solo PATCH
 * a la cita con la persona de la columna y la fecha y hora donde cayó; el
 * servidor valida el solape y, si no deja, la cita vuelve a su sitio con el
 * aviso. Que cada columna sea su propio calendario es justo lo que permite
 * que cada una enseñe un día distinto sin más que un `gotoDate`.
 *
 * ── CÓMO SE LLAMA A LA GENTE ───────────────────────────────────────────────
 * «Terapeuta» solo en los centros clínicos; en el resto, «miembro». Lo decide
 * `lib/team/vocabulario.js` y llega en `vocabularioEquipo`: aquí no se
 * escribe la palabra a mano en ninguna frase.
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
import { VOCABULARIO_MIEMBRO } from "@/lib/team/vocabulario.js";
import { rotuloDeBloqueo } from "@/lib/citas/rotuloBloqueo.js";
import { toDateInput } from "./chips.jsx";

/** Con más columnas que esto el día no se lee; se avisa y se enseñan las primeras. */
const MAX_COLUMNAS = 8;

function sumarDias(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** «2026-09-03» del <input type="date"> → medianoche LOCAL de ese día (no UTC, que en invierno sería el día anterior). */
function desdeInputFecha(valor) {
  const [y, m, d] = String(valor ?? "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function mismoDia(a, b) {
  return toDateInput(a) === toDateInput(b);
}

export default function AgendaPorTerapeuta({
  teamMembers = [],
  visibleTmIds = null,
  fecha,
  onFecha,
  vista,
  onEventClick,
  avisar,
  // ¿Se avisa a la familia por correo al mover la cita? Lo pregunta el padre
  // (03/09/2026, Aumenta: el correo ya no sale sin confirmar). `null` = no
  // se avisa nunca desde aquí.
  preguntarSiAvisar = null,
  onVolver,
  vocabularioEquipo = VOCABULARIO_MIEMBRO,
  // Sube cuando el padre cambia algo desde fuera (el modal de la cita, un
  // bloqueo, una cita nueva): las columnas vuelven a leer sus eventos.
  version = 0,
}) {
  const voc = vocabularioEquipo;
  const columnas = useMemo(() => {
    const lista = teamMembers.filter((m) => !visibleTmIds || visibleTmIds.includes(m.id));
    return lista.slice(0, MAX_COLUMNAS);
  }, [teamMembers, visibleTmIds]);
  const recortadas = teamMembers.filter((m) => !visibleTmIds || visibleTmIds.includes(m.id)).length - columnas.length;

  /*
   * El día de cada columna. `fecha` es el día general; `propias` guarda las
   * columnas que se han ido a otro. Se guarda junto con el día general para
   * el que valen (`base`): en cuanto el padre cambia `fecha` —flechas, «Hoy»,
   * la columna de meses— las propias dejan de valer y todas las columnas
   * vuelven al día general. Así no hace falta un efecto que las borre.
   */
  const [diasPropios, setDiasPropios] = useState({ base: null, propias: new Map() });
  const propias = diasPropios.base !== null && mismoDia(diasPropios.base, fecha) ? diasPropios.propias : null;
  const fechaDe = useCallback((id) => propias?.get(id) ?? fecha, [propias, fecha]);
  function cambiarDiaDeColumna(id, d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return;
    const siguiente = new Map(propias ?? []);
    if (mismoDia(d, fecha)) siguiente.delete(id);
    else siguiente.set(id, d);
    setDiasPropios({ base: fecha, propias: siguiente });
  }
  const hayColumnasEnOtroDia = columnas.some((m) => !mismoDia(fechaDe(m.id), fecha));

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
    for (const m of columnas) refs.current.get(m.id)?.getApi?.().gotoDate(fechaDe(m.id));
  }, [columnas, fechaDe]);
  useEffect(() => {
    if (version > 0) refrescarTodas();
  }, [version, refrescarTodas]);

  const [moviendo, setMoviendo] = useState(false);

  /*
   * Los bloqueos se piden UNA vez aquí y cada columna se queda con los suyos
   * (02/09/2026, tarde: con ocho columnas eran dieciséis peticiones iguales
   * por cada día que se miraba). Se guardan en un ref y no en estado para que
   * cambiarlos no re-renderice las ocho columnas; en cuanto llegan, se les
   * pide a los calendarios que vuelvan a leer sus eventos.
   *
   * Desde que cada columna puede estar en un día distinto se piden los días
   * que haya en pantalla (uno de normal, dos o tres cuando se está moviendo
   * algo a otro día), una petición por día, y se juntan.
   */
  const bloqueosRef = useRef([]);
  const diasEnPantalla = useMemo(
    () => [...new Set(columnas.map((m) => toDateInput(fechaDe(m.id))))].sort().join(","),
    [columnas, fechaDe]
  );
  useEffect(() => {
    let vivo = true;
    const dias = diasEnPantalla ? diasEnPantalla.split(",") : [];
    Promise.all(
      dias.map((clave) => {
        const desde = desdeInputFecha(clave);
        const hasta = sumarDias(desde, 1);
        return fetch(`/api/citas/bloqueos?from=${encodeURIComponent(desde.toISOString())}&to=${encodeURIComponent(hasta.toISOString())}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((jb) => (jb?.ok ? jb.data.bloqueos ?? [] : []))
          .catch(() => []);
      })
    ).then((listas) => {
      if (!vivo) return;
      // El mismo bloqueo puede venir de dos días si los cruza: una vez basta.
      const vistos = new Set();
      bloqueosRef.current = listas.flat().filter((b) => !vistos.has(b.id) && vistos.add(b.id));
      refrescarTodas();
    });
    return () => { vivo = false; };
    // `version`: un bloqueo editado o borrado desde el modal también entra aquí.
  }, [diasEnPantalla, version, refrescarTodas]);

  /** Los bloqueos de una persona (y los del centro entero), como bloques fijos: aquí no se arrastran. */
  const fondosDe = useCallback((teamMemberId) =>
    bloqueosRef.current
      .filter((b) => !b.teamMemberId || b.teamMemberId === teamMemberId)
      .map((b) => {
        const color = b.color || COLOR_BLOQUEO_POR_DEFECTO;
        return {
          id: `bloqueo-${b.id}`,
          // Solo la categoría (03/09/2026): la misma regla que el calendario
          // grande, en lib/citas/rotuloBloqueo.js.
          title: rotuloDeBloqueo(b),
          start: b.startAt,
          end: b.endAt,
          display: "block",
          backgroundColor: color,
          borderColor: color,
          textColor: colorTextoSobre(color),
          editable: false,
          startEditable: false,
          extendedProps: {
            esBloqueo: true, bloqueoId: b.id, label: b.label, categoryKey: b.categoryKey ?? null, tallerId: b.tallerId ?? null,
            categoryLabel: b.categoryLabel ?? null, teamMemberName: b.teamMemberName ?? null,
          },
        };
      }), []);

  /**
   * Las citas de UNA persona para el día que mira su columna, tal como las
   * sirve el calendario. Una función por columna, creada UNA vez (useMemo por
   * ids): si cambiara en cada render, FullCalendar volvería a pedir los
   * eventos en cada render del padre. El día no hace falta aquí: FullCalendar
   * pide el rango que esté enseñando (`info.startStr`/`endStr`).
   */
  const eventosPorColumna = useMemo(() => {
    const mapa = new Map();
    for (const m of columnas) {
      mapa.set(m.id, async (info, success, failure) => {
        try {
          const params = new URLSearchParams({ start: info.startStr, end: info.endStr, teamMemberIds: m.id });
          const r = await fetch(`/api/citas/bookings/calendar?${params}`, { cache: "no-store" });
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || "Error cargando citas");
          success([...j.data, ...fondosDe(m.id)]);
        } catch (err) {
          failure(err);
        }
      });
    }
    return mapa;
  }, [columnas, fondosDe]);

  /**
   * La cita cae en OTRA columna: cambia de persona, y de fecha y hora si esa
   * columna está en otro día o se soltó a otra hora. `info.event.start` ya
   * viene en el día de la columna que recibe: FullCalendar la coloca donde
   * se soltó, así que el mismo PATCH sirve para el mismo día y para otro.
   */
  async function recibir(teamMemberId, info) {
    const inicio = info.event.start ? info.event.start.toISOString() : null;
    if (!inicio || info.event.extendedProps?.esBloqueo) {
      info.revert();
      return;
    }
    setMoviendo(true);
    try {
      const avisarPaciente = preguntarSiAvisar ? await preguntarSiAvisar(info.event.extendedProps, inicio) : false;
      const r = await fetch(`/api/citas/bookings/${info.event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamMemberId, scheduledAt: inicio, avisarPaciente }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `No se pudo pasar la cita a ${voc.ese}`);
      /*
       * La copia que soltó el arrastre NO viene de la fuente de eventos de esta
       * columna: FullCalendar la añade suelta al recibirla, y al releer la
       * fuente saldría dos veces (cazado en la demo el 02/09 por la tarde: la
       * cita se veía duplicada en la columna de destino). Se retira y manda lo
       * que devuelva el servidor en el refresco de abajo.
       */
      info.event.remove();
    } catch (err) {
      // El calendario de origen ya soltó la cita y `revert` solo la quita del
      // que recibe: se repintan TODAS antes de abrir el aviso, o la cita no
      // estaría en ninguna columna mientras el aviso siga abierto.
      info.revert();
      refrescarTodas();
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
      const avisarPaciente = preguntarSiAvisar ? await preguntarSiAvisar(info.event.extendedProps, inicio) : false;
      const r = await fetch(`/api/citas/bookings/${info.event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: inicio, avisarPaciente }),
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
  const btnMini = "text-[11px] leading-none w-5 h-5 inline-flex items-center justify-center rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-100 bg-white";

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
        {hayColumnasEnOtroDia && (
          <button
            type="button"
            onClick={() => setDiasPropios({ base: fecha, propias: new Map() })}
            className={btn}
            title="Todas las columnas vuelven al día de arriba"
          >
            Todas al mismo día
          </button>
        )}
        <span className="text-[11px] text-neutral-400 ml-auto">
          {moviendo
            ? "Moviendo…"
            : `Arrastra una cita a la columna de ${voc.otro} para pasársela. Cada columna puede enseñar un día distinto: cámbialo encima del nombre.`}
        </span>
      </div>
      {recortadas > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-1.5 mb-2 shrink-0">
          Se enseñan {columnas.length} agendas; hay {recortadas} más. Acota con el filtro de profesionales para verlas.
        </p>
      )}
      {columnas.length === 0 ? (
        <p className="text-sm text-neutral-500 py-10 text-center">No hay {voc.ninguno} que enseñar. Elige a alguien en el filtro de profesionales.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto">
          <div className="h-full flex gap-2" style={{ minWidth: `${columnas.length * 230}px` }}>
            {columnas.map((m) => {
              const color = m.avatarColor ?? COLOR_CITA_POR_DEFECTO;
              const dia = fechaDe(m.id);
              const enOtroDia = !mismoDia(dia, fecha);
              const diaCorto = dia.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
              return (
                <div key={m.id} className="flex-1 min-w-[220px] min-h-0 flex flex-col bg-white border border-neutral-100 rounded-xl overflow-hidden agenda-columna">
                  {/* El día de ESTA columna, encima del nombre (03/09/2026). Se
                      resalta cuando no es el día general para que no pase
                      desapercibido que se está mirando otra fecha. */}
                  <div
                    className={`px-2 py-1.5 border-b border-neutral-100 flex items-center gap-1 shrink-0 ${enOtroDia ? "bg-amber-50" : "bg-neutral-50/60"}`}
                    data-testid="columna-dia"
                  >
                    <button type="button" onClick={() => cambiarDiaDeColumna(m.id, sumarDias(dia, -1))} className={btnMini} aria-label={`Día anterior de ${m.displayName}`}>‹</button>
                    <span className={`text-[11px] capitalize w-7 text-center ${enOtroDia ? "text-amber-800 font-semibold" : "text-neutral-500"}`}>{diaCorto}</span>
                    <input
                      type="date"
                      value={toDateInput(dia)}
                      onChange={(e) => cambiarDiaDeColumna(m.id, desdeInputFecha(e.target.value))}
                      className="flex-1 min-w-0 text-[11px] px-1 py-0.5 rounded border border-neutral-200 bg-white text-neutral-700"
                      aria-label={`Día que enseña la columna de ${m.displayName}`}
                    />
                    <button type="button" onClick={() => cambiarDiaDeColumna(m.id, sumarDias(dia, 1))} className={btnMini} aria-label={`Día siguiente de ${m.displayName}`}>›</button>
                  </div>
                  <div className="px-3 py-2 border-b border-neutral-100 flex items-center gap-2 shrink-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[12px] font-medium text-neutral-800 truncate" title={m.displayName}>{m.displayName}</span>
                  </div>
                  <div className="flex-1 min-h-0">
                    <FullCalendar
                      ref={refDe(m.id)}
                      plugins={[timeGridPlugin, interactionPlugin]}
                      initialView="timeGridDay"
                      initialDate={toDateInput(dia)}
                      headerToolbar={false}
                      dayHeaders={false}
                      allDaySlot={false}
                      locale="es"
                      firstDay={1}
                      slotMinTime={vista?.slotMinTime ?? "07:00:00"}
                      slotMaxTime={vista?.slotMaxTime ?? "21:00:00"}
                      // De cuarto en cuarto, como el calendario grande
                      // (03/09/2026). Aquí la rejilla se queda en el horario
                      // del centro: ocho columnas de 24 horas, cada una con
                      // su propia barra, no se leen.
                      slotDuration="00:15:00"
                      slotLabelInterval="01:00:00"
                      snapDuration="00:15:00"
                      displayEventEnd={false}
                      eventMinHeight={8}
                      slotEventOverlap={false}
                      expandRows={true}
                      height="100%"
                      events={eventosPorColumna.get(m.id)}
                      eventClick={onEventClick}
                      editable={true}
                      eventDurationEditable={false}
                      droppable={true}
                      eventDrop={mover}
                      // El calendario de origen se queda sin la cita en cuanto
                      // la otra columna la acepta (eventLeave, sin manejador
                      // propio); si el PATCH falla, el refresco general la
                      // vuelve a pintar donde estaba.
                      eventReceive={(info) => { recibir(m.id, info).catch(() => refrescarTodas()); }}
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
