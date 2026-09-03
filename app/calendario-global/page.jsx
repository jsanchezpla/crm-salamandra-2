"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";

/**
 * El calendario global (03/09/2026, Rodrigo): «poder controlar todos mis
 * calendarios desde un mismo macro calendario».
 *
 * ── QUÉ SE HACE AQUÍ Y QUÉ SE HACE EN EL TENANT ─────────────────────────────
 * Aquí se VE (todos los calendarios vinculados, cada uno de su color) y se
 * MUEVE: arrastrar, estirar, marcar hecha. Todo lo demás —el título, las
 * notas, quién se encarga, la convocatoria— se edita en el CRM del cliente:
 * el botón «Abrir en …» de la ficha pide un pase y abre allí la sesión, en
 * ese evento. Es la regla que pidió Rodrigo, y por eso la ficha no tiene
 * formulario: si lo tuviera, la gente editaría aquí a medias.
 *
 * Los ids de los eventos llevan el slug delante (`aumenta:uuid`); el de
 * verdad viaja en `extendedProps.taskId`.
 */

const PRIORITY_COLORS = { high: "#ef4444", medium: "#f97316", low: "#22c55e" };
const PRIORITY_LABELS = { high: "Alta", medium: "Media", low: "Baja" };
const STATUS_LABELS = { pending: "Pendiente", done: "Hecha", cancelled: "Cancelada" };
const STATUS_CHIP = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  done: "bg-emerald-50 text-emerald-800 border-emerald-200",
  cancelled: "bg-neutral-100 text-neutral-500 border-neutral-200",
};

function parseISOToFields(iso) {
  if (!iso) return { date: "", time: "" };
  const [date, rest] = iso.split("T");
  return { date, time: rest ? rest.slice(0, 5) : "" };
}

function fmtFecha(ev) {
  const start = parseISOToFields(ev.startStr);
  const end = parseISOToFields(ev.endStr);
  const d = new Date(`${start.date}T12:00:00`);
  const dia = d.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" });
  if (ev.allDay) {
    if (end.date && end.date !== start.date) {
      const d2 = new Date(`${end.date}T12:00:00`);
      // FullCalendar da el fin de un todo-el-día EXCLUSIVO: el día siguiente.
      d2.setDate(d2.getDate() - 1);
      const dia2 = d2.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" });
      if (dia2 !== dia) return `${dia} → ${dia2} · todo el día`;
    }
    return `${dia} · todo el día`;
  }
  const horas = start.time ? (end.time ? `${start.time}–${end.time}` : start.time) : "";
  return horas ? `${dia} · ${horas}` : dia;
}

