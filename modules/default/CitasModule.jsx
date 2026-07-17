"use client";

/**
 * CitasModule (default) — agenda "vanilla" usada por tenants sin override.
 * El wrapper `app/(dashboard)/citas/page.jsx` decide entre este componente
 * y el override según `x-tenant` del request.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import Select from "@/components/ui/Select.jsx";

const STATUS_LABELS = {
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
  no_show: "No asistió",
};
const STATUS_COLORS = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-100",
  completed: "bg-slate-100 text-slate-700 border-slate-200",
  cancelled: "bg-neutral-100 text-neutral-500 border-neutral-200",
  no_show: "bg-violet-50 text-violet-700 border-violet-100",
};
const MODALITY_LABELS = { presencial: "Presencial", phone: "Teléfono", online: "Online" };

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusChip({ value }) {
  const cls = STATUS_COLORS[value] ?? "bg-neutral-100 text-neutral-500 border-neutral-200";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {STATUS_LABELS[value] ?? value}
    </span>
  );
}

function ModalityChip({ value }) {
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border bg-white border-neutral-200 text-neutral-600">
      {MODALITY_LABELS[value] ?? value}
    </span>
  );
}

const EMPTY_BOOKING_FORM = {
  eventTypeId: "",
  date: "",
  time: "",
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  modality: "",
  additionalData: "",
  notes: "",
  patientId: "",
};

export default function CitasModule() {
  const calendarRef = useRef(null);
  const [eventTypes, setEventTypes] = useState([]);
  const [visibleEtIds, setVisibleEtIds] = useState(null); // null = todos
  const [openBooking, setOpenBooking] = useState(null); // booking abierto en modal detalle
  const [openCreate, setOpenCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_BOOKING_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [detailNotes, setDetailNotes] = useState("");
  const [detailMeet, setDetailMeet] = useState("");
  const [teamMembers, setTeamMembers] = useState([]);
  const [patients, setPatients] = useState([]); // vacío si el tenant no tiene Clínica/Pacientes

  const loadEventTypes = useCallback(async () => {
    const res = await fetch("/api/citas/event-types?active=true", { cache: "no-store" });
    const j = await res.json();
    if (j.ok) setEventTypes(j.data);
  }, []);

  useEffect(() => { loadEventTypes(); }, [loadEventTypes]);

  // Equipo para asignar profesional a la cita (opcional).
  useEffect(() => {
    fetch("/api/team?status=all&limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setTeamMembers(j.data?.members ?? []))
      .catch(() => {});
  }, []);

  // Pacientes para asignar la cita (sólo tenants con módulo Clínica/Pacientes:
  // si el endpoint responde 403, `patients` queda vacío y el selector se oculta).
  useEffect(() => {
    fetch("/api/pacientes", { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => setPatients(j?.data?.patients ?? []))
      .catch(() => {});
  }, []);

  const patientOptions = useMemo(
    () => [
      { value: "", label: "Sin paciente asignado" }, // permite volver a "ninguno"
      ...patients.map((p) => ({ value: p.id, label: p.name || `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() })),
    ],
    [patients]
  );

  const fetchEvents = useCallback(async (info, success, failure) => {
    try {
      const params = new URLSearchParams({
        start: info.startStr,
        end: info.endStr,
      });
      if (visibleEtIds && visibleEtIds.length > 0) {
        params.set("eventTypeIds", visibleEtIds.join(","));
      } else if (visibleEtIds && visibleEtIds.length === 0) {
        success([]);
        return;
      }
      const res = await fetch(`/api/citas/bookings/calendar?${params}`, { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error cargando citas");
      success(j.data ?? []);
    } catch (err) {
      failure(err);
    }
  }, [visibleEtIds]);

  useEffect(() => {
    calendarRef.current?.getApi().refetchEvents();
  }, [visibleEtIds]);

  function toggleEventType(id) {
    setVisibleEtIds((prev) => {
      const current = prev ?? eventTypes.map((e) => e.id);
      if (current.includes(id)) return current.filter((x) => x !== id);
      return [...current, id];
    });
  }

  function showAllEventTypes() { setVisibleEtIds(null); }

  async function handleEventClick(info) {
    const id = info.event.id;
    const res = await fetch(`/api/citas/bookings/${id}`, { cache: "no-store" });
    const j = await res.json();
    if (j.ok) {
      setOpenBooking(j.data);
      setDetailNotes(j.data.notes ?? "");
      setDetailMeet(j.data.meetUrl ?? "");
      setFormError(null); // no arrastrar un error del drawer de creación / PATCH previo
    }
  }

  async function patchBooking(payload) {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/citas/bookings/${openBooking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error guardando");
      setOpenBooking(j.data);
      calendarRef.current?.getApi().refetchEvents();
      return true;
    } catch (err) {
      setFormError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function markCompleted() { await patchBooking({ status: "completed" }); }
  async function markNoShow() { await patchBooking({ status: "no_show" }); }
  async function cancelBooking() {
    const reason = window.prompt("Motivo de cancelación (opcional)") ?? "";
    await patchBooking({ status: "cancelled", cancellationReason: reason.trim() || null });
  }
  async function saveNotes() { await patchBooking({ notes: detailNotes.trim() || null }); }
  async function saveMeet() { await patchBooking({ meetUrl: detailMeet.trim() || null }); }
  async function assignTeamMember(v) { await patchBooking({ teamMemberId: v || null }); }
  async function assignPatient(v) { await patchBooking({ patientId: v || null }); }
  async function deleteBooking() {
    if (!window.confirm("¿Eliminar esta cita? Quedará marcada como cancelada.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/citas/bookings/${openBooking.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("Error eliminando");
      setOpenBooking(null);
      calendarRef.current?.getApi().refetchEvents();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const selectedEventType = useMemo(() => {
    return eventTypes.find((e) => e.id === createForm.eventTypeId) ?? null;
  }, [eventTypes, createForm.eventTypeId]);

  function updateCreateForm(field, value) {
    setCreateForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submitCreate() {
    setFormError(null);
    if (!createForm.eventTypeId) { setFormError("Selecciona tipo de cita"); return; }
    if (!createForm.date || !createForm.time) { setFormError("Fecha y hora son obligatorias"); return; }
    if (!createForm.clientName.trim()) { setFormError("Nombre del cliente obligatorio"); return; }
    if (!createForm.clientEmail.trim()) { setFormError("Email del cliente obligatorio"); return; }
    if (!createForm.clientPhone.trim()) { setFormError("Teléfono del cliente obligatorio"); return; }
    if (!createForm.modality) { setFormError("Selecciona modalidad"); return; }

    setSaving(true);
    try {
      const scheduledAt = new Date(`${createForm.date}T${createForm.time}`).toISOString();
      const res = await fetch("/api/citas/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventTypeId: createForm.eventTypeId,
          scheduledAt,
          clientName: createForm.clientName.trim(),
          clientEmail: createForm.clientEmail.trim(),
          clientPhone: createForm.clientPhone.trim(),
          modality: createForm.modality,
          additionalData: createForm.additionalData.trim() || null,
          notes: createForm.notes.trim() || null,
          patientId: createForm.patientId || null,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error creando cita");
      calendarRef.current?.getApi().refetchEvents();
      setOpenCreate(false);
      setCreateForm(EMPTY_BOOKING_FORM);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
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
        .fc .fc-toolbar.fc-header-toolbar { margin-bottom: 1rem; }
      `}</style>

      {/* Header */}
      <div className="px-6 lg:px-10 pt-8 pb-5 flex items-end justify-between shrink-0 border-b border-[var(--ink-200)] gap-6 flex-wrap">
        <div>
          <div className="eyebrow mb-1.5 lg:mb-2">Tiempo · Agenda de citas</div>
          <h1 className="font-display text-[24px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
            Calendario <span className="font-display-italic text-[var(--ink-400)]">— citas agendadas</span>
          </h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Link
            href="/citas/tipos"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Tipos de cita
          </Link>
          <Link
            href="/citas/disponibilidad"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Disponibilidad
          </Link>
          <button
            onClick={() => { setOpenCreate(true); setFormError(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-md hover:bg-[#222] transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nueva cita manual
          </button>
        </div>
      </div>

      {/* Filtro de tipos */}
      {eventTypes.length > 0 && (
        <div className="px-6 lg:px-10 py-3 flex items-center gap-2 flex-wrap shrink-0 border-b border-neutral-100">
          <span className="text-[11px] uppercase tracking-wider text-neutral-400 mr-1">Filtrar:</span>
          <button
            onClick={showAllEventTypes}
            className={`text-[11px] px-2 py-1 rounded-md border ${
              visibleEtIds == null
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            Todos
          </button>
          {eventTypes.map((et) => {
            const active = visibleEtIds == null || visibleEtIds.includes(et.id);
            return (
              <button
                key={et.id}
                onClick={() => toggleEventType(et.id)}
                className={`text-[11px] px-2 py-1 rounded-md border flex items-center gap-1.5 transition ${
                  active
                    ? "bg-white text-neutral-700 border-neutral-300"
                    : "bg-neutral-50 text-neutral-400 border-neutral-200 line-through"
                }`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: et.color ?? "#3F6E5B" }}
                />
                {et.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Calendario */}
      <div className="flex-1 p-6 min-h-0">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          }}
          locale="es"
          firstDay={1}
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          allDaySlot={false}
          events={fetchEvents}
          eventClick={handleEventClick}
          height="calc(100vh - 240px)"
          buttonText={{ today: "Hoy", month: "Mes", week: "Semana", day: "Día", list: "Lista" }}
        />
      </div>

      {/* ─── Modal de detalle de booking ─── */}
      {openBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpenBooking(null); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-base font-semibold text-neutral-900 truncate">
                  {openBooking.clientName}
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <StatusChip value={openBooking.status} />
                  <ModalityChip value={openBooking.modality} />
                  {openBooking.eventType && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
                      <span className="w-2 h-2 rounded-full" style={{ background: openBooking.eventType.color ?? "#3F6E5B" }} />
                      {openBooking.eventType.name}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setOpenBooking(null)}
                className="text-neutral-400 hover:text-neutral-700 p-0.5"
                aria-label="Cerrar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 text-[13px]">
                <div className="flex">
                  <span className="w-24 text-neutral-400">Email</span>
                  <a className="text-neutral-800 hover:underline" href={`mailto:${openBooking.clientEmail}`}>
                    {openBooking.clientEmail}
                  </a>
                </div>
                <div className="flex">
                  <span className="w-24 text-neutral-400">Teléfono</span>
                  <a className="text-neutral-800 hover:underline" href={`tel:${openBooking.clientPhone}`}>
                    {openBooking.clientPhone}
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 text-[13px] pt-3 border-t border-neutral-100">
                <div className="flex">
                  <span className="w-24 text-neutral-400">Fecha</span>
                  <span className="text-neutral-800">{fmtDateTime(openBooking.scheduledAt)}</span>
                </div>
                <div className="flex">
                  <span className="w-24 text-neutral-400">Duración</span>
                  <span className="text-neutral-800">{openBooking.duration} min</span>
                </div>
                {openBooking.modality === "presencial" && openBooking.eventType?.location && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Dirección</span>
                    <span className="text-neutral-800">{openBooking.eventType.location}</span>
                  </div>
                )}
                {openBooking.modality === "phone" && openBooking.eventType?.phoneNumber && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Teléfono</span>
                    <span className="text-neutral-800">{openBooking.eventType.phoneNumber}</span>
                  </div>
                )}
                {teamMembers.length > 0 && (
                  <div className="flex items-center">
                    <span className="w-24 text-neutral-400">Profesional</span>
                    <select
                      value={openBooking.teamMemberId ?? ""}
                      onChange={(e) => assignTeamMember(e.target.value)}
                      disabled={saving}
                      className="flex-1 text-[13px] px-2 py-1 border border-neutral-200 rounded-md bg-white text-neutral-800 disabled:opacity-50"
                    >
                      <option value="">Sin asignar</option>
                      {teamMembers.map((m) => (
                        <option key={m.id} value={m.id}>{m.displayName}</option>
                      ))}
                    </select>
                  </div>
                )}
                {patients.length > 0 && (
                  <div className="flex items-center">
                    <span className="w-24 text-neutral-400">Paciente</span>
                    <select
                      value={openBooking.patientId ?? ""}
                      onChange={(e) => assignPatient(e.target.value)}
                      disabled={saving}
                      className="flex-1 text-[13px] px-2 py-1 border border-neutral-200 rounded-md bg-white text-neutral-800 disabled:opacity-50"
                    >
                      <option value="">Sin asignar</option>
                      {patients.map((p) => (
                        <option key={p.id} value={p.id}>{p.name || `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Enlace Meet editable — solo citas online */}
              {openBooking.modality === "online" && (
                <div className="pt-3 border-t border-neutral-100">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Enlace de videollamada (Meet)</div>
                  <input
                    type="url"
                    value={detailMeet}
                    onChange={(e) => setDetailMeet(e.target.value)}
                    placeholder="Pega aquí el link de Google Meet cuando lo tengas"
                    className={inputCls}
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-neutral-400">
                      Al guardar por primera vez se avisa al cliente por email.
                    </span>
                    <button
                      onClick={saveMeet}
                      disabled={saving || detailMeet.trim() === (openBooking.meetUrl ?? "")}
                      className="text-[11px] px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Guardar enlace
                    </button>
                  </div>
                </div>
              )}

              {openBooking.additionalData && (
                <div className="pt-3 border-t border-neutral-100">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">
                    {openBooking.eventType?.additionalDataLabel || "Información adicional"}
                  </div>
                  <div className="bg-amber-50 border border-amber-100 rounded-md px-3 py-2 text-[13px] text-neutral-700 whitespace-pre-wrap">
                    {openBooking.additionalData}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-neutral-100">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Notas internas</div>
                <textarea
                  value={detailNotes}
                  onChange={(e) => setDetailNotes(e.target.value)}
                  placeholder="Notas internas (no visibles para el cliente)"
                  className={`${inputCls} min-h-[70px]`}
                />
                <div className="flex justify-end mt-1.5">
                  <button
                    onClick={saveNotes}
                    disabled={saving || detailNotes.trim() === (openBooking.notes ?? "")}
                    className="text-[11px] px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    Guardar notas
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-neutral-100 flex flex-wrap gap-2 justify-between">
              <div className="flex flex-wrap gap-2">
                {openBooking.status !== "completed" && (
                  <button
                    onClick={markCompleted}
                    disabled={saving}
                    className="text-[12px] px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Marcar completada
                  </button>
                )}
                {openBooking.status !== "no_show" && (
                  <button
                    onClick={markNoShow}
                    disabled={saving}
                    className="text-[12px] px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    No asistió
                  </button>
                )}
                {openBooking.status !== "cancelled" && (
                  <button
                    onClick={cancelBooking}
                    disabled={saving}
                    className="text-[12px] px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    Cancelar cita
                  </button>
                )}
              </div>
              <button
                onClick={deleteBooking}
                disabled={saving}
                className="text-[12px] px-3 py-1.5 rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Drawer "Nueva cita manual" ─── */}
      {openCreate && (
        <div
          className="fixed inset-0 z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setOpenCreate(false); }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">Nueva cita manual</h2>
              <button
                onClick={() => setOpenCreate(false)}
                className="text-neutral-400 hover:text-neutral-700 p-0.5"
                aria-label="Cerrar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Tipo de cita</label>
                <Select
                  value={createForm.eventTypeId}
                  onChange={(v) => updateCreateForm("eventTypeId", v)}
                  options={[
                    { value: "", label: "— Selecciona —" },
                    ...eventTypes.map((e) => ({ value: e.id, label: `${e.name} (${e.duration} min)` })),
                  ]}
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={createForm.date}
                    onChange={(e) => updateCreateForm("date", e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Hora</label>
                  <input
                    type="time"
                    value={createForm.time}
                    onChange={(e) => updateCreateForm("time", e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Nombre del cliente</label>
                <input
                  type="text"
                  value={createForm.clientName}
                  onChange={(e) => updateCreateForm("clientName", e.target.value)}
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Email</label>
                  <input
                    type="email"
                    value={createForm.clientEmail}
                    onChange={(e) => updateCreateForm("clientEmail", e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Teléfono</label>
                  <input
                    type="tel"
                    value={createForm.clientPhone}
                    onChange={(e) => updateCreateForm("clientPhone", e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              {patients.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Paciente (opcional)</label>
                  <Select
                    value={createForm.patientId}
                    onChange={(v) => updateCreateForm("patientId", v)}
                    options={patientOptions}
                    placeholder="Sin paciente asignado"
                    searchable
                  />
                </div>
              )}

              {selectedEventType && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Modalidad</label>
                  <div className="flex gap-2 flex-wrap">
                    {selectedEventType.modalities.map((m) => (
                      <label key={m} className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                        <input
                          type="radio"
                          name="modality"
                          value={m}
                          checked={createForm.modality === m}
                          onChange={(e) => updateCreateForm("modality", e.target.value)}
                        />
                        {MODALITY_LABELS[m] ?? m}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                  {selectedEventType?.additionalDataLabel || "Información adicional"}
                </label>
                <textarea
                  value={createForm.additionalData}
                  onChange={(e) => updateCreateForm("additionalData", e.target.value)}
                  rows={3}
                  className={`${inputCls} min-h-[70px]`}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Notas internas</label>
                <textarea
                  value={createForm.notes}
                  onChange={(e) => updateCreateForm("notes", e.target.value)}
                  rows={2}
                  className={`${inputCls} min-h-[60px]`}
                />
              </div>
            </div>

            <div className="px-5 py-3 border-t border-neutral-100 flex justify-end gap-2 shrink-0">
              <button
                onClick={() => setOpenCreate(false)}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </button>
              <button
                onClick={submitCreate}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Crear cita"}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
