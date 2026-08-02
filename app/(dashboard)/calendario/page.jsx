"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import Select from "@/components/ui/Select.jsx";

const PRIORITY_COLORS = { high: "#ef4444", medium: "#f97316", low: "#22c55e" };
const PRIORITY_LABELS = { high: "Alta", medium: "Media", low: "Baja" };
const STATUS_OPTIONS = [
  { value: "pending", label: "Pendiente" },
  { value: "done", label: "Completada" },
  { value: "cancelled", label: "Cancelada" },
];

const EMPTY_FORM = {
  title: "",
  notes: "",
  priority: "medium",
  status: "pending",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  allDay: false,
  clientId: "",
  teamMemberId: "",
};

function parseISOToFields(isoString) {
  if (!isoString) return { date: "", time: "" };
  if (isoString.includes("T")) {
    const [date, timePart] = isoString.split("T");
    return { date, time: timePart.substring(0, 5) };
  }
  return { date: isoString, time: "" };
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function addDaysStr(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// Eventos del calendario "resultado propuesto": las tareas de la semana con los
// movimientos de la propuesta activa aplicados. Las movidas se resaltan en verde;
// el resto se atenúa para que destaquen los cambios.
function buildPreviewEvents(weekEvents, moves) {
  const moveById = new Map((moves || []).map((m) => [m.taskId, m]));
  return (weekEvents || []).map((ev) => {
    // Se descartan los colores del evento original: los recalcula el bloque de abajo.
    const { color, backgroundColor, borderColor, ...rest } = ev;
    const m = moveById.get(ev.id);
    if (!m) {
      return { ...rest, backgroundColor: "#E5E7EB", borderColor: "#E5E7EB", textColor: "#4B5563" };
    }
    const start = m.allDay ? m.newDate : m.startTime ? `${m.newDate}T${m.startTime}` : m.newDate;
    return { ...rest, start, end: null, allDay: !!m.allDay, backgroundColor: "#10B981", borderColor: "#059669", textColor: "#FFFFFF" };
  });
}

export default function CalendarioPage() {
  const calendarRef = useRef(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [clients, setClients] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  // Integración con Proyectos: eventos de tarjetas Kanban (dueDate) e hitos.
  const [hasProjects, setHasProjects] = useState(false); // ¿el tenant/usuario tiene el módulo?
  const [showProjects, setShowProjects] = useState(true);
  const showProjectsRef = useRef(true); // fetchEvents vive en un useCallback([]): lee el ref
  const [projectInfo, setProjectInfo] = useState(null); // mini-modal de evento de proyecto
  // IA "Reorganizar la semana" — 3 propuestas navegables (1/2/3 + flechas)
  const [reorg, setReorg] = useState(null); // { loading, err, proposals, model, taskCount } | null
  const [reorgIndex, setReorgIndex] = useState(0); // propuesta activa (0..2)
  const [reorgApplying, setReorgApplying] = useState(false);

  // Datos para los desplegables de cliente / responsable (opcionales).
  useEffect(() => {
    fetch("/api/clients?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setClients(j.data?.clients ?? []))
      .catch(() => {});
    fetch("/api/team?status=all&limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setTeamMembers(j.data?.members ?? []))
      .catch(() => {});
    // ¿El tenant/usuario tiene módulo Proyectos? Si /api/projects responde OK,
    // se muestra el toggle "Proyectos"; si 403, se oculta (no confundir).
    fetch("/api/projects?limit=1", { cache: "no-store" })
      .then((r) => setHasProjects(r.ok))
      .catch(() => {});
  }, []);

  const clientOptions = [
    { value: "", label: "Sin cliente" },
    ...clients.map((c) => ({ value: c.id, label: c.name })),
  ];
  const teamOptions = [
    { value: "", label: "Sin asignar" },
    ...teamMembers.map((m) => ({ value: m.id, label: m.displayName })),
  ];

  const fetchEvents = useCallback(async (fetchInfo, successCallback, failureCallback) => {
    try {
      const params = new URLSearchParams({
        start: fetchInfo.startStr.split("T")[0],
        end: fetchInfo.endStr.split("T")[0],
      });
      if (!showProjectsRef.current) params.set("projects", "0");
      const res = await fetch(`/api/calendar/tasks?${params}`);
      if (!res.ok) throw new Error("Error cargando eventos");
      const json = await res.json();
      successCallback(json.data ?? []);
    } catch (err) {
      failureCallback(err);
    }
  }, []);

  function toggleProjects() {
    const next = !showProjectsRef.current;
    showProjectsRef.current = next;
    setShowProjects(next);
    calendarRef.current?.getApi().refetchEvents();
  }

  // Lunes de la semana que el usuario está VIENDO (no siempre hoy): getDate()
  // da la fecha de referencia de la vista actual de FullCalendar.
  function currentWeekMonday() {
    let d;
    try { d = calendarRef.current?.getApi()?.getDate() || new Date(); }
    catch { d = new Date(); }
    const day = d.getDay(); // 0=domingo..6=sábado
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
    const p = (n) => String(n).padStart(2, "0");
    return `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`;
  }
  async function loadReorg() {
    setReorgIndex(0);
    setReorg({ loading: true, proposals: [], err: null });
    const monday = currentWeekMonday();
    const sunday = addDaysStr(monday, 6); // rango inclusivo lunes..domingo (no toca la semana siguiente)
    // El preview respeta el toggle de Proyectos: si está apagado, no trae sus eventos.
    const projParam = showProjectsRef.current ? "" : "&projects=0";
    try {
      // En paralelo: propuestas + todas las tareas de la semana (para el calendario preview).
      const [r, te] = await Promise.all([
        fetch("/api/calendar/reorganize", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart: monday }),
        }),
        fetch(`/api/calendar/tasks?start=${monday}&end=${sunday}${projParam}`, { cache: "no-store" }),
      ]);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo reorganizar");
      const tj = te.ok ? await te.json() : null;
      setReorg({
        loading: false,
        proposals: j.data.proposals || [],
        model: j.data.model,
        taskCount: j.data.taskCount ?? 0,
        weekStart: monday,
        weekEvents: tj?.data || [],
        err: null,
        applyError: null,
      });
    } catch (e) {
      setReorg({ loading: false, proposals: [], err: e.message });
    }
  }
  async function applyReorg() {
    const moves = reorg?.proposals?.[reorgIndex]?.moves || [];
    if (!moves.length) return;
    setReorgApplying(true);
    let failed = 0;
    try {
      for (const m of moves) {
        try {
          const res = await fetch(`/api/calendar/tasks/${m.taskId}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              startDate: m.newDate,
              startTime: m.startTime || null,
              // Tarea de un solo día: si tenía hora de fin, se conserva EN EL NUEVO día
              // (antes se mandaba null y se perdía la duración).
              endDate: m.endTime ? m.newDate : null,
              endTime: m.endTime || null,
              allDay: !!m.allDay,
            }),
          });
          if (!res.ok) failed += 1;
        } catch { failed += 1; }
      }
      calendarRef.current?.getApi().refetchEvents();
      if (failed > 0) {
        // Aplicación parcial: NO cerrar en silencio, avisar de lo que falló.
        setReorg((r) => (r ? { ...r, applyError: `Se aplicaron ${moves.length - failed} de ${moves.length} cambios; ${failed} fallaron. Cierra y vuelve a intentarlo.` } : r));
      } else {
        setReorg(null);
      }
    } finally {
      setReorgApplying(false);
    }
  }
  // Navegar entre las 3 propuestas (flechas / teclado). Envuelve (0→2, 2→0).
  const reorgCount = reorg?.proposals?.length || 0;
  function stepReorg(delta) {
    if (reorgCount < 2) return;
    setReorgIndex((i) => (i + delta + reorgCount) % reorgCount);
  }
  // Cerrar el modal de reorganizar. No cierra mientras se están aplicando los
  // cambios (evita dejar PUTs a medias y el calendario moviéndose "solo").
  function closeReorg() {
    if (reorgApplying) return;
    setReorg(null);
  }
  useEffect(() => {
    if (!reorg || reorg.loading || reorg.err || reorgCount < 1) return;
    function onKey(e) {
      if (reorgApplying) return; // congelar navegación/cierre durante el aplicado
      if (e.key === "ArrowRight") stepReorg(1);
      else if (e.key === "ArrowLeft") stepReorg(-1);
      else if (e.key === "Escape") setReorg(null);
      else if (e.key >= "1" && e.key <= "3") {
        const n = Number(e.key) - 1;
        if (n < reorgCount) setReorgIndex(n);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reorg, reorgCount, reorgApplying]); // eslint-disable-line react-hooks/exhaustive-deps
  function openCreate(startDate = todayStr(), endDate = "", startTime = "", endTime = "", allDay = false) {
    setFormError(null);
    setModal({ mode: "create", form: { ...EMPTY_FORM, startDate, endDate, startTime, endTime, allDay } });
  }

  // Doble clic en un hueco → evento nuevo listo para editar. FullCalendar no
  // emite doble clic, así que lo detectamos: dos `dateClick` sobre el mismo
  // hueco en menos de 400 ms. Un clic suelto no crea nada (evita abrir el
  // formulario al navegar por el calendario).
  const lastClickRef = useRef({ at: 0, key: "" });
  function handleDateClick(info) {
    const key = info.dateStr;
    const now = Date.now();
    const prev = lastClickRef.current;
    if (prev.key === key && now - prev.at < 400) {
      lastClickRef.current = { at: 0, key: "" };
      const startDate = info.dateStr.split("T")[0];
      const startTime = info.dateStr.includes("T") ? info.dateStr.split("T")[1].substring(0, 5) : "";
      openCreate(startDate, "", startTime, "", info.allDay);
    } else {
      lastClickRef.current = { at: now, key };
    }
  }

  function handleSelect(info) {
    const startDate = info.startStr.split("T")[0];
    let endDate = info.endStr.split("T")[0];
    // FC all-day end is exclusive; normalize to same as start for single-day
    if (info.allDay && endDate !== startDate) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - 1);
      endDate = d.toISOString().split("T")[0];
    }
    const startTime = info.startStr.includes("T") ? info.startStr.split("T")[1].substring(0, 5) : "";
    const endTime = info.endStr.includes("T") ? info.endStr.split("T")[1].substring(0, 5) : "";
    openCreate(startDate, endDate !== startDate ? endDate : "", startTime, endTime, info.allDay);
    info.view.calendar.unselect();
  }

  function handleEventClick(info) {
    const { event } = info;
    const ep = event.extendedProps;
    // Eventos de PROYECTOS: no son CalendarTask — mini-modal con enlace al
    // proyecto en vez del formulario de edición (editarlos aquí corrompería).
    if (ep.kind === "projectTask" || ep.kind === "projectMilestone") {
      setProjectInfo({
        kind: ep.kind,
        title: event.title,
        date: event.startStr?.split("T")[0] ?? "",
        projectId: ep.projectId,
        projectName: ep.projectName,
        projectCode: ep.projectCode,
        columnName: ep.columnName ?? null,
        priority: ep.priority ?? null,
        status: ep.status ?? null,
      });
      return;
    }
    const start = parseISOToFields(event.startStr);
    const end = parseISOToFields(event.endStr);
    setFormError(null);
    setModal({
      mode: "edit",
      taskId: event.id,
      form: {
        title: event.title,
        notes: ep.notes ?? "",
        priority: ep.priority ?? "medium",
        status: ep.status ?? "pending",
        startDate: start.date,
        startTime: start.time,
        endDate: end.date,
        endTime: end.time,
        allDay: event.allDay,
        clientId: ep.clientId ?? "",
        teamMemberId: ep.teamMemberId ?? "",
      },
    });
  }

  // Arrastrar un evento de PROYECTO = cambiar su fecha límite real (PATCH en el
  // módulo de proyectos). Devuelve true si lo gestionó (era de proyecto).
  async function dropProjectEvent(info) {
    const ep = info.event.extendedProps;
    if (ep.kind !== "projectTask" && ep.kind !== "projectMilestone") return false;
    const dueDate = info.event.startStr?.split("T")[0];
    const url = ep.kind === "projectTask"
      ? `/api/tasks/${ep.taskId}`
      : `/api/projects/${ep.projectId}/milestones/${ep.milestoneId}`;
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueDate }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Sin permiso para mover fechas de proyectos");
      }
      // Refresca para que el evento vuelva a pintarse como todo-el-día.
      calendarRef.current?.getApi().refetchEvents();
    } catch (e) {
      info.revert();
      window.alert(e.message);
    }
    return true;
  }

  async function handleEventDrop(info) {
    if (await dropProjectEvent(info)) return;
    const { event } = info;
    const start = parseISOToFields(event.startStr);
    const end = parseISOToFields(event.endStr);
    try {
      const res = await fetch(`/api/calendar/tasks/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: start.date,
          startTime: start.time || null,
          endDate: end.date || null,
          endTime: end.time || null,
          allDay: event.allDay,
        }),
      });
      if (!res.ok) throw new Error();
    } catch {
      info.revert();
    }
  }

  async function handleEventResize(info) {
    const { event } = info;
    const ep = event.extendedProps;
    // Los eventos de proyecto son de un solo día (fecha límite): no se estiran.
    if (ep.kind === "projectTask" || ep.kind === "projectMilestone") {
      info.revert();
      return;
    }
    const start = parseISOToFields(event.startStr);
    const end = parseISOToFields(event.endStr);
    try {
      const res = await fetch(`/api/calendar/tasks/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: start.date,
          startTime: start.time || null,
          endDate: end.date || null,
          endTime: end.time || null,
          allDay: event.allDay,
        }),
      });
      if (!res.ok) throw new Error();
    } catch {
      info.revert();
    }
  }

  function closeModal() {
    setModal(null);
    setFormError(null);
  }

  function updateForm(field, value) {
    setModal((prev) => ({ ...prev, form: { ...prev.form, [field]: value } }));
  }

  async function handleSave() {
    if (!modal.form.title.trim()) { setFormError("El nombre es obligatorio"); return; }
    if (!modal.form.startDate) { setFormError("La fecha de inicio es obligatoria"); return; }

    setSaving(true);
    setFormError(null);
    try {
      const isCreate = modal.mode === "create";
      const res = await fetch(
        isCreate ? "/api/calendar/tasks" : `/api/calendar/tasks/${modal.taskId}`,
        {
          method: isCreate ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: modal.form.title.trim(),
            notes: modal.form.notes.trim() || null,
            priority: modal.form.priority,
            status: modal.form.status,
            startDate: modal.form.startDate,
            startTime: modal.form.allDay ? null : modal.form.startTime || null,
            endDate: modal.form.endDate || null,
            endTime: modal.form.allDay ? null : modal.form.endTime || null,
            allDay: modal.form.allDay,
            clientId: modal.form.clientId || null,
            teamMemberId: modal.form.teamMemberId || null,
          }),
        }
      );
      if (!res.ok) throw new Error("Error guardando tarea");
      calendarRef.current?.getApi().refetchEvents();
      closeModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("¿Eliminar esta tarea del calendario?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/calendar/tasks/${modal.taskId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error eliminando tarea");
      calendarRef.current?.getApi().refetchEvents();
      closeModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Estilos de FullCalendar ajustados al tema Obsidiana */}
      <style>{`
        .fc { font-family: inherit; }
        .fc .fc-button {
          background: #0F0F0F; border-color: #0F0F0F; color: #FAFAF8;
          font-size: 0.72rem; font-weight: 500; padding: 0.3rem 0.65rem;
          border-radius: 0.375rem; text-transform: none; letter-spacing: 0;
          box-shadow: none !important;
        }
        .fc .fc-button:hover:not(:disabled) { background: #222; border-color: #222; }
        .fc .fc-button-active,
        .fc .fc-button-primary:not(:disabled).fc-button-active {
          background: var(--color-primary, #1B3A2D) !important;
          border-color: var(--color-primary, #1B3A2D) !important;
        }
        .fc .fc-button:focus { outline: none; box-shadow: none !important; }
        .fc .fc-toolbar-title { font-size: 0.95rem; font-weight: 600; color: #111827; }
        .fc .fc-col-header-cell-cushion {
          font-size: 0.68rem; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.08em; color: #9CA3AF; padding: 6px 4px;
        }
        .fc .fc-daygrid-day-number { font-size: 0.72rem; color: #6B7280; padding: 4px 6px; }
        .fc .fc-day-today .fc-daygrid-day-number { color: var(--color-primary, #1B3A2D); font-weight: 700; }
        .fc .fc-day-today { background: rgba(27,58,45,0.04) !important; }
        .fc-theme-standard td, .fc-theme-standard th { border-color: #F0F0F0; }
        .fc-theme-standard .fc-scrollgrid { border-color: #E8E8E8; }
        .fc .fc-event {
          border-radius: 4px; font-size: 0.71rem; font-weight: 500;
          border: none; padding: 1px 5px; cursor: pointer;
        }
        .fc .fc-event:hover { opacity: 0.82; }
        .fc .fc-more-link { font-size: 0.68rem; color: #9CA3AF; font-weight: 500; }
        .fc .fc-list-event-title a { font-size: 0.8rem; color: #111827; }
        .fc .fc-list-day-cushion { background: #F9FAFB; }
        .fc .fc-timegrid-slot-label-cushion { font-size: 0.67rem; color: #9CA3AF; }
        .fc .fc-highlight { background: rgba(27,58,45,0.07); }
        .fc .fc-daygrid-event-dot { border-color: currentColor; }
        .fc .fc-toolbar.fc-header-toolbar { margin-bottom: 1rem; }
      `}</style>

      {/* Header */}
      <div className="px-6 lg:px-10 pt-8 pb-5 flex items-end justify-between shrink-0 border-b border-[var(--ink-200)] gap-6 flex-wrap">
        <div>
          <div className="eyebrow mb-1.5 lg:mb-2">Tiempo · Agenda</div>
          <h1 className="font-display text-[24px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
            Calendario <span className="font-display-italic text-[var(--ink-400)]">— equipo</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {hasProjects && (
            <button
              onClick={toggleProjects}
              className={`flex items-center gap-1.5 px-3 py-1.5 border text-xs font-medium rounded-md transition-colors ${showProjects ? "border-[#6366F1]/40 bg-[#6366F1]/10 text-[#4F46E5]" : "border-[var(--ink-200)] text-[var(--ink-400)] hover:bg-[var(--ink-100)]"}`}
              title="Mostrar u ocultar las fechas límite e hitos de los proyectos"
            >
              <span className={`w-2 h-2 rounded-full ${showProjects ? "bg-[#6366F1]" : "bg-neutral-300"}`} />
              Proyectos
            </button>
          )}
          <button
            onClick={loadReorg}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--ink-200)] text-[var(--ink-700)] text-xs font-medium rounded-md hover:bg-[var(--ink-100)] transition-colors"
            title="La IA propone repartir las tareas de esta semana"
          >
            🦎 Reorganizar semana
          </button>
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-md hover:bg-[#222] transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nueva tarea
          </button>
        </div>
      </div>

      {/* Calendario */}
      <div className="flex-1 p-6 min-h-0">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          }}
          locale="es"
          firstDay={1}
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          allDaySlot={true}
          editable={true}
          selectable={true}
          selectMirror={true}
          dayMaxEvents={3}
          events={fetchEvents}
          select={handleSelect}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          height="calc(100vh - 180px)"
          buttonText={{
            today: "Hoy",
            month: "Mes",
            week: "Semana",
            day: "Día",
            list: "Lista",
          }}
        />
      </div>

      {/* Mini-modal de evento de PROYECTO (fecha límite / hito) */}
      {projectInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={(e) => { if (e.target === e.currentTarget) setProjectInfo(null); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">
                  {projectInfo.kind === "projectMilestone" ? "Hito de proyecto" : "Tarea de proyecto · fecha límite"}
                </div>
                <div className="text-[14px] font-semibold text-neutral-900 leading-snug">{projectInfo.title}</div>
              </div>
              <button onClick={() => setProjectInfo(null)} className="text-neutral-400 hover:text-neutral-700 p-1 -m-1" aria-label="Cerrar">✕</button>
            </div>
            <div className="px-5 py-4 space-y-1.5 text-[12.5px] text-neutral-600">
              <div><span className="text-neutral-400">Proyecto:</span> {projectInfo.projectName}{projectInfo.projectCode ? ` (${projectInfo.projectCode})` : ""}</div>
              <div><span className="text-neutral-400">Fecha:</span> {projectInfo.date}</div>
              {projectInfo.columnName && <div><span className="text-neutral-400">Columna:</span> {projectInfo.columnName}</div>}
              {projectInfo.status && <div><span className="text-neutral-400">Estado:</span> {projectInfo.status === "pending" ? "Pendiente" : projectInfo.status === "completed" ? "Completado" : "No cumplido"}</div>}
              <p className="text-[11px] text-neutral-400 pt-1.5">Se gestiona desde el módulo de Proyectos. Arrástralo en el calendario para cambiar su fecha límite.</p>
            </div>
            <div className="px-5 py-3.5 border-t border-[#F0F0F0] flex justify-end gap-2">
              <button onClick={() => setProjectInfo(null)} className="text-xs text-neutral-500 px-3 py-1.5">Cerrar</button>
              <a href={`/proyectos/${projectInfo.projectId}/board`} className="text-xs font-medium px-3 py-1.5 rounded-md text-white" style={{ backgroundColor: "var(--color-primary,#1B3A2D)" }}>
                Abrir proyecto →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Modal "Reorganizar semana (IA)" — 3 propuestas navegables, casi pantalla completa */}
      {reorg && (() => {
        const props = reorg.proposals || [];
        const active = props[reorgIndex] || null;
        const activeMoves = active?.moves || [];
        const modelBadge = reorg.model === "fake" ? "Simulado" : reorg.model === "sin-ia" ? "Sin IA" : reorg.model === "none" ? "—" : "IA";
        return (
          <div className="fixed inset-0 z-50" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={(e) => { if (e.target === e.currentTarget) closeReorg(); }}>
            <div className="bg-white shadow-2xl flex flex-col fixed inset-x-2 top-14 bottom-2 lg:inset-8 rounded-2xl overflow-hidden">
              {/* Cabecera */}
              <div className="px-5 lg:px-7 py-4 border-b border-[#F0F0F0] flex items-start justify-between shrink-0 gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-neutral-900">🦎 Reorganizar la semana</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">{modelBadge}</span>
                  </div>
                  <div className="text-[12px] text-neutral-400 mt-0.5">3 propuestas para repartir las tareas de esta semana. Elige la que prefieras.</div>
                  {reorg.applyError && <div className="text-[12px] text-rose-600 mt-1.5">{reorg.applyError}</div>}
                </div>
                <button onClick={closeReorg} disabled={reorgApplying} className="text-neutral-400 hover:text-neutral-700 p-1 -m-1 text-lg leading-none disabled:opacity-40" aria-label="Cerrar">✕</button>
              </div>

              {reorg.loading ? (
                <div className="flex-1 grid place-items-center"><p className="text-sm text-neutral-400">Analizando la semana…</p></div>
              ) : reorg.err ? (
                <div className="flex-1 grid place-items-center"><p className="text-sm text-rose-600">{reorg.err}</p></div>
              ) : (
                <>
                  {/* Título de la propuesta activa + flechas izquierda/derecha */}
                  <div className="relative flex items-center justify-center px-14 lg:px-16 py-4 border-b border-[#F5F5F5] shrink-0">
                    <button onClick={() => stepReorg(-1)} className="absolute left-3 lg:left-5 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-full border border-neutral-200 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 text-xl leading-none" aria-label="Propuesta anterior">‹</button>
                    <div className="text-center">
                      <div className="text-[11px] uppercase tracking-wide text-neutral-400">Propuesta {reorgIndex + 1} de {props.length}</div>
                      <div className="text-[16px] font-semibold text-neutral-900 mt-0.5">{active?.title}</div>
                      <div className="text-[12px] text-neutral-500 mt-0.5 max-w-md mx-auto">{active?.description}</div>
                    </div>
                    <button onClick={() => stepReorg(1)} className="absolute right-3 lg:right-5 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-full border border-neutral-200 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 text-xl leading-none" aria-label="Propuesta siguiente">›</button>
                  </div>

                  {/* Scroll: calendario del resultado (arriba, grande) + cambios en texto */}
                  <div className="flex-1 overflow-y-auto px-5 lg:px-7 py-4 space-y-6">
                    {/* Calendario del resultado propuesto (mes / semana / día) */}
                    <div>
                      <div className="text-[12px] text-neutral-500 mb-2">Así quedaría la semana con esta propuesta:</div>
                      <div className="border border-neutral-100 rounded-xl p-2 reorg-preview">
                        <FullCalendar
                          plugins={[dayGridPlugin, timeGridPlugin]}
                          initialView="timeGridWeek"
                          initialDate={reorg.weekStart}
                          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
                          locale="es"
                          firstDay={1}
                          allDaySlot={true}
                          height={440}
                          editable={false}
                          selectable={false}
                          dayMaxEvents={4}
                          events={buildPreviewEvents(reorg.weekEvents, activeMoves)}
                          buttonText={{ today: "Hoy", month: "Mes", week: "Semana", day: "Día" }}
                        />
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-[11px] text-neutral-400">
                        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: "#10B981" }} /> Se mueve</span>
                        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: "#E5E7EB" }} /> Se queda igual</span>
                      </div>
                    </div>

                    {/* Cambios en texto (una modificación por línea, con a quién afecta) */}
                    <div>
                      {activeMoves.length === 0 ? (
                        <div className="text-center py-6">
                          <div className="text-3xl mb-2">✅</div>
                          <p className="text-sm text-neutral-500">Con este criterio la semana ya está bien: no hace falta mover nada.</p>
                          <p className="text-xs text-neutral-400 mt-1">Prueba las otras propuestas con las flechas.</p>
                        </div>
                      ) : (
                        <>
                          <div className="text-[12px] text-neutral-500 mb-3">{activeMoves.length} cambio{activeMoves.length > 1 ? "s" : ""} · a quién afecta cada uno:</div>
                          <ul className="divide-y divide-neutral-100 border border-neutral-100 rounded-xl overflow-hidden">
                            {activeMoves.map((m, i) => (
                              <li key={i} className="px-3.5 py-3 hover:bg-neutral-50/60">
                                <div className="flex items-center gap-2.5 flex-wrap">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${m.priority === "high" ? "bg-rose-500" : m.priority === "low" ? "bg-neutral-300" : "bg-amber-400"}`} title={`Prioridad ${m.priority === "high" ? "alta" : m.priority === "low" ? "baja" : "media"}`} />
                                  <span className="text-[14px] font-medium text-neutral-900">{m.title}</span>
                                  <span className="text-[12px] text-neutral-300">·</span>
                                  <span className="text-[12.5px] text-neutral-600">{m.teamMemberName || "Sin asignar"}</span>
                                  <span className="ml-auto text-[12.5px] text-neutral-500 flex items-center gap-1.5 whitespace-nowrap">
                                    <span className="line-through text-neutral-400">{m.oldLabel}</span>
                                    <span className="text-neutral-300">→</span>
                                    <span className="font-semibold text-emerald-700">{m.newLabel}</span>
                                  </span>
                                </div>
                                <div className="text-[11.5px] text-neutral-400 mt-1 pl-[18px]">{m.reason}</div>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Pie: selector 1/2/3 + aplicar la propuesta activa */}
                  <div className="px-5 lg:px-7 py-4 border-t border-[#F0F0F0] flex items-center justify-between gap-3 shrink-0 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      {props.map((p, i) => (
                        <button key={i} onClick={() => setReorgIndex(i)} title={p.title}
                          className={`w-8 h-8 rounded-lg text-[13px] font-semibold border transition-colors ${i === reorgIndex ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400"}`}>
                          {i + 1}
                        </button>
                      ))}
                      <span className="text-[11px] text-neutral-400 ml-2 hidden sm:inline">← → para cambiar de propuesta</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={closeReorg} disabled={reorgApplying} className="text-[13px] text-neutral-500 px-3 py-2 hover:text-neutral-800 disabled:opacity-40">Cancelar</button>
                      <button onClick={applyReorg} disabled={reorgApplying || activeMoves.length === 0}
                        className="text-[13px] font-medium px-4 py-2 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: "var(--color-primary,#1B3A2D)" }}>
                        {reorgApplying ? "Aplicando…" : activeMoves.length === 0 ? "Sin cambios" : `Aplicar propuesta ${reorgIndex + 1} · ${activeMoves.length} cambio${activeMoves.length > 1 ? "s" : ""}`}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Modal creación / edición */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col">
            {/* Header modal */}
            <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between shrink-0">
              <h2 className="text-sm font-semibold text-[#111827]">
                {modal.mode === "create" ? "Nueva tarea" : "Editar tarea"}
              </h2>
              <button
                onClick={closeModal}
                className="text-[#9CA3AF] hover:text-[#374151] transition-colors p-0.5"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Cuerpo modal */}
            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  {formError}
                </div>
              )}

              {/* Nombre */}
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">
                  Nombre <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={modal.form.title}
                  onChange={(e) => updateForm("title", e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  placeholder="Nombre de la tarea"
                  autoFocus
                  className="w-full text-sm px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F0F0F]/10 focus:border-[#0F0F0F] placeholder-[#D1D5DB] transition-colors"
                />
              </div>

              {/* Todo el día */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => updateForm("allDay", !modal.form.allDay)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    modal.form.allDay ? "bg-[#0F0F0F]" : "bg-[#E5E7EB]"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                      modal.form.allDay ? "translate-x-[18px]" : "translate-x-[2px]"
                    }`}
                  />
                </button>
                <span className="text-xs text-[#374151] select-none cursor-pointer" onClick={() => updateForm("allDay", !modal.form.allDay)}>
                  Todo el día
                </span>
              </div>

              {/* Fechas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#374151] mb-1">
                    Inicio <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={modal.form.startDate}
                    onChange={(e) => updateForm("startDate", e.target.value)}
                    className="w-full text-sm px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F0F0F]/10 focus:border-[#0F0F0F] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#374151] mb-1">Fin</label>
                  <input
                    type="date"
                    value={modal.form.endDate}
                    onChange={(e) => updateForm("endDate", e.target.value)}
                    className="w-full text-sm px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F0F0F]/10 focus:border-[#0F0F0F] transition-colors"
                  />
                </div>
              </div>

              {/* Horas (solo si no es todo el día) */}
              {!modal.form.allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#374151] mb-1">Hora inicio</label>
                    <input
                      type="time"
                      value={modal.form.startTime}
                      onChange={(e) => updateForm("startTime", e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F0F0F]/10 focus:border-[#0F0F0F] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#374151] mb-1">Hora fin</label>
                    <input
                      type="time"
                      value={modal.form.endTime}
                      onChange={(e) => updateForm("endTime", e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F0F0F]/10 focus:border-[#0F0F0F] transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* Prioridad */}
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-2">Prioridad</label>
                <div className="flex gap-2">
                  {Object.entries(PRIORITY_LABELS).map(([key, label]) => {
                    const active = modal.form.priority === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => updateForm("priority", key)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-lg border-2 transition-all ${
                          active
                            ? "text-white border-transparent"
                            : "bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]"
                        }`}
                        style={active ? { backgroundColor: PRIORITY_COLORS[key], borderColor: PRIORITY_COLORS[key] } : {}}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Estado */}
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">Estado</label>
                <Select
                  value={modal.form.status}
                  onChange={(v) => updateForm("status", v)}
                  options={STATUS_OPTIONS}
                  className="w-full text-sm px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F0F0F]/10 focus:border-[#0F0F0F] bg-white transition-colors"
                />
              </div>

              {/* Cliente + Responsable (opcionales) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#374151] mb-1">Cliente</label>
                  <Select
                    value={modal.form.clientId}
                    onChange={(v) => updateForm("clientId", v)}
                    options={clientOptions}
                    className="w-full text-sm px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F0F0F]/10 focus:border-[#0F0F0F] bg-white transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#374151] mb-1">Responsable</label>
                  <Select
                    value={modal.form.teamMemberId}
                    onChange={(v) => updateForm("teamMemberId", v)}
                    options={teamOptions}
                    className="w-full text-sm px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F0F0F]/10 focus:border-[#0F0F0F] bg-white transition-colors"
                  />
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">Notas</label>
                <textarea
                  value={modal.form.notes}
                  onChange={(e) => updateForm("notes", e.target.value)}
                  placeholder="Notas opcionales..."
                  rows={3}
                  className="w-full text-sm px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F0F0F]/10 focus:border-[#0F0F0F] resize-none placeholder-[#D1D5DB] transition-colors"
                />
              </div>
            </div>

            {/* Footer modal */}
            <div className="px-5 py-4 border-t border-[#F0F0F0] flex items-center justify-between shrink-0">
              <div>
                {modal.mode === "edit" && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-40"
                  >
                    Eliminar
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={closeModal}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs text-[#6B7280] hover:text-[#374151] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-lg hover:bg-[#222] transition-colors disabled:opacity-50 min-w-[80px]"
                >
                  {saving ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