export default function CalendarioGlobalPage() {
  const calendarRef = useRef(null);
  const [yo, setYo] = useState(null);
  const [calendarios, setCalendarios] = useState([]);
  const [ocultos, setOcultos] = useState(() => new Set());
  const ocultosRef = useRef(ocultos);
  const [colorPor, setColorPor] = useState("cliente");
  const colorPorRef = useRef("cliente");
  const [detalle, setDetalle] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    fetch("/api/calendario-global/vinculos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "No se pudo cargar");
        setYo(j.data.yo);
        setCalendarios(j.data.calendarios);
      })
      .catch((e) => setAviso({ tono: "error", texto: e.message }))
      .finally(() => setCargando(false));
  }, []);

  function pintar(ev) {
    const ep = ev.extendedProps ?? {};
    const color = colorPorRef.current === "prioridad" ? (ep.colorPrioridad ?? ev.backgroundColor) : ev.backgroundColor;
    return { ...ev, backgroundColor: color, borderColor: color };
  }

  const fetchEvents = useCallback(async (info, success, failure) => {
    try {
      const params = new URLSearchParams({
        start: info.startStr.split("T")[0],
        end: info.endStr.split("T")[0],
      });
      const res = await fetch(`/api/calendario-global/eventos?${params}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Error cargando eventos");
      // Las fichas de los calendarios vienen con cada carga: así se ve al
      // momento si alguno no responde.
      setCalendarios((prev) =>
        (json.data.calendarios ?? []).map((c) => ({ ...(prev.find((p) => p.slug === c.slug) ?? {}), ...c }))
      );
      const ocultosAhora = ocultosRef.current;
      success((json.data.eventos ?? []).filter((e) => !ocultosAhora.has(e.extendedProps?.calendario?.slug)).map(pintar));
    } catch (err) {
      failure(err);
    }
  }, []);

  function alternarCalendario(slug) {
    setOcultos((prev) => {
      const s = new Set(prev);
      if (s.has(slug)) s.delete(slug);
      else s.add(slug);
      ocultosRef.current = s;
      return s;
    });
    calendarRef.current?.getApi().refetchEvents();
  }

  function cambiarColorPor(modo) {
    colorPorRef.current = modo;
    setColorPor(modo);
    calendarRef.current?.getApi().refetchEvents();
  }

  async function patch(ev, cambios) {
    const ep = ev.extendedProps;
    const res = await fetch(`/api/calendario-global/eventos/${ep.calendario.slug}/${ep.taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cambios),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || "No se pudo guardar");
    return json.data;
  }

  async function handleMove(info) {
    const { event } = info;
    const start = parseISOToFields(event.startStr);
    const end = parseISOToFields(event.endStr);
    try {
      await patch(event, {
        startDate: start.date,
        startTime: start.time || null,
        endDate: end.date || null,
        endTime: end.time || null,
        allDay: event.allDay,
      });
    } catch (e) {
      info.revert();
      setAviso({ tono: "error", texto: e.message });
    }
  }

  function handleEventClick({ event }) {
    setDetalle(event);
  }

  async function cambiarEstado(status) {
    if (!detalle || ocupado) return;
    setOcupado(true);
    try {
      await patch(detalle, { status });
      setDetalle(null);
      calendarRef.current?.getApi().refetchEvents();
    } catch (e) {
      setAviso({ tono: "error", texto: e.message });
    } finally {
      setOcupado(false);
    }
  }

  async function abrirEnTenant() {
    if (!detalle || ocupado) return;
    const ep = detalle.extendedProps;
    setOcupado(true);
    try {
      const res = await fetch("/api/calendario-global/salto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: ep.calendario.slug,
          taskId: ep.taskId,
          fecha: parseISOToFields(detalle.startStr).date || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "No se pudo abrir el CRM del cliente");
      // Se abre en OTRA pestaña: el global se queda donde estaba, que es lo
      // que se quiere cuando se está repasando la semana de todos.
      window.open(json.data.url, "_blank", "noopener");
    } catch (e) {
      setAviso({ tono: "error", texto: e.message });
    } finally {
      setOcupado(false);
    }
  }

  const calDe = (ev) => calendarios.find((c) => c.slug === ev?.extendedProps?.calendario?.slug);
  const sinVinculos = !cargando && calendarios.length === 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
      {/* Leyenda: qué calendarios se están mirando */}
      <aside className="lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-neutral-200 bg-white px-4 py-3 lg:py-4 flex flex-col gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Calendarios</div>
          {yo?.email && <div className="text-[12px] text-neutral-500 mt-0.5 truncate">{yo.email}</div>}
        </div>
        {sinVinculos && (
          <p className="text-[13px] text-neutral-600 leading-relaxed">
            Tu cuenta no tiene ningún calendario vinculado. Se vinculan desde el back-office o con
            <code className="mx-1 text-[11px] bg-neutral-100 px-1 rounded">calendario-global-vincular.js</code>.
          </p>
        )}
        <ul className="flex flex-wrap lg:flex-col gap-1.5">
          {calendarios.map((c) => {
            const oculto = ocultos.has(c.slug);
            return (
              <li key={c.slug}>
                <button
                  type="button"
                  onClick={() => alternarCalendario(c.slug)}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-neutral-50 ${oculto ? "opacity-45" : ""}`}
                  title={oculto ? "Mostrar" : "Ocultar"}
                >
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: c.color, outline: oculto ? "1px solid #d4d4d4" : "none" }} />
                  <span className="truncate">{c.nombre}</span>
                  {!c.calendario && <span className="ml-auto text-[10px] text-neutral-400">sin Calendario</span>}
                  {c.calendario && c.fallo && <span className="ml-auto text-[10px] text-red-600">no responde</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto pt-2">
          <div className="text-[11px] uppercase tracking-[0.16em] text-neutral-400 mb-1.5">Color por</div>
          <div className="inline-flex rounded-md border border-neutral-200 overflow-hidden text-[12px]">
            {[["cliente", "Cliente"], ["prioridad", "Prioridad"]].map(([k, t]) => (
              <button
                key={k}
                type="button"
                onClick={() => cambiarColorPor(k)}
                className={`px-2.5 py-1 ${colorPor === k ? "bg-[#1B3A2D] text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* El calendario */}
      <section className="flex-1 min-h-0 flex flex-col p-3 lg:p-4">
        {aviso && (
          <div
            className={`mb-3 rounded-md border px-3 py-2 text-[13px] flex items-start justify-between gap-3 ${aviso.tono === "error" ? "bg-red-50 border-red-200 text-red-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}
          >
            <span>{aviso.texto}</span>
            <button type="button" onClick={() => setAviso(null)} className="text-current/60 hover:text-current" aria-label="Cerrar">×</button>
          </div>
        )}
        <div className="flex-1 min-h-[520px] bg-white rounded-xl border border-neutral-200 p-2 lg:p-3 calendario-global">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
            locale={esLocale}
            buttonText={{ today: "Hoy", month: "Mes", week: "Semana", day: "Día", list: "Lista" }}
            firstDay={1}
            slotMinTime="07:00:00"
            slotMaxTime="22:00:00"
            nowIndicator
            editable
            eventResizableFromStart
            events={fetchEvents}
            eventClick={handleEventClick}
            eventDrop={handleMove}
            eventResize={handleMove}
            height="100%"
            eventDidMount={(info) => {
              const c = info.event.extendedProps?.calendario;
              if (c) info.el.title = `${c.nombre} · ${info.event.title}`;
            }}
          />
        </div>
      </section>

      {/* Ficha del evento, en modo LECTURA. Lo de dentro se edita en el tenant. */}
      {detalle && (() => {
        const ep = detalle.extendedProps ?? {};
        const cal = calDe(detalle);
        const status = ep.status ?? "pending";
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setDetalle(null); }}
          >
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92dvh] flex flex-col">
              <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500 mb-1">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ep.calendario?.color }} />
                    {ep.calendario?.nombre}
                  </div>
                  <div className="text-base font-semibold text-neutral-900 leading-snug">{detalle.title}</div>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_CHIP[status] ?? STATUS_CHIP.pending}`}>
                      {STATUS_LABELS[status] ?? status}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
                      <span className="w-2 h-2 rounded-full" style={{ background: PRIORITY_COLORS[ep.priority] ?? PRIORITY_COLORS.medium }} />
                      Prioridad {(PRIORITY_LABELS[ep.priority] ?? PRIORITY_LABELS.medium).toLowerCase()}
                    </span>
                    {ep.categoryName && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
                        <span className="w-2 h-2 rounded-full" style={{ background: ep.colorCategoria ?? "#A3A3A3" }} />
                        {ep.categoryName}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setDetalle(null)} className="text-neutral-400 hover:text-neutral-700 p-0.5" aria-label="Cerrar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="px-5 py-4 space-y-2 overflow-y-auto flex-1 text-[13px]">
                <div className="flex">
                  <span className="w-24 text-neutral-400 shrink-0">Fecha</span>
                  <span className="text-neutral-800">{fmtFecha(detalle)}</span>
                </div>
                {ep.clientName && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400 shrink-0">Cliente</span>
                    <span className="text-neutral-800">{ep.clientName}</span>
                  </div>
                )}
                {ep.teamMemberName && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400 shrink-0">Responsable</span>
                    <span className="text-neutral-800">{ep.teamMemberName}</span>
                  </div>
                )}
                {ep.meetUrl && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400 shrink-0">Videollamada</span>
                    <a href={ep.meetUrl} target="_blank" rel="noopener noreferrer" className="text-neutral-800 underline break-all">{ep.meetUrl}</a>
                  </div>
                )}
                {ep.notes && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400 shrink-0">Notas</span>
                    <span className="text-neutral-700 whitespace-pre-wrap">{ep.notes}</span>
                  </div>
                )}
                <p className="pt-2 text-[12px] text-neutral-400 leading-relaxed">
                  Desde aquí se mueve y se marca. Para cambiar el contenido, ábrelo en el CRM de {ep.calendario?.nombre}.
                </p>
              </div>
              <div className="px-5 py-3.5 border-t border-[#F0F0F0] flex flex-wrap justify-end gap-2">
                <button onClick={() => setDetalle(null)} className="text-xs text-neutral-500 px-3 py-1.5">Cerrar</button>
                {status === "done" ? (
                  <button onClick={() => cambiarEstado("pending")} disabled={ocupado} className="text-xs font-medium px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
                    Reabrir
                  </button>
                ) : (
                  <button onClick={() => cambiarEstado("done")} disabled={ocupado} className="text-xs font-medium px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
                    Marcar hecha
                  </button>
                )}
                {cal?.puedeSaltar ? (
                  <button onClick={abrirEnTenant} disabled={ocupado} className="text-xs font-medium px-3 py-1.5 rounded-md text-white disabled:opacity-50" style={{ backgroundColor: "#1B3A2D" }}>
                    {ocupado ? "Abriendo…" : `Abrir en ${ep.calendario?.nombre} ↗`}
                  </button>
                ) : (
                  <span className="text-[11px] text-neutral-400 self-center" title="Este calendario no tiene cuenta de salto vinculada">
                    Sin cuenta para abrir el CRM
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
