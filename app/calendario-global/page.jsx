"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import MarcoGlobal from "../../components/calendario-global/MarcoGlobal.jsx";
import SelectorClientes from "../../components/calendario-global/SelectorClientes.jsx";
import DetalleEvento from "../../components/calendario-global/DetalleEvento.jsx";
import Aviso, { useAviso } from "../../components/calendario-global/Aviso.jsx";
import { useClientes } from "../../components/calendario-global/useClientes.js";
import { usePreferencia } from "../../components/calendario-global/almacen.js";
import { useEsMovil } from "../../components/calendario-global/useEsMovil.js";
import { pedirJson } from "../../components/calendario-global/api.js";
import { FECHA, parteFecha, prioridad } from "../../components/calendario-global/formato.js";

/**
 * El calendario global (03/09/2026, Rodrigo): «poder controlar todos mis
 * calendarios desde un mismo macro calendario».
 *
 * ── QUÉ SE HACE AQUÍ Y QUÉ SE HACE EN EL TENANT ─────────────────────────────
 * Aquí se VE (los calendarios de los clientes, cada uno de su color) y se
 * MUEVE: arrastrar, estirar, marcar hecha. Todo lo demás —el título, las
 * notas, quién se encarga— se edita en el CRM del cliente: el botón «Abrir en
 * el CRM» de la ficha pide un pase y abre allí la sesión.
 *
 * ── 12/09/2026: TODOS LOS CLIENTES, SELECCIÓN RECORDADA Y PROYECTOS ─────────
 * Rodrigo: «No puedo seleccionar los calendarios que quiera ver […] y no se
 * ven las tareas traídas de proyectos». Y de la pantalla: «La UI es un poco
 * fea, está mal hecha, menos la parte del calendario puro».
 *   - El FullCalendar se deja COMO ESTABA (vistas, barra, horario, locale): es
 *     lo que le gusta. Se rehace todo lo de alrededor con las piezas de
 *     `components/calendario-global/`, que comparte la pestaña Proyectos.
 *   - La selección de clientes se recuerda (`useClientes`) y viaja al servidor
 *     en `?slugs=`: solo se leen los clientes que se miran.
 *   - Llegan también las fechas límite de tarjetas y los hitos de Proyectos
 *     (`?proyectos=0|1`, interruptor en la barra). Cada evento dice qué es en
 *     `extendedProps.kind` y el arrastre se ramifica por eso: un evento del
 *     calendario va a `PATCH /eventos/<slug>/<id>`; una tarjeta o un hito
 *     cambian su FECHA LÍMITE (`dueDate`, solo día) y, al guardar, se vuelven
 *     a pedir los eventos para que lo soltado en una franja con hora vuelva a
 *     ser de día entero. Estirar un evento de proyecto no significa nada: se
 *     deshace (el servidor además les pone `durationEditable: false`).
 *
 * Los ids de los eventos llevan el slug delante (`aumenta:uuid`); el de
 * verdad viaja en `extendedProps.taskId` / `milestoneId`.
 *
 * ── EN EL MÓVIL, OTRA BARRA (12/09/2026) ────────────────────────────────────
 * En escritorio el FullCalendar sigue exactamente igual. A 375-430 px la barra
 * de escritorio no cabe (el título partido en tres líneas, los botones
 * amontonados), así que en el móvil (`useEsMovil`, ≤ 640 px) arriba van las
 * flechas, el título y «Hoy», y abajo las vistas; y se arranca en «Lista» de
 * la semana, que en un teléfono se lee (siete columnas de franjas, no). Sin
 * «Semana» en la barra del móvil: es la vista que no se puede leer ahí.
 */

const CLAVE_COLOR_POR = "calendario-global:colorPor";
const CLAVE_PROYECTOS = "calendario-global:proyectos";

