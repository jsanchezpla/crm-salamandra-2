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

export default function CalendarioPage() {
  const calendarRef = useRef(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [clients, setClients] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);

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
      const res = await fetch(`/api/calendar/tasks?${params}`);
      if (!res.ok) throw new Error("Error cargando eventos");
      const json = await res.json();
      successCallback(json.data ?? []);
    } catch (err) {
      failureCallback(err);
    }
  }, []);

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

  async function handleEventDrop(info) {
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
