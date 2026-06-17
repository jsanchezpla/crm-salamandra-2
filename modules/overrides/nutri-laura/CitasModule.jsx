"use client";

/**
 * CitasModule (override nutri_laura) — agenda con dos tabs:
 *   - Lista de espera (status='pending'): visible por defecto si hay
 *     pendings. Acciones Confirmar / Rechazar (con motivo opcional).
 *   - Calendario: misma vista FullCalendar que el default.
 *
 * Reusa los endpoints genéricos del módulo citas, incluyendo /confirm y
 * /reject (transición pending → confirmed | cancelled) creados en el
 * sprint Fase 1.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";

const STATUS_LABELS = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  completed: "Realizada",
  cancelled: "Cancelada",
  no_show: "No asistió",
};
const MODALITY_LABELS = { presencial: "Presencial", phone: "Teléfono", online: "Online" };

function fmtDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtRelative(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

export default function NutriLauraCitasModule() {
  const [tab, setTab] = useState("waitlist");
  const [pendingCount, setPendingCount] = useState(0);
  const [waitlistRefreshKey, setWaitlistRefreshKey] = useState(0);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [newOpen, setNewOpen] = useState(false);

  // Si no hay pendings al cargar, mostrar calendario por defecto.
  // Si hay, mantenerse en waitlist.
  useEffect(() => {
    fetch("/api/citas/bookings?status=pending&limit=1")
      .then((r) => r.json())
      .then((j) => {
        const n = j?.ok ? (j.data.total ?? 0) : 0;
        setPendingCount(n);
        if (n === 0) setTab("calendar");
      })
      .catch(() => setTab("calendar"));
  }, []);

  function bumpWaitlist() {
    setWaitlistRefreshKey((k) => k + 1);
  }
  function bumpCalendar() {
    setCalendarRefreshKey((k) => k + 1);
  }

  function handleBookingCreated(booking) {
    setNewOpen(false);
    // Refrescamos ambas vistas: la cita nueva nace 'confirmed', así que
    // aparece en el calendario; la lista de espera también se refresca
    // por si la sesión tenía una stale.
    bumpCalendar();
    bumpWaitlist();
    // Si Laura está en waitlist y la cita ya viene confirmada, saltamos
    // al calendario para que vea el resultado.
    if (booking?.status === "confirmed") setTab("calendar");
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-accent,#F7F1EB)]/30">
      {/* Header */}
      <div className="px-6 lg:px-10 pt-8 pb-4 shrink-0 border-b border-gray-100 bg-white">
        <div className="flex items-end justify-between gap-6 flex-wrap mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400 mb-1">Tiempo · Agenda de pacientes</div>
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900 leading-tight">
              Agenda <span className="text-gray-400 italic font-normal">— pacientes</span>
            </h1>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <Link href="/citas/tipos" className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition">
              Tipos de cita
            </Link>
            <Link href="/citas/disponibilidad" className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition">
              Disponibilidad
            </Link>
            <button
              onClick={() => setNewOpen(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 transition flex items-center gap-1"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Nueva cita
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1">
          <TabButton active={tab === "waitlist"} onClick={() => setTab("waitlist")}>
            Lista de espera
            {pendingCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-[var(--color-primary)] text-white">
                {pendingCount}
              </span>
            )}
          </TabButton>
          <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")}>
            Calendario
          </TabButton>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {tab === "waitlist" ? (
          <Waitlist
            refreshKey={waitlistRefreshKey}
            onCountChange={setPendingCount}
            onActioned={bumpWaitlist}
          />
        ) : (
          <CalendarPanel refreshKey={calendarRefreshKey} />
        )}
      </div>

      {newOpen && (
        <NewBookingModal
          onClose={() => setNewOpen(false)}
          onCreated={handleBookingCreated}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
        active
          ? "bg-[var(--color-primary)] text-white"
          : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

// ── Waitlist ─────────────────────────────────────────────────────────────────

function Waitlist({ refreshKey, onCountChange, onActioned }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmFor, setConfirmFor] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/citas/bookings?status=pending&limit=50")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setItems(j.data.bookings ?? []);
          onCountChange?.(j.data.total ?? 0);
        }
      })
      .finally(() => setLoading(false));
  }, [onCountChange]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function confirm(id) {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/citas/bookings/${id}/confirm`, { method: "PATCH" });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Error al confirmar");
        return;
      }
      setConfirmFor(null);
      onActioned?.();
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id) {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/citas/bookings/${id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancellationReason: rejectReason.trim() || null }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Error al rechazar");
        return;
      }
      setRejectFor(null);
      setRejectReason("");
      onActioned?.();
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="px-6 lg:px-10 py-12 text-center text-sm text-gray-400">
        Cargando lista de espera…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-6 lg:px-10 py-16 text-center">
        <div className="text-base text-gray-700 font-medium">Sin solicitudes pendientes</div>
        <p className="text-xs text-gray-400 mt-1">
          Las nuevas solicitudes desde la web aparecerán aquí.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-10 py-6 max-w-5xl mx-auto space-y-3">
      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">{error}</div>
      )}
      {items.map((b) => {
        const isReject = rejectFor === b.id;
        const isConfirm = confirmFor === b.id;
        return (
          <article key={b.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-5 flex flex-col lg:flex-row lg:items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-50 text-amber-700 border-amber-100">
                    {STATUS_LABELS.pending}
                  </span>
                  <span className="text-xs text-gray-400">{fmtRelative(b.createdAt)}</span>
                </div>
                <h3 className="text-base font-semibold text-gray-900">{b.clientName}</h3>
                <div className="text-xs text-gray-500 mt-0.5">
                  {b.clientEmail && <a href={`mailto:${b.clientEmail}`} className="hover:text-[var(--color-primary)]">{b.clientEmail}</a>}
                  {b.clientEmail && b.clientPhone && " · "}
                  {b.clientPhone && <a href={`tel:${b.clientPhone}`} className="hover:text-[var(--color-primary)]">{b.clientPhone}</a>}
                </div>

                <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-y-1 gap-x-4 text-xs">
                  <Detail label="Servicio" value={b.eventType?.name ?? "—"} />
                  <Detail label="Cuándo" value={fmtDateTime(b.scheduledAt)} />
                  <Detail label="Modalidad" value={MODALITY_LABELS[b.modality] ?? b.modality} />
                </dl>

                {b.additionalData && (
                  <div className="mt-3 px-3 py-2 bg-gray-50 border border-gray-100 rounded-md">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Respuesta al formulario</div>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{b.additionalData}</p>
                  </div>
                )}
              </div>

              {/* Acciones */}
              <div className="shrink-0 flex flex-col gap-2 lg:w-44">
                {isConfirm ? (
                  <>
                    <p className="text-xs text-gray-600">¿Confirmar cita con <strong>{b.clientName}</strong> el <strong>{fmtDateTime(b.scheduledAt)}</strong>?</p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmFor(null)} disabled={busyId === b.id} className="flex-1 bg-white border border-gray-200 text-gray-700 text-xs font-medium py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-50">
                        Cancelar
                      </button>
                      <button onClick={() => confirm(b.id)} disabled={busyId === b.id} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-1.5 rounded-md disabled:opacity-50">
                        {busyId === b.id ? "…" : "Confirmar"}
                      </button>
                    </div>
                  </>
                ) : isReject ? (
                  <>
                    <textarea
                      rows={2}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Motivo (opcional, se envía por email)"
                      className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--color-primary)] resize-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => { setRejectFor(null); setRejectReason(""); }} disabled={busyId === b.id} className="flex-1 bg-white border border-gray-200 text-gray-700 text-xs font-medium py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-50">
                        Cancelar
                      </button>
                      <button onClick={() => reject(b.id)} disabled={busyId === b.id} className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-1.5 rounded-md disabled:opacity-50">
                        {busyId === b.id ? "…" : "Rechazar"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button onClick={() => setConfirmFor(b.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-md transition-colors">
                      Confirmar
                    </button>
                    <button onClick={() => setRejectFor(b.id)} className="bg-white hover:bg-red-50 text-red-600 border border-red-200 text-xs font-medium py-2 rounded-md transition-colors">
                      Rechazar
                    </button>
                  </>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</dt>
      <dd className="text-gray-700 mt-0.5">{value}</dd>
    </div>
  );
}

// ── CalendarPanel ─────────────────────────────────────────────────────────────
// Reutiliza la misma vista FullCalendar que el default, simplificada
// (sin modal de creación manual ni detalle complejo — Laura crea citas
// principalmente desde el formulario público + lista de espera).

function CalendarPanel({ refreshKey = 0 }) {
  const calendarRef = useRef(null);
  const [eventTypes, setEventTypes] = useState([]);
  const [openBooking, setOpenBooking] = useState(null);

  const loadEventTypes = useCallback(async () => {
    const res = await fetch("/api/citas/event-types?active=true", { cache: "no-store" });
    const j = await res.json();
    if (j.ok) setEventTypes(j.data);
  }, []);

  useEffect(() => { loadEventTypes(); }, [loadEventTypes]);

  // El padre incrementa refreshKey cuando alguien crea/cancela una cita
  // desde fuera del calendario (modal "Nueva cita", confirm/reject inline).
  // Aquí pedimos a FullCalendar refetchEvents para repintar la vista actual.
  useEffect(() => {
    if (refreshKey === 0) return;
    calendarRef.current?.getApi?.()?.refetchEvents?.();
  }, [refreshKey]);

  const fetchEvents = useCallback(async (info, success, failure) => {
    try {
      const params = new URLSearchParams({ start: info.startStr, end: info.endStr });
      const res = await fetch(`/api/citas/bookings/calendar?${params}`, { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error cargando citas");
      success(j.data ?? []);
    } catch (err) {
      failure(err);
    }
  }, []);

  async function handleEventClick(info) {
    const id = info.event.id;
    const res = await fetch(`/api/citas/bookings/${id}`, { cache: "no-store" });
    const j = await res.json();
    if (j.ok) setOpenBooking(j.data);
  }

  const legend = useMemo(() => eventTypes.filter((e) => e.active), [eventTypes]);

  return (
    <div className="px-4 lg:px-10 py-6 max-w-6xl mx-auto">
      {legend.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap mb-4 text-xs">
          <span className="text-[11px] uppercase tracking-wider text-gray-400">Tipos:</span>
          {legend.map((e) => (
            <span key={e.id} className="inline-flex items-center gap-1.5 text-gray-700">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: e.color || "var(--color-primary)" }} />
              {e.name}
            </span>
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          locale="es"
          firstDay={1}
          slotMinTime="08:00:00"
          slotMaxTime="22:00:00"
          height="auto"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "timeGridWeek,timeGridDay,listWeek",
          }}
          buttonText={{ today: "Hoy", week: "Semana", day: "Día", list: "Lista" }}
          events={fetchEvents}
          eventClick={handleEventClick}
          nowIndicator
        />
      </div>

      {openBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setOpenBooking(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">{openBooking.clientName}</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Servicio" value={openBooking.eventType?.name ?? "—"} />
              <Row label="Cuándo" value={fmtDateTime(openBooking.scheduledAt)} />
              <Row label="Modalidad" value={MODALITY_LABELS[openBooking.modality] ?? openBooking.modality} />
              <Row label="Estado" value={STATUS_LABELS[openBooking.status] ?? openBooking.status} />
              {openBooking.clientEmail && <Row label="Email" value={openBooking.clientEmail} />}
              {openBooking.clientPhone && <Row label="Teléfono" value={openBooking.clientPhone} />}
              {openBooking.meetUrl && <Row label="Meet" value={openBooking.meetUrl} />}
              {openBooking.additionalData && (
                <div>
                  <dt className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Respuesta al formulario</dt>
                  <dd className="text-sm text-gray-700 whitespace-pre-wrap">{openBooking.additionalData}</dd>
                </div>
              )}
            </dl>
            <div className="flex justify-end mt-5">
              <button onClick={() => setOpenBooking(null)} className="px-4 py-2 rounded-lg text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-24 shrink-0 text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-0.5">{label}</dt>
      <dd className="flex-1 text-sm text-gray-700 break-words">{value}</dd>
    </div>
  );
}

// ── NewBookingModal ─────────────────────────────────────────────────────────
// Crea una cita manual desde admin con status='confirmed' (default del
// endpoint POST /api/citas/bookings). Valida modality contra las del
// EventType seleccionado. NO valida disponibilidad ni minNoticeHours —
// admin puede crear fuera de slot si lo necesita; el backend solo
// chequea solapamiento con otras citas activas (409 si hay).

function NewBookingModal({ onClose, onCreated }) {
  const [eventTypes, setEventTypes] = useState([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [form, setForm] = useState({
    eventTypeId: "",
    date: "",
    time: "",
    modality: "",
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    additionalData: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/citas/event-types?active=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && Array.isArray(j.data)) setEventTypes(j.data);
      })
      .finally(() => setLoadingTypes(false));
  }, []);

  const selectedType = eventTypes.find((e) => e.id === form.eventTypeId);
  const availableModalities = selectedType?.modalities ?? [];

  // Si la modalidad actual no es válida para el tipo seleccionado, la
  // limpiamos para forzar a Laura a elegir una nueva.
  useEffect(() => {
    if (form.modality && selectedType && !availableModalities.includes(form.modality)) {
      setForm((f) => ({ ...f, modality: "" }));
    }
  }, [selectedType, form.modality, availableModalities]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    if (error) setError(null);
  }

  function combinedISO() {
    if (!form.date || !form.time) return null;
    const local = new Date(`${form.date}T${form.time}:00`);
    if (Number.isNaN(local.getTime())) return null;
    return local.toISOString();
  }

  function validate() {
    if (!form.eventTypeId) return "Selecciona un tipo de cita";
    if (!form.date || !form.time) return "Fecha y hora son obligatorias";
    if (!form.modality) return "Selecciona una modalidad";
    if (!form.clientName.trim()) return "Nombre del paciente obligatorio";
    if (!form.clientEmail.trim()) return "Email del paciente obligatorio";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.clientEmail.trim())) return "Email no tiene formato válido";
    if (!form.clientPhone.trim()) return "Teléfono del paciente obligatorio";
    if (selectedType?.additionalDataRequired && !form.additionalData.trim()) {
      return `${selectedType.additionalDataLabel || "Respuesta al formulario"} obligatoria para este tipo`;
    }
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) { setError(v); return; }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/citas/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventTypeId: form.eventTypeId,
          clientName: form.clientName.trim(),
          clientEmail: form.clientEmail.trim(),
          clientPhone: form.clientPhone.trim(),
          additionalData: form.additionalData.trim() || null,
          scheduledAt: combinedISO(),
          modality: form.modality,
          notes: form.notes.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) {
        if (r.status === 403) {
          setError("Solo administradores pueden crear citas manualmente.");
        } else if (r.status === 409) {
          setError(j.error || "Esa hora ya está ocupada por otra cita activa.");
        } else if (r.status === 404) {
          setError(j.error || "Tipo de cita no encontrado.");
        } else {
          setError(j.error || `Error al crear cita (HTTP ${r.status})`);
        }
        return;
      }
      onCreated?.(j.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Nueva cita manual</h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Tipo de cita */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Tipo de cita *
            </label>
            <select
              value={form.eventTypeId}
              onChange={(e) => update("eventTypeId", e.target.value)}
              disabled={loadingTypes}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] disabled:opacity-50"
            >
              <option value="">{loadingTypes ? "Cargando…" : "Selecciona un tipo"}</option>
              {eventTypes.map((et) => (
                <option key={et.id} value={et.id}>
                  {et.name} · {et.duration} min
                </option>
              ))}
            </select>
          </div>

          {/* Fecha + hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Fecha *
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => update("date", e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Hora *
              </label>
              <input
                type="time"
                value={form.time}
                onChange={(e) => update("time", e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
              />
            </div>
          </div>

          {/* Modalidad */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Modalidad *
            </label>
            <select
              value={form.modality}
              onChange={(e) => update("modality", e.target.value)}
              disabled={!selectedType}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] disabled:opacity-50"
            >
              <option value="">{selectedType ? "Selecciona" : "Elige primero el tipo de cita"}</option>
              {availableModalities.map((m) => (
                <option key={m} value={m}>{MODALITY_LABELS[m] ?? m}</option>
              ))}
            </select>
          </div>

          {/* Cliente */}
          <div className="pt-3 border-t border-gray-100">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Datos del paciente
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Nombre *
                </label>
                <input
                  type="text"
                  value={form.clientName}
                  onChange={(e) => update("clientName", e.target.value)}
                  placeholder="María García"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={form.clientEmail}
                    onChange={(e) => update("clientEmail", e.target.value)}
                    placeholder="maria@ejemplo.com"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    Teléfono *
                  </label>
                  <input
                    type="tel"
                    value={form.clientPhone}
                    onChange={(e) => update("clientPhone", e.target.value)}
                    placeholder="+34 612 345 678"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Respuesta al formulario si el tipo lo requiere */}
          {selectedType?.additionalDataRequired && (
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                {selectedType.additionalDataLabel || "Respuesta al formulario"} *
              </label>
              <textarea
                rows={3}
                value={form.additionalData}
                onChange={(e) => update("additionalData", e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none"
              />
            </div>
          )}

          {/* Notas internas */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Notas internas (opcional)
            </label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Recordatorios, observaciones del equipo…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 text-xs font-medium text-gray-700 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="flex-1 text-xs font-semibold text-white bg-[var(--color-primary)] hover:opacity-90 px-3 py-2 rounded-lg disabled:opacity-50"
          >
            {submitting ? "Creando…" : "Crear cita"}
          </button>
        </div>
      </div>
    </div>
  );
}