const BARRA_ESCRITORIO = { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" };
const BARRA_MOVIL = { left: "prev,next", center: "title", right: "today" };
const PIE_MOVIL = { center: "dayGridMonth,timeGridDay,listWeek" };

// Acotado a `.calendario-global` y solo en el móvil: el resto del CRM usa el
// mismo FullCalendar con los estilos de `app/globals.css`, que no se tocan.
// Va aquí y no como clases de Tailwind porque esas reglas no están en ninguna
// capa y ganarían a cualquier utilidad.
const ESTILO_MOVIL = `
@media (max-width: 640px) {
  .calendario-global .fc .fc-toolbar-title { font-size: 15px; white-space: nowrap; }
  .calendario-global .fc .fc-toolbar.fc-header-toolbar { margin-bottom: 0.5rem; gap: 0.5rem; }
  .calendario-global .fc .fc-toolbar.fc-footer-toolbar { margin-top: 0.5rem; }
}
`;

function esDeProyecto(ep) {
  return ep?.kind === "projectTask" || ep?.kind === "projectMilestone";
}

/**
 * «Color por prioridad»: cada tipo trae su color de otra forma. Los eventos
 * del calendario lo traen calculado (`colorPrioridad`); las tarjetas por su
 * prioridad; los hitos conservan el color de su estado (`colorOriginal`).
 */
function pintar(ev, colorPor) {
  if (colorPor !== "prioridad") return ev;
  const ep = ev.extendedProps ?? {};
  let color;
  if (ep.kind === "projectTask") color = prioridad(ep.priority).color;
  else if (ep.kind === "projectMilestone") color = ep.colorOriginal;
  else color = ep.colorPrioridad;
  color = color ?? ev.backgroundColor;
  return { ...ev, backgroundColor: color, borderColor: color };
}

/** El EventApi de FullCalendar es vivo y muere al recargar: a la ficha va una copia. */
function instantanea(event) {
  return {
    id: event.id,
    title: event.title,
    startStr: event.startStr,
    endStr: event.endStr,
    allDay: event.allDay,
    extendedProps: { ...(event.extendedProps ?? {}) },
  };
}

export default function CalendarioGlobalPage() {
  const calendarRef = useRef(null);
  const seleccion = useClientes();
  const { clientes, visibles, fusionarFichas } = seleccion;
  const [colorPor, setColorPor] = usePreferencia(CLAVE_COLOR_POR, "cliente", ["cliente", "prioridad"]);
  const [proyectosGuardado, setProyectosGuardado] = usePreferencia(CLAVE_PROYECTOS, "1", ["1", "0"]);
  const conProyectos = proyectosGuardado === "1";
  const [detalle, setDetalle] = useState(null);
  const [cargandoEventos, setCargandoEventos] = useState(false);
  const { aviso, avisar, cerrarAviso } = useAviso();

  const listo = !seleccion.cargando && !seleccion.error;

  // Lo que la función de eventos necesita y FullCalendar no le pasa. Vive en
  // una ref porque `events` tiene que ser una función ESTABLE: si cambiara en
  // cada pintado, FullCalendar volvería a pedir los eventos cada vez.
  const consultaRef = useRef({ listo: false, slugs: [], proyectos: true, colorPor: "cliente" });
  // La última respuesta, para repintar al cambiar «Color por» sin pedir nada.
  const ultimaRef = useRef({ clave: null, eventos: [] });
  const soloRepintarRef = useRef(false);

  const cargarEventos = useCallback(
    async (info, success, failure) => {
      const { listo: preparado, slugs, proyectos, colorPor: modo } = consultaRef.current;
      // Hasta saber qué clientes se miran no se pide nada (evita leerlos todos
      // y tirar la respuesta); sin ninguno a la vista, tampoco.
      if (!preparado || slugs.length === 0) {
        soloRepintarRef.current = false;
        success([]);
        return;
      }
      const params = new URLSearchParams({
        start: info.startStr.split("T")[0],
        end: info.endStr.split("T")[0],
        slugs: slugs.join(","),
        proyectos: proyectos ? "1" : "0",
      });
      const clave = params.toString();
      if (soloRepintarRef.current && ultimaRef.current.clave === clave) {
        soloRepintarRef.current = false;
        success(ultimaRef.current.eventos.map((e) => pintar(e, modo)));
        return;
      }
      soloRepintarRef.current = false;
      try {
        const data = await pedirJson(`/api/calendario-global/eventos?${params}`);
        const eventos = Array.isArray(data?.eventos) ? data.eventos : [];
        ultimaRef.current = { clave, eventos };
        // Las fichas vienen con cada carga: así se ve al momento si alguno no responde.
        fusionarFichas(data?.calendarios);
        success(eventos.map((e) => pintar(e, modo)));
      } catch (err) {
        failure(err);
      }
    },
    [fusionarFichas]
  );

  // Al cambiar la selección, el interruptor de proyectos o el color: se
  // actualiza lo que lee `cargarEventos` y se recarga. Si solo cambia el
  // color, se repinta con la última respuesta.
  useEffect(() => {
    const antes = consultaRef.current;
    const cambianDatos =
      antes.listo !== listo || antes.slugs.join(",") !== visibles.join(",") || antes.proyectos !== conProyectos;
    const cambiaColor = antes.colorPor !== colorPor;
    consultaRef.current = { listo, slugs: visibles, proyectos: conProyectos, colorPor };
    if (!cambianDatos && !cambiaColor) return;
    soloRepintarRef.current = !cambianDatos;
    calendarRef.current?.getApi().refetchEvents();
  }, [listo, visibles, conProyectos, colorPor]);

  function recargar() {
    calendarRef.current?.getApi().refetchEvents();
  }

  // ── Móvil ───────────────────────────────────────────────────────────────
  // `initialView` solo se lee al montar FullCalendar, y al hidratar la página
  // `useEsMovil` todavía dice «escritorio»: cuando se sabe que es un móvil, la
  // semana se pasa a lista a mano (como en CitasModule). Si se vuelve a
  // escritorio (girar una tableta), se deshace solo lo que se cambió aquí.
  const esMovil = useEsMovil();
  const vistaCambiadaRef = useRef(false);
  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (!api) return;
    const vista = api.view?.type;
    if (esMovil && vista === "timeGridWeek") {
      api.changeView("listWeek");
      vistaCambiadaRef.current = true;
    } else if (!esMovil && vistaCambiadaRef.current) {
      if (vista === "listWeek") api.changeView("timeGridWeek");
      vistaCambiadaRef.current = false;
    }
  }, [esMovil]);

  // ── Arrastrar y estirar ─────────────────────────────────────────────────
  async function moverEventoDelCalendario(info) {
    const { event } = info;
    const ep = event.extendedProps ?? {};
    const start = parteFecha(event.startStr);
    const end = parteFecha(event.endStr);
    try {
      await pedirJson(
        `/api/calendario-global/eventos/${encodeURIComponent(ep.calendario?.slug ?? "")}/${encodeURIComponent(ep.taskId ?? "")}`,
        {
          method: "PATCH",
          body: {
            startDate: start.date,
            startTime: start.time || null,
            endDate: end.date || null,
            endTime: end.time || null,
            allDay: event.allDay,
          },
        }
      );
      // La última respuesta ya no es la verdad: el evento está en otro sitio.
      // Sin esto, cambiar «Color por» repintaba esa foto y el evento volvía a
      // su hueco viejo (y estirarlo allí deshacía el arrastre en el servidor).
      // No se recarga ahora: lo que se ve ya es lo guardado (12/09/2026).
      ultimaRef.current.clave = null;
    } catch (e) {
      info.revert();
      avisar(e.message);
    }
  }

  async function moverFechaDeProyecto(info) {
    const ep = info.event.extendedProps ?? {};
    const slug = ep.calendario?.slug;
    const esTarjeta = ep.kind === "projectTask";
    const id = esTarjeta ? ep.taskId : ep.milestoneId;
    // Solo el día: soltado en una franja con hora, `startStr` trae la hora y
    // el desfase, y la fecha límite no tiene hora.
    const dueDate = String(info.event.startStr ?? "").split("T")[0];
    if (!slug || !id || !FECHA.test(dueDate)) {
      info.revert();
      avisar("No se ha podido leer la fecha de ese elemento. Recarga la página.");
      return;
    }
    const url = esTarjeta
      ? `/api/calendario-global/proyectos/${encodeURIComponent(slug)}/tareas/${encodeURIComponent(id)}`
      : `/api/calendario-global/proyectos/${encodeURIComponent(slug)}/hitos/${encodeURIComponent(id)}`;
    try {
      await pedirJson(url, { method: "PATCH", body: { dueDate } });
      recargar();
    } catch (e) {
      info.revert();
      avisar(e.message);
    }
  }

  function alSoltar(info) {
    if (esDeProyecto(info.event.extendedProps)) return moverFechaDeProyecto(info);
    return moverEventoDelCalendario(info);
  }

  function alEstirar(info) {
    if (esDeProyecto(info.event.extendedProps)) {
      info.revert();
      return undefined;
    }
    return moverEventoDelCalendario(info);
  }

  // ── Ficha ───────────────────────────────────────────────────────────────
  async function cambiarEstado(status) {
    const ep = detalle?.extendedProps ?? {};
    await pedirJson(
      `/api/calendario-global/eventos/${encodeURIComponent(ep.calendario?.slug ?? "")}/${encodeURIComponent(ep.taskId ?? "")}`,
      { method: "PATCH", body: { status } }
    );
    const id = detalle.id;
    setDetalle((d) => (d && d.id === id ? { ...d, extendedProps: { ...d.extendedProps, status } } : d));
    recargar();
  }

  const fichaDelDetalle = detalle
    ? clientes.find((c) => c.slug === detalle.extendedProps?.calendario?.slug) ?? null
    : null;

  // ── Avisos de la franja ─────────────────────────────────────────────────
  const visiblesSet = new Set(visibles);
  const sinRespuesta = clientes.filter((c) => c.fallo && visiblesSet.has(c.slug));
  const sinClientes = listo && clientes.length === 0;
  const ningunoVisible = listo && clientes.length > 0 && visibles.length === 0;

  const lateral = (
    <SelectorClientes
      seleccion={seleccion}
      modulo="calendario"
      proyectos={conProyectos}
      onProyectos={(v) => setProyectosGuardado(v ? "1" : "0")}
      colorPor={colorPor}
      onColorPor={setColorPor}
    />
  );

  return (
    <MarcoGlobal lateral={lateral} contador={listo ? visibles.length : null}>
      <div className="flex-1 min-h-0 flex flex-col gap-2 p-3 lg:p-4">
        {seleccion.error && (
          <Aviso tono="error" accion={{ texto: "Reintentar", onClick: seleccion.reintentar }}>
            No se ha podido cargar la lista de clientes. {seleccion.error}
          </Aviso>
        )}
        {sinClientes && <Aviso tono="info">Tu cuenta no ve ningún cliente todavía.</Aviso>}
        {ningunoVisible && (
          <Aviso tono="info" accion={{ texto: "Ver todos", onClick: seleccion.todos }}>
            No hay ningún cliente a la vista.
          </Aviso>
        )}
        {sinRespuesta.length > 0 && (
          <Aviso tono="error" accion={{ texto: "Reintentar", onClick: recargar }}>
            No responde{sinRespuesta.length > 1 ? "n" : ""}: {sinRespuesta.map((c) => c.nombre).join(", ")}. El resto se ve
            con normalidad.
          </Aviso>
        )}
        {aviso && (
          <Aviso tono={aviso.tono} onCerrar={cerrarAviso}>
            {aviso.texto}
          </Aviso>
        )}

        <div className="relative flex-1 min-h-[520px] bg-white rounded-[10px] border border-[#E7E7E1] p-2 lg:p-3 calendario-global">
          <style>{ESTILO_MOVIL}</style>
          {cargandoEventos && (
            <div
              role="status"
              aria-label="Cargando eventos"
              className="absolute left-3 right-3 top-0 h-0.5 rounded-full bg-[#3E5C57]/40 animate-pulse"
            />
          )}
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView={esMovil ? "listWeek" : "timeGridWeek"}
            headerToolbar={esMovil ? BARRA_MOVIL : BARRA_ESCRITORIO}
            footerToolbar={esMovil ? PIE_MOVIL : false}
            locale={esLocale}
            buttonText={{ today: "Hoy", month: "Mes", week: "Semana", day: "Día", list: "Lista" }}
            firstDay={1}
            slotMinTime="07:00:00"
            slotMaxTime="22:00:00"
            nowIndicator
            editable
            eventResizableFromStart
            events={cargarEventos}
            loading={(cargando) => setCargandoEventos(cargando)}
            eventSourceFailure={(err) => avisar(err?.message || "No se han podido cargar los eventos.")}
            eventClick={({ event, jsEvent }) => {
              jsEvent?.preventDefault?.();
              setDetalle(instantanea(event));
            }}
            eventDrop={alSoltar}
            eventResize={alEstirar}
            height="100%"
            eventDidMount={(info) => {
              const c = info.event.extendedProps?.calendario;
              if (c) info.el.title = `${c.nombre} · ${info.event.title}`;
            }}
          />
        </div>
      </div>

      {detalle && (
        <DetalleEvento
          key={detalle.id}
          evento={detalle}
          ficha={fichaDelDetalle}
          onCerrar={() => setDetalle(null)}
          onCambiarEstado={cambiarEstado}
        />
      )}
    </MarcoGlobal>
  );
}
