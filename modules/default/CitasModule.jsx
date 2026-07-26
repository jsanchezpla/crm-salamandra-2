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
import BuscadorPaciente from "@/components/citas/BuscadorPaciente.jsx";

const STATUS_LABELS = {
  pending: "Pendiente",
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

// Fecha/hora local para los <input> date/time. NO usar toISOString(): eso pasa
// a UTC y en España adelantaría/retrasaría una o dos horas el hueco pulsado.
function toDateInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toTimeInput(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtRelative(value) {
  if (!value) return "";
  const min = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
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
  clientId: "",
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  modality: "",
  additionalData: "",
  notes: "",
  patientId: "",
  teamMemberId: "",
};

export default function CitasModule() {
  const calendarRef = useRef(null);
  // Vista: "calendar" (por defecto) o "waitlist". La lista de espera son las
  // reservas en estado 'pending' (solicitudes de la web sin confirmar). El
  // globito rojo de la pestaña muestra cuántas hay sin atender.
  const [tab, setTab] = useState("calendar");
  const [pendingCount, setPendingCount] = useState(0);
  const [waitlistKey, setWaitlistKey] = useState(0); // fuerza recarga de la lista
  // Vista/fecha del calendario, para no perder la semana al ir a la lista de
  // espera y volver (arreglo 2026-07-23). `calViewRef` sigue en vivo la posición
  // (datesSet); `calView` es lo que se aplica al montar el calendario.
  const calViewRef = useRef({ view: "timeGridWeek", date: null });
  const [calView, setCalView] = useState({ view: "timeGridWeek", date: null });
  const [eventTypes, setEventTypes] = useState([]);
  const [visibleEtIds, setVisibleEtIds] = useState(null); // null = todos
  const [openBooking, setOpenBooking] = useState(null); // booking abierto en modal detalle
  // Panel "Proponer 3 horarios (IA)"
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestScope, setSuggestScope] = useState("professional");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestErr, setSuggestErr] = useState(null);
  const [suggestNote, setSuggestNote] = useState(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_BOOKING_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [detailNotes, setDetailNotes] = useState("");
  const [detailMeet, setDetailMeet] = useState("");
  const [teamMembers, setTeamMembers] = useState([]);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const [visibleTmIds, setVisibleTmIds] = useState(null); // null = todos los profesionales
  const [patients, setPatients] = useState([]); // vacío si el tenant no tiene Clínica/Pacientes

  // Cuántas solicitudes pendientes hay (para el globito de la pestaña). No
  // cambia de vista: el usuario decidió arrancar SIEMPRE en el calendario.
  const loadPendingCount = useCallback(() => {
    fetch("/api/citas/bookings?status=pending&limit=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setPendingCount(j?.ok ? (j.data.total ?? 0) : 0))
      .catch(() => {});
  }, []);
  useEffect(() => { loadPendingCount(); }, [loadPendingCount]);

  const loadEventTypes = useCallback(async () => {
    const res = await fetch("/api/citas/event-types?active=true", { cache: "no-store" });
    const j = await res.json();
    if (j.ok) setEventTypes(j.data);
  }, []);

  useEffect(() => { loadEventTypes(); }, [loadEventTypes]);

  // Equipo para asignar profesional a la cita y para el filtro del calendario.
  // `viewerIsAdmin` decide si se muestra el filtro por profesional (el jefe ve a
  // todos; un profesional ya viene acotado a lo suyo desde el servidor).
  useEffect(() => {
    fetch("/api/team?status=all&limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setTeamMembers(j.data?.members ?? []);
        setViewerIsAdmin(!!j.data?.viewerIsAdmin);
      })
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
      // Filtro por profesional (solo lo usa el jefe; el servidor ya acota a un
      // profesional no-admin). null = todos; [] = ninguno seleccionado.
      if (visibleTmIds && visibleTmIds.length > 0) {
        params.set("teamMemberIds", visibleTmIds.join(","));
      } else if (visibleTmIds && visibleTmIds.length === 0) {
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
  }, [visibleEtIds, visibleTmIds]);

  useEffect(() => {
    calendarRef.current?.getApi().refetchEvents();
  }, [visibleEtIds, visibleTmIds]);

  function toggleEventType(id) {
    setVisibleEtIds((prev) => {
      const current = prev ?? eventTypes.map((e) => e.id);
      if (current.includes(id)) return current.filter((x) => x !== id);
      return [...current, id];
    });
  }

  function showAllEventTypes() { setVisibleEtIds(null); }

  function toggleTeamMember(id) {
    setVisibleTmIds((prev) => {
      const current = prev ?? teamMembers.map((m) => m.id);
      if (current.includes(id)) return current.filter((x) => x !== id);
      return [...current, id];
    });
  }

  function showAllTeamMembers() { setVisibleTmIds(null); }

  async function handleEventClick(info) {
    const id = info.event.id;
    const res = await fetch(`/api/citas/bookings/${id}`, { cache: "no-store" });
    const j = await res.json();
    if (j.ok) {
      setOpenBooking(j.data);
      setDetailNotes(j.data.notes ?? "");
      setDetailMeet(j.data.meetUrl ?? "");
      setSuggestOpen(false); setSuggestions([]); // reset del panel de propuestas al abrir otra cita
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
      // Refresca el globito de pendientes (arreglo 2026-07-23): cancelar/confirmar
      // una cita pendiente desde el calendario cambia el número de la lista de
      // espera; sin esto el contador quedaba desactualizado.
      loadPendingCount();
      return true;
    } catch (err) {
      setFormError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function loadSuggestions(scope) {
    if (!openBooking) return;
    setSuggestOpen(true); setSuggestScope(scope); setSuggestLoading(true);
    setSuggestErr(null); setSuggestions([]); setSuggestNote(null);
    try {
      const r = await fetch(`/api/citas/bookings/${openBooking.id}/suggest-slots`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudieron proponer horarios");
      setSuggestions(j.data.suggestions || []);
      setSuggestNote(j.data.note || null);
    } catch (e) {
      setSuggestErr(e.message);
    } finally {
      setSuggestLoading(false);
    }
  }
  async function applySuggestion(s) {
    const payload = { scheduledAt: s.datetime };
    if (s.teamMemberId) payload.teamMemberId = s.teamMemberId;
    const okp = await patchBooking(payload);
    if (okp) { setSuggestOpen(false); setSuggestions([]); }
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
    // Al cambiar de tipo de cita (arreglo 2026-07-23): si la modalidad elegida
    // ya no la ofrece el tipo nuevo, se limpia. Antes quedaba una modalidad
    // huérfana (p. ej. 'online') que colaba la validación cliente y el servidor
    // rechazaba con un error confuso.
    if (field === "eventTypeId") {
      const nuevoTipo = eventTypes.find((e) => e.id === value);
      setCreateForm((prev) => {
        const modalidadValida = nuevoTipo?.modalities?.includes(prev.modality);
        return { ...prev, eventTypeId: value, modality: modalidadValida ? prev.modality : "" };
      });
      return;
    }
    // Al elegir paciente, PRIMA su terapeuta asignado como profesional de la cita
    // (Rodrigo: la reserva pública es general y el terapeuta se decide en el CRM,
    // primando el asignado al paciente). Si el paciente no tiene terapeuta, se
    // conserva el profesional que hubiera. El usuario siempre puede cambiarlo.
    if (field === "patientId") {
      const p = patients.find((x) => x.id === value);
      const terapeuta = p?.mainTherapistId ?? p?.therapistId ?? null;
      setCreateForm((prev) => ({ ...prev, patientId: value, teamMemberId: terapeuta ?? prev.teamMemberId }));
      return;
    }
    setCreateForm((prev) => ({ ...prev, [field]: value }));
  }

  // Abre "Nueva cita" con la fecha/hora ya puestas desde un clic en el
  // calendario. `iso` es la fecha ISO del hueco pulsado.
  function abrirCreacionEn(iso) {
    const d = iso ? new Date(iso) : null;
    const date = d && !Number.isNaN(d.getTime()) ? toDateInput(d) : "";
    const time = d && !Number.isNaN(d.getTime()) && iso.includes("T") ? toTimeInput(d) : "";
    setCreateForm({ ...EMPTY_BOOKING_FORM, date, time });
    setFormError(null);
    setOpenCreate(true);
  }

  // Doble clic en un hueco vacío → nueva cita lista para editar. FullCalendar
  // no distingue el doble clic, así que lo detectamos: dos `dateClick` sobre
  // la MISMA hora en menos de 400 ms. Un clic suelto no hace nada (evita abrir
  // el formulario cada vez que rozas el calendario).
  const lastClickRef = useRef({ at: 0, key: "" });
  function handleDateClick(info) {
    const key = info.dateStr;
    const now = Date.now();
    const prev = lastClickRef.current;
    if (prev.key === key && now - prev.at < 400) {
      lastClickRef.current = { at: 0, key: "" };
      abrirCreacionEn(info.dateStr);
    } else {
      lastClickRef.current = { at: now, key };
    }
  }

  // Clic y arrastrar sobre un rango horario → nueva cita a esa hora de inicio.
  function handleDateSelect(info) {
    abrirCreacionEn(info.startStr);
    info.view?.calendar?.unselect();
  }

  // Arrastrar una cita ya existente a otro hueco → reprogramarla. El backend
  // (PATCH scheduledAt) ya valida el solapamiento; si choca con otra cita
  // activa o falla, se revierte al sitio original y se avisa. Solo se mueve el
  // INICIO (la duración no se toca: el resize está desactivado). Las citas
  // canceladas/completadas no son arrastrables (startEditable=false desde el
  // endpoint del calendario).
  async function handleEventDrop(info) {
    const nuevoIso = info.event.start ? info.event.start.toISOString() : null;
    if (!nuevoIso) { info.revert(); return; }
    try {
      const res = await fetch(`/api/citas/bookings/${info.event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: nuevoIso }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "No se pudo mover la cita");
      // FullCalendar ya la ha pintado en el hueco nuevo; refrescamos para
      // reconciliar con el servidor (color/estado/hora exacta).
      calendarRef.current?.getApi().refetchEvents();
    } catch (err) {
      info.revert();
      window.alert(err.message);
    }
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
          clientId: createForm.clientId || null,
          clientName: createForm.clientName.trim(),
          clientEmail: createForm.clientEmail.trim(),
          clientPhone: createForm.clientPhone.trim(),
          modality: createForm.modality,
          additionalData: createForm.additionalData.trim() || null,
          notes: createForm.notes.trim() || null,
          patientId: createForm.patientId || null,
          teamMemberId: createForm.teamMemberId || null,
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
            onClick={() => { setCreateForm(EMPTY_BOOKING_FORM); setOpenCreate(true); setFormError(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-md hover:bg-[#222] transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nueva cita manual
          </button>
        </div>
      </div>

      {/* Pestañas: Calendario · Lista de espera (con globito de pendientes) */}
      <div className="px-6 lg:px-10 pt-3 flex items-center gap-1 shrink-0">
        <button
          onClick={() => { setCalView(calViewRef.current); setTab("calendar"); }}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            tab === "calendar" ? "bg-[var(--color-primary,#0F0F0F)] text-white" : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          Calendario
        </button>
        <button
          onClick={() => { setTab("waitlist"); setWaitlistKey((k) => k + 1); }}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${
            tab === "waitlist" ? "bg-[var(--color-primary,#0F0F0F)] text-white" : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          Lista de espera
          {pendingCount > 0 && (
            <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold ${
              tab === "waitlist" ? "bg-white/25 text-white" : "bg-red-500 text-white"
            }`}>
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* ─── Pestaña Lista de espera ─── */}
      {tab === "waitlist" && (
        <div className="flex-1 overflow-auto min-h-0">
          <Waitlist
            refreshKey={waitlistKey}
            onCountChange={setPendingCount}
            onActioned={() => { loadPendingCount(); calendarRef.current?.getApi().refetchEvents(); }}
          />
        </div>
      )}

      {/* Filtro de tipos */}
      {tab === "calendar" && eventTypes.length > 0 && (
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

      {/* Filtro por profesional — solo el jefe (admin) y si hay más de uno. El
          color del chip casa con el de sus citas en el calendario. */}
      {tab === "calendar" && viewerIsAdmin && teamMembers.length > 1 && (
        <div className="px-6 lg:px-10 py-3 flex items-center gap-2 flex-wrap shrink-0 border-b border-neutral-100">
          <span className="text-[11px] uppercase tracking-wider text-neutral-400 mr-1">Profesional:</span>
          <button
            onClick={showAllTeamMembers}
            className={`text-[11px] px-2 py-1 rounded-md border ${
              visibleTmIds == null
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            Todos
          </button>
          {teamMembers.map((m) => {
            const active = visibleTmIds == null || visibleTmIds.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggleTeamMember(m.id)}
                className={`text-[11px] px-2 py-1 rounded-md border flex items-center gap-1.5 transition ${
                  active
                    ? "bg-white text-neutral-700 border-neutral-300"
                    : "bg-neutral-50 text-neutral-400 border-neutral-200 line-through"
                }`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: m.avatarColor ?? "#3F6E5B" }}
                />
                {m.displayName}
              </button>
            );
          })}
        </div>
      )}

      {/* Calendario */}
      {tab === "calendar" && (
        <div className="flex-1 p-6 min-h-0">
          <p className="text-[11px] text-neutral-400 mb-2">
            Doble clic en un hueco para crear una cita, arrastra sobre un tramo horario, o arrastra una cita existente para moverla.
          </p>
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView={calView.view}
            initialDate={calView.date || undefined}
            datesSet={(arg) => { calViewRef.current = { view: arg.view.type, date: arg.startStr }; }}
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
            selectable={true}
            selectMirror={true}
            dateClick={handleDateClick}
            select={handleDateSelect}
            editable={true}
            eventDurationEditable={false}
            eventDrop={handleEventDrop}
            height="calc(100vh - 280px)"
            buttonText={{ today: "Hoy", month: "Mes", week: "Semana", day: "Día", list: "Lista" }}
          />
        </div>
      )}

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

            {suggestOpen && (
              <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/60">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">🦎 Proponer horarios (IA)</div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => loadSuggestions("professional")} disabled={!openBooking.teamMemberId} title={!openBooking.teamMemberId ? "La cita no tiene profesional" : ""}
                      className={`text-[11px] px-2 py-0.5 rounded-full border disabled:opacity-40 ${suggestScope === "professional" ? "border-transparent text-white" : "border-neutral-200 text-neutral-500 hover:bg-white"}`}
                      style={suggestScope === "professional" ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>Este profesional</button>
                    <button onClick={() => loadSuggestions("company")}
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${suggestScope === "company" ? "border-transparent text-white" : "border-neutral-200 text-neutral-500 hover:bg-white"}`}
                      style={suggestScope === "company" ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>Todo el centro</button>
                    <button onClick={() => setSuggestOpen(false)} className="text-neutral-400 hover:text-neutral-700 px-1" aria-label="Cerrar">✕</button>
                  </div>
                </div>
                {suggestLoading ? (
                  <p className="text-[12px] text-neutral-400 py-2">Buscando huecos…</p>
                ) : suggestErr ? (
                  <p className="text-[12px] text-rose-600 py-2">{suggestErr}</p>
                ) : suggestions.length === 0 ? (
                  <p className="text-[12px] text-neutral-400 py-2">{suggestNote || "Sin huecos que proponer."}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {suggestions.map((s, i) => (
                      <div key={i} className="bg-white border border-neutral-200 rounded-lg p-2.5 flex flex-col">
                        <div className="text-[12px] font-medium text-neutral-800 capitalize">{s.label}</div>
                        {s.teamMemberName && <div className="text-[11px] text-neutral-500">{s.teamMemberName}</div>}
                        <div className="text-[10px] text-neutral-400 mt-1 flex-1 leading-snug">{s.reason}</div>
                        <button onClick={() => applySuggestion(s)} disabled={saving} className="mt-2 text-[11px] font-medium px-2 py-1 rounded-md text-white disabled:opacity-50" style={{ backgroundColor: "var(--color-primary,#1B3A2D)" }}>Elegir esta</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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
                <button
                  onClick={() => loadSuggestions(openBooking.teamMemberId ? "professional" : "company")}
                  disabled={saving || suggestLoading}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  title="La IA propone 3 huecos para reprogramar esta cita"
                >
                  🦎 Proponer 3 horarios
                </button>
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

              <BuscadorPaciente
                etiqueta="Cliente / paciente *"
                nombre={createForm.clientName}
                vinculadaA={createForm.clientId}
                onEscribir={(texto) =>
                  setCreateForm((prev) => ({ ...prev, clientName: texto, clientId: "" }))
                }
                onElegir={(c) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    clientId: c.id,
                    clientName: c.name || "",
                    clientEmail: c.email || prev.clientEmail,
                    clientPhone: c.phone || prev.clientPhone,
                  }))
                }
                onDesvincular={() => setCreateForm((prev) => ({ ...prev, clientId: "" }))}
              />

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

              {teamMembers.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Profesional (opcional)</label>
                  <Select
                    value={createForm.teamMemberId}
                    onChange={(v) => updateCreateForm("teamMemberId", v)}
                    options={[
                      { value: "", label: "Sin profesional asignado" },
                      ...teamMembers.map((m) => ({ value: m.id, label: m.displayName })),
                    ]}
                    placeholder="Sin profesional asignado"
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

// ─── Lista de espera ────────────────────────────────────────────────────────
// Las reservas en estado 'pending': solicitudes de la web que la persona ya
// eligió con fecha y hora y esperan que se confirmen o rechacen.
function Waitlist({ refreshKey, onCountChange, onActioned }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/citas/bookings?status=pending&limit=50", { cache: "no-store" })
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
      if (!j.ok) { setError(j.error || "Error al confirmar"); return; }
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
      if (!j.ok) { setError(j.error || "Error al rechazar"); return; }
      setRejectFor(null);
      setRejectReason("");
      onActioned?.();
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="px-6 lg:px-10 py-12 text-center text-sm text-neutral-400">Cargando lista de espera…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="px-6 lg:px-10 py-16 text-center">
        <div className="text-base text-neutral-700 font-medium">Sin solicitudes pendientes</div>
        <p className="text-xs text-neutral-400 mt-1">Las nuevas solicitudes desde la web aparecerán aquí.</p>
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-10 py-6 max-w-5xl mx-auto space-y-3">
      {error && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">{error}</div>}
      {items.map((b) => {
        const isReject = rejectFor === b.id;
        return (
          <article key={b.id} className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-5 flex flex-col lg:flex-row lg:items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-50 text-amber-700 border-amber-100">
                    {STATUS_LABELS.pending}
                  </span>
                  <span className="text-xs text-neutral-400">{fmtRelative(b.createdAt)}</span>
                </div>
                <h3 className="text-base font-semibold text-neutral-900">{b.clientName}</h3>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {b.clientEmail && <a href={`mailto:${b.clientEmail}`} className="hover:text-[var(--color-primary)]">{b.clientEmail}</a>}
                  {b.clientEmail && b.clientPhone && " · "}
                  {b.clientPhone && <a href={`tel:${b.clientPhone}`} className="hover:text-[var(--color-primary)]">{b.clientPhone}</a>}
                </div>

                <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-y-1 gap-x-4 text-xs">
                  <WaitlistDetail label="Servicio" value={b.eventType?.name ?? "—"} />
                  <WaitlistDetail label="Cuándo" value={fmtDateTime(b.scheduledAt)} />
                  <WaitlistDetail label="Modalidad" value={MODALITY_LABELS[b.modality] ?? b.modality} />
                </dl>

                {b.additionalData && (
                  <div className="mt-3 px-3 py-2 bg-neutral-50 border border-neutral-100 rounded-md">
                    <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-0.5">Respuesta al formulario</div>
                    <p className="text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed">{b.additionalData}</p>
                  </div>
                )}
              </div>

              <div className="shrink-0 flex flex-col gap-2 lg:w-44">
                {isReject ? (
                  <>
                    <textarea
                      rows={2}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Motivo (opcional, se envía por email)"
                      className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--color-primary)] resize-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => { setRejectFor(null); setRejectReason(""); }} disabled={busyId === b.id} className="flex-1 bg-white border border-neutral-200 text-neutral-700 text-xs font-medium py-1.5 rounded-md hover:bg-neutral-50 disabled:opacity-50">
                        Cancelar
                      </button>
                      <button onClick={() => reject(b.id)} disabled={busyId === b.id} className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-1.5 rounded-md disabled:opacity-50">
                        {busyId === b.id ? "…" : "Rechazar"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button onClick={() => confirm(b.id)} disabled={busyId === b.id} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-md transition-colors disabled:opacity-50">
                      {busyId === b.id ? "…" : "Confirmar"}
                    </button>
                    <button onClick={() => setRejectFor(b.id)} disabled={busyId === b.id} className="bg-white hover:bg-red-50 text-red-600 border border-red-200 text-xs font-medium py-2 rounded-md transition-colors disabled:opacity-50">
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

function WaitlistDetail({ label, value }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">{label}</dt>
      <dd className="text-neutral-700 mt-0.5">{value}</dd>
    </div>
  );
}
