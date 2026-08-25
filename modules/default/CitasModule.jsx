"use client";

/**
 * CitasModule (default) — agenda "vanilla" usada por tenants sin override.
 * El wrapper `app/(dashboard)/citas/page.jsx` decide entre este componente
 * y el override según `x-tenant` del request.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import HelpTooltip from "../../components/ui/HelpTooltip.jsx";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import Select from "@/components/ui/Select.jsx";
import MultiSelect from "@/components/ui/MultiSelect.jsx";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import BuscadorPaciente from "@/components/citas/BuscadorPaciente.jsx";
import ModalFestivos from "@/components/citas/ModalFestivos.jsx";
import { formatMoney } from "@/lib/payments/money.js";
import { COLOR_BLOQUEO_POR_DEFECTO, colorTextoSobre } from "@/lib/citas/coloresBloqueo.js";
import { SIN_PROFESIONAL, COLOR_CITA_POR_DEFECTO } from "@/lib/citas/filtros.js";

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

// ── Cobro online ───────────────────────────────────────────────────────────
// Sin esto había que abrir el panel de Stripe para saber si una cita estaba
// pagada. Las citas sin precio (paymentStatus 'none') no pintan nada: quien no
// cobra online no debe ver ni rastro de esto.
// La palabra IMPORTA. "Retenido" no puede leerse como "cobrado": es la
// diferencia entre cerrar el día creyendo que has cobrado y saber que aún no.
// Por eso ninguno de los estados de retención usa el verde de "Cobrada".
const PAGO_LABELS = {
  pending: "Pago pendiente",
  authorizing: "Esperando tarjeta",
  authorized: "Retenido, sin cobrar",
  capturing: "Cobrando…",
  paid: "Cobrada",
  refunded: "Devuelta",
  failed: "No se pudo cobrar",
  void: "Sin cobro",
};
const PAGO_COLORS = {
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  authorizing: "bg-neutral-100 text-neutral-600 border-neutral-200",
  authorized: "bg-amber-50 text-amber-800 border-amber-200",
  capturing: "bg-sky-50 text-sky-700 border-sky-100",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-100",
  refunded: "bg-sky-50 text-sky-700 border-sky-100",
  failed: "bg-red-50 text-red-700 border-red-100",
  void: "bg-neutral-100 text-neutral-500 border-neutral-200",
};
const PAGO_AYUDA = {
  authorized: "El importe está reservado en su tarjeta. Se cobrará al confirmar la cita.",
  capturing: "Se está cobrando ahora mismo.",
  // 'failed' NO tiene frase fija aquí: depende de POR QUÉ falló. Ver `ayudaCobroFallido`.
  void: "No hay dinero reservado: se liberó o caducó. Puedes confirmarla y cobrar en consulta.",
};

/** Cuánto queda para que muera una retención, en cristiano. */
export function cuantoQuedaDeRetencion(fecha) {
  if (!fecha) return null;
  const ms = new Date(fecha).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { texto: "caducada", urgente: true };
  const horas = ms / 3_600_000;
  if (horas < 1) return { texto: `caduca en ${Math.max(1, Math.round(ms / 60_000))} min`, urgente: true };
  if (horas < 48) return { texto: `caduca en ${Math.round(horas)} h`, urgente: horas < 24 };
  return { texto: `caduca en ${Math.round(horas / 24)} días`, urgente: false };
}

/**
 * Los motivos que escribe NUESTRO código cuando retira una cita porque el dinero
 * nunca llegó a moverse (`retirarCitaImpagada`, en `lib/payments/entityHooks.js`).
 * Se comparan literales a propósito: los escribe el flujo de pagos, no una
 * persona, así que o casan exactamente o no son de los nuestros.
 */
const MOTIVOS_PAGO_SIN_COMPLETAR = new Set([
  "No se completó el pago a tiempo", // el checkout caducó: carrito abandonado
  "El pago no se completó", // liquidación diferida (SEPA, Multibanco…) que nunca cuajó
]);

/**
 * ¿El cobro se quedó a medias por parte del paciente, en vez de rechazarlo el banco?
 *
 * DE DÓNDE SALE (10/08/2026, una clienta de Laura)
 * `paymentStatus: 'failed'` lo escriben DOS caminos que no se parecen en nada:
 *   · `lib/citas/cobroCita.js` — el banco rechaza de verdad la captura;
 *   · `lib/payments/entityHooks.js` — el checkout caducó sin pagarse, o el pago
 *     diferido nunca liquidó. Ahí el banco no ha rechazado nada: no ha llegado a
 *     haber cobro que rechazar.
 * La pantalla enseñaba SIEMPRE el primero, así que se le pudo decir a una
 * paciente que su banco había fallado siendo falso.
 *
 * Solo se afirma lo que consta ESCRITO en la cita. Si el motivo no es uno de los
 * nuestros —una cancelación a mano de la profesional, o un motivo que se borró al
 * reactivar la cita (`app/api/citas/bookings/[id]/route.js`)— devuelve `false` y
 * el texto sale neutro: preferimos decir que no se sabe a acusar al banco sin
 * pruebas. Aquí no se decide nada del cobro, solo lo que se lee en pantalla.
 */
export function pagoQuedoSinCompletar(cancellationReason) {
  return MOTIVOS_PAGO_SIN_COMPLETAR.has(
    typeof cancellationReason === "string" ? cancellationReason.trim() : ""
  );
}

/** La frase corta del globito cuando el cobro consta fallido. */
function ayudaCobroFallido(cancellationReason) {
  return pagoQuedoSinCompletar(cancellationReason)
    ? "No llegó a completar el pago. No es un rechazo del banco, y no se le ha cobrado nada."
    : "El cobro no se completó y no se le ha cobrado nada. Puedes reintentarlo o pedirle otra tarjeta.";
}

function PagoChip({ estado, amount, caducaEn, motivoCancelacion = null }) {
  if (!estado || estado === "none") return null;
  const cls = PAGO_COLORS[estado] ?? "bg-neutral-100 text-neutral-500 border-neutral-200";
  const importe = Number.isInteger(amount) && amount > 0 ? ` · ${formatMoney(amount)}` : "";
  const queda = estado === "authorized" ? cuantoQuedaDeRetencion(caducaEn) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}
        title={
          estado === "failed" ? ayudaCobroFallido(motivoCancelacion) : (PAGO_AYUDA[estado] ?? undefined)
        }
      >
        {PAGO_LABELS[estado] ?? estado}
        {importe}
      </span>
      {queda && (
        <span className={`text-[11px] ${queda.urgente ? "text-red-600 font-medium" : "text-neutral-400"}`}>
          {queda.texto}
        </span>
      )}
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
  // Festivos/cierres del centro: Map "YYYY-MM-DD" → { id, label }. Se recargan
  // al cambiar de mes/semana (datesSet) para no traerse el año entero.
  const [festivos, setFestivos] = useState(new Map());
  const [pendingCount, setPendingCount] = useState(0);
  const [waitlistKey, setWaitlistKey] = useState(0); // fuerza recarga de la lista
  // Solicitudes de cambio de cita (terapeuta propone → admin aprueba). Solo admin.
  const [changeRequests, setChangeRequests] = useState([]);
  const [changeReqPending, setChangeReqPending] = useState(0);
  const [changeReqLoading, setChangeReqLoading] = useState(false);
  const [changeReqBusyId, setChangeReqBusyId] = useState(null);
  // Vista/fecha del calendario, para no perder la semana al ir a la lista de
  // espera y volver (arreglo 2026-07-23). `calViewRef` sigue en vivo la posición
  // (datesSet); `calView` es lo que se aplica al montar el calendario.
  // En móvil la vista SEMANA es ilegible (7 columnas de franjas horarias en
  // 375px). Se arranca en "lista", que es como se consulta la agenda desde el
  // teléfono: qué toca hoy y a qué hora.
  const [esMovil, setEsMovil] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const aplicar = () => setEsMovil(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);

  // `initialView` solo lo lee FullCalendar al montarse, y para entonces
  // todavía no sabemos el tamaño de la pantalla: hay que cambiar la vista a
  // mano cuando se resuelve (o cuando se gira el móvil).
  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (!api) return;
    const actual = api.view?.type;
    if (esMovil && actual === "timeGridWeek") api.changeView("listWeek");
    if (!esMovil && actual === "listWeek") api.changeView("timeGridWeek");
  }, [esMovil, tab]);

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
  const [suggestSent, setSuggestSent] = useState(null); // confirmación tras enviar propuesta al centro
  const [openCreate, setOpenCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_BOOKING_FORM);
  // El bono de quien se acaba de elegir en el alta manual: `{ tono, texto,
  // eventTypeId }`. Ver `buscarBono`.
  const [bonoAviso, setBonoAviso] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [detailNotes, setDetailNotes] = useState("");
  // Fecha y hora editables desde la propia tarjeta (07/08/2026, Rodrigo):
  // arrastrar en el calendario está bien para mover media hora, pero no para
  // pasar una cita a otro mes ni para ajustar a las 10:05.
  const [avisoHora, setAvisoHora] = useState(null);
  const [detailFecha, setDetailFecha] = useState("");
  const [detailHora, setDetailHora] = useState("");
  const [detailMeet, setDetailMeet] = useState("");
  // Aviso efímero tras "Guardar y enviar" (enviado / solo guardado).
  const [meetAviso, setMeetAviso] = useState(null);
  // Aviso libre al cliente (03/08): lo que no encaja en «se cambió tu cita».
  const [avisoAbierto, setAvisoAbierto] = useState(false);
  const [avisoTitulo, setAvisoTitulo] = useState("");
  const [avisoCuerpo, setAvisoCuerpo] = useState("");
  const [enviandoAviso, setEnviandoAviso] = useState(false);
  const [avisoResultado, setAvisoResultado] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  // Su id de usuario, para poder encontrar SU ficha de equipo y rotularla.
  const [viewerUserId, setViewerUserId] = useState(null);
  const [visibleTmIds, setVisibleTmIds] = useState(null); // null = todos los profesionales
  const [patients, setPatients] = useState([]); // vacío si el tenant no tiene Clínica/Pacientes
  const [festivosAbierto, setFestivosAbierto] = useState(false);

  // Preguntas y avisos, dentro del CRM y no del navegador (12/08/2026, Rodrigo).
  const { confirmar, avisar, pedirTexto, elegir, dialogo } = useDialogo();

  // Cuántas solicitudes pendientes hay (para el globito de la pestaña). No
  // cambia de vista: el usuario decidió arrancar SIEMPRE en el calendario.
  const loadPendingCount = useCallback(() => {
    fetch("/api/citas/bookings?status=pending&limit=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setPendingCount(j?.ok ? (j.data.total ?? 0) : 0))
      .catch(() => {});
  }, []);
  useEffect(() => { loadPendingCount(); }, [loadPendingCount]);

  // Solicitudes de cambio de cita (solo admin; el endpoint devuelve 403 si no).
  const loadChangeRequests = useCallback(() => {
    setChangeReqLoading(true);
    fetch("/api/citas/reschedule-requests?status=pending", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        setChangeRequests(j?.data?.requests ?? []);
        setChangeReqPending(j?.data?.pendingCount ?? 0);
      })
      .catch(() => {})
      .finally(() => setChangeReqLoading(false));
  }, []);
  useEffect(() => { if (viewerIsAdmin) loadChangeRequests(); }, [viewerIsAdmin, loadChangeRequests]);

  async function resolveChangeRequest(id, action) {
    setChangeReqBusyId(id);
    try {
      const r = await fetch(`/api/citas/reschedule-requests/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo procesar la solicitud");
      loadChangeRequests();
      if (action === "approve") calendarRef.current?.getApi().refetchEvents();
    } catch (e) {
      await avisar({ titulo: "No se ha podido", texto: e.message });
    } finally {
      setChangeReqBusyId(null);
    }
  }

  const loadEventTypes = useCallback(async () => {
    const res = await fetch("/api/citas/event-types?active=true", { cache: "no-store" });
    const j = await res.json();
    if (j.ok) setEventTypes(j.data);
  }, []);

  useEffect(() => { loadEventTypes(); }, [loadEventTypes]);

  // `viewerIsAdmin` se decide con /api/auth/me (el ROL), NO con /api/team: en un
  // tenant con citas pero SIN módulo team, /api/team da 403 y un admin real se
  // quedaba como no-admin (perdía "Elegir esta" y la pestaña Solicitudes).
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        setViewerIsAdmin(["admin", "superadmin"].includes(j?.data?.role));
        setViewerUserId(j?.data?.id ?? null);
      })
      .catch(() => {});
  }, []);

  // ── Festivos del centro ────────────────────────────────────────────────────
  // Fecha local en YYYY-MM-DD. NO se usa toISOString(): pasa a UTC y en España
  // (UTC+1/+2) devolvería el día anterior para cualquier fecha a medianoche.
  const ymdLocal = useCallback((d) => {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  }, []);

  const cargarFestivos = useCallback((from, to) => {
    fetch(`/api/citas/blocked-days?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.ok) return;
        setFestivos(new Map((j.data.blockedDays ?? []).map((f) => [f.date, f])));
      })
      .catch(() => {});
  }, []);

  /**
   * Recargar los festivos del mes que se está mirando. Lo llama el modal
   * después de marcar o quitar un día: su lista y la del calendario son
   * distintas a propósito (ver `ModalFestivos`), así que hay que avisar.
   */
  const recargarFestivosDeLaVista = useCallback(() => {
    const cal = calendarRef.current?.getApi();
    if (cal) cargarFestivos(ymdLocal(cal.view.activeStart), ymdLocal(cal.view.activeEnd));
  }, [cargarFestivos, ymdLocal]);

  /*
   * ⚠️ QUITAR UN FESTIVO DEJABA EL NOMBRE PUESTO (07/08/2026, Rodrigo).
   *
   * `dayCellContent` y `dayCellClassNames` son funciones que FullCalendar llama
   * UNA VEZ por celda y cachea. Leen `festivos`, que es estado de React, pero
   * FullCalendar no se entera de que ese estado ha cambiado: la fila se borraba
   * de la base de datos, la lista se recargaba bien, y la celda seguía pintada
   * en rojo con «Festivo» encima. Parecía que el borrado no había funcionado.
   *
   * Se le pide repintar cuando cambia el CONTENIDO de la lista. La dependencia
   * es una FIRMA de texto, no el Map: un Map nuevo con los mismos días no debe
   * disparar nada, o `render()` → `datesSet` → recarga → Map nuevo → `render()`
   * se convierte en un bucle infinito.
   */
  const firmaFestivos = useMemo(
    () => [...festivos.entries()].map(([f, v]) => `${f}:${v?.label ?? ""}`).sort().join("|"),
    [festivos]
  );
  useEffect(() => {
    calendarRef.current?.getApi()?.render();
  }, [firmaFestivos]);

  // Equipo para asignar profesional a la cita y para el filtro del calendario
  // (si el tenant no tiene team, /api/team da 403 y la lista queda vacía: ok).
  useEffect(() => {
    fetch("/api/team?status=all&limit=500", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setTeamMembers(j?.data?.members ?? []))
      .catch(() => {});
  }, []);

  /**
   * La ficha de equipo de quien mira (19/08/2026, Jorge).
   *
   * No filtra nada: el servidor ya acota a una profesional no-admin a SUS citas,
   * tanto en el listado como en el calendario (`lib/citas/visibilidad.js`). Lo que
   * faltaba era DECIRLO: su pantalla no llevaba ninguna señal de estar acotada, así
   * que no había forma de distinguir «estas son todas» de «estas son las tuyas».
   * Rocío dio por suyas unas citas que no lo eran.
   */
  const miFichaDeEquipo = teamMembers.find((m) => m.userId === viewerUserId) ?? null;

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
      /*
       * null = todos; lista con contenido = solo esos. La lista VACÍA ya no
       * existe (12/08/2026): los dos filtros vuelven a `null` al quedarse sin
       * nada marcado, así que aquí sobraban las dos ramas que devolvían
       * `success([])` y pintaban el calendario en blanco sin llegar a
       * preguntar al servidor. Con casillas eso estaba a un clic, y un
       * calendario vacío se lee como «han desaparecido las citas».
       *
       * El filtro por profesional solo lo usa el jefe: el servidor ya acota
       * por su cuenta a un profesional no-admin.
       */
      if (visibleEtIds?.length) params.set("eventTypeIds", visibleEtIds.join(","));
      if (visibleTmIds?.length) params.set("teamMemberIds", visibleTmIds.join(","));
      const res = await fetch(`/api/citas/bookings/calendar?${params}`, { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error cargando citas");

      /*
       * «Vacaciones» (06/08/2026): los tramos bloqueados se pintan de fondo,
       * no como citas. Si no se vieran, recepción solo se enteraría al chocar
       * con el aviso al guardar, que llega tarde y desconcierta.
       *
       * Best-effort: si la lista falla, se enseña la agenda sin sombrear. Los
       * bloqueos son un aviso visual; quien de verdad los hace cumplir es el
       * servidor al crear la cita.
       */
      let fondos = [];
      try {
        const rb = await fetch(
          `/api/citas/bloqueos?from=${info.startStr}&to=${info.endStr}`,
          { cache: "no-store" }
        );
        const jb = await rb.json();
        if (jb.ok) {
          fondos = (jb.data.bloqueos ?? [])
            .filter((b) => {
              // Los cierres del centro (sin persona) los ve todo el mundo:
              // afectan a todo el mundo.
              if (!b.teamMemberId) return true;
              // Si se está filtrando por profesional, manda el filtro.
              if (visibleTmIds) return visibleTmIds.includes(b.teamMemberId);
              /*
               * Y con «Todos» puesto, TODOS ven los de todos (14/08/2026,
               * Rodrigo).
               *
               * Aquí había un segundo filtro —cada cual los suyos— que ya no
               * está; el porqué se explica entero en el GET de
               * `/api/citas/bloqueos`. Lo que conviene recordar en este fichero
               * es la trampa: aquel filtro vivía SOLO en el navegador. El
               * servidor mandaba los bloqueos correctos y esta línea los tiraba
               * después, así que la pantalla y su propio endpoint decían cosas
               * distintas y ninguna prueba de API podía cazarlo. Si algún día
               * hay que volver a recortar quién ve qué, se recorta en el
               * endpoint.
               */
              return true;
            })
            .map((b) => ({
              id: `bloqueo-${b.id}`,
              /*
               * Motivo Y persona, siempre (14/08/2026, Rodrigo). Ahora que se
               * ven los de todo el equipo, un bloque que solo dijera
               * «Vacaciones» obliga a adivinar de quién es. Los cierres del
               * centro no tienen persona, y decirlo con todas las letras evita
               * leerlos como el bloqueo de alguien.
               */
              title: `${b.label} · ${b.teamMemberName || "Todo el centro"}`,
              start: b.startAt,
              end: b.endAt,
              /*
               * Negro con letra blanca (07/08/2026, Rodrigo): «para que quede
               * claro». En rosa claro se confundía con un hueco libre y alguien
               * ponía una cita encima sin darse cuenta.
               *
               * `block` y no `background`: los eventos de fondo de FullCalendar
               * NO pintan su título, así que no se leía de quién eran ni por
               * qué. Como bloque se ve la etiqueta y el nombre.
               *
               * El negro es ahora el DEFECTO, no una constante (10/08/2026): el
               * color sale de la ficha de la persona o del ajuste del centro, y
               * viene ya resuelto del servidor.
               */
              display: "block",
              backgroundColor: b.color || COLOR_BLOQUEO_POR_DEFECTO,
              borderColor: b.color || COLOR_BLOQUEO_POR_DEFECTO,
              // La letra se calcula contra el fondo elegido: en un color claro
              // el blanco de antes no se leería.
              textColor: colorTextoSobre(b.color || COLOR_BLOQUEO_POR_DEFECTO),
              // No se arrastra ni se cambia de hora tirando de él: se quita y
              // se vuelve a poner desde Tipos de cita.
              editable: false,
              extendedProps: { esBloqueo: true },
            }));
        }
      } catch { /* la agenda se ve igual, sin sombrear */ }

      success([...(j.data ?? []), ...fondos]);
    } catch (err) {
      failure(err);
    }
  }, [visibleEtIds, visibleTmIds]);

  useEffect(() => {
    calendarRef.current?.getApi().refetchEvents();
  }, [visibleEtIds, visibleTmIds]);

  /*
   * ── LOS DOS FILTROS SIGUEN LA MISMA REGLA, Y VIVE EN `MultiSelect` ─────────
   *
   * Elegir a una profesional deja SOLO sus citas (Rodrigo, 02/08/2026). Antes
   * funcionaba al revés: se partía de «todas visibles» y cada clic OCULTABA a
   * una, así que para ver la agenda de Araceli había que ir tachando a las
   * otras catorce, cada vez. Con quince profesionales eso no es un filtro, es
   * un castigo.
   *
   * El de TIPO se quedó con el comportamiento viejo, y ahí el castigo era peor:
   * 57 tipos, 56 clics. Unificados el 12/08/2026 (decisión de Jorge): el primer
   * clic aísla, los siguientes suman, y quedarse sin ninguno vuelve a «todos».
   *
   * Las cuatro funciones que había aquí —`toggleEventType`, `toggleTeamMember`
   * y sus dos `showAll…`— han desaparecido a propósito: la regla es ahora una
   * sola y está en `alternar()` de `components/ui/MultiSelect.jsx`, para que las
   * dos listas no puedan volver a divergir sin que nadie se entere. Aquí solo
   * quedan los setters, que reciben el valor ya calculado (`null` o lista).
   */

  async function handleEventClick(info) {
    // Los bloqueos de vacaciones son fondo, no citas: no hay ficha que abrir y
    // pedirla daría un 404. Se quitan desde Tipos de cita.
    if (info.event.extendedProps?.esBloqueo) return;
    const id = info.event.id;
    const res = await fetch(`/api/citas/bookings/${id}`, { cache: "no-store" });
    const j = await res.json();
    if (j.ok) {
      setOpenBooking(j.data);
      setDetailNotes(j.data.notes ?? "");
      setAvisoHora(null);
      setDetailFecha(fechaMadrid(j.data.scheduledAt));
      setDetailHora(horaMadrid(j.data.scheduledAt));
      setDetailMeet(j.data.meetUrl ?? "");
      setSuggestOpen(false); setSuggestions([]); // reset del panel de propuestas al abrir otra cita
      setFormError(null); // no arrastrar un error del drawer de creación / PATCH previo
    }
  }

  /*
   * Fecha y hora de una cita, EN HORA DE MADRID, para meterlas en los <input>.
   *
   * No se usa `toISOString().slice(...)`: eso da UTC, y en verano pintaría una
   * cita de las 10:00 como las 08:00. El CRM trabaja en hora de Madrid y la
   * tarjeta tiene que enseñar lo mismo que el calendario.
   */
  function fechaMadrid(iso) {
    const p = new Date(iso);
    if (Number.isNaN(p.getTime())) return "";
    const [d, m, y] = p.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" }).split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  function horaMadrid(iso) {
    const p = new Date(iso);
    if (Number.isNaN(p.getTime())) return "";
    return p.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  /*
   * Guardar la fecha y la hora tecleadas.
   *
   * Se manda un ISO CON OFFSET (…+02:00) construido con el desfase real de
   * Madrid en ESA fecha, no una cadena suelta: el servidor va en UTC y una
   * fecha sin zona se guardaría dos horas tarde — que es el fallo que ya se
   * comió las vacaciones el 07/08/2026.
   */
  async function guardarFechaHora() {
    if (!detailFecha || !detailHora) { setFormError("Pon la fecha y la hora"); return; }
    /*
     * El motivo viaja al correo del paciente (07/08/2026, Rodrigo). Sigue
     * siendo OPCIONAL —a veces solo hay que mover una cita y no hay nada que
     * explicar—: se cambia la hora igual con la caja vacía.
     *
     * Lo que sí cambia con el modal (12/08/2026): «Cancelar» ahora CANCELA. Con
     * el `prompt` del navegador, cancelar cambiaba la hora de todas formas, y
     * en una ventana con un botón que pone «Cancelar» eso no lo espera nadie.
     */
    const motivo = await pedirTexto({
      titulo: "Cambiar la hora de la cita",
      texto: "¿Por qué se cambia? Se lo contamos en el correo. Déjalo vacío si no quieres explicar nada.",
      etiqueta: "Motivo (opcional)",
      confirmar: "Cambiar la hora",
      multilinea: true,
    });
    if (motivo === null) return;
    const [y, m, d] = detailFecha.split("-").map(Number);
    const [hh, mm] = detailHora.split(":").map(Number);
    // El offset de Madrid en esa fecha, resuelto por el propio navegador.
    const tanteo = new Date(Date.UTC(y, m - 1, d, hh, mm));
    const enMadrid = new Date(tanteo.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
    const enUtc = new Date(tanteo.toLocaleString("en-US", { timeZone: "UTC" }));
    const offsetMin = Math.round((enMadrid - enUtc) / 60000);
    const instante = new Date(tanteo.getTime() - offsetMin * 60000);
    const res = await patchBooking({
      scheduledAt: instante.toISOString(),
      ...(motivo && motivo.trim() ? { motivoCambio: motivo.trim() } : {}),
    });
    // Si salió el correo se dice, y si no, POR QUÉ. Callarse es lo que hace que
    // alguien dé por avisado a un paciente que no lo está.
    setAvisoHora(mensajeDelAviso(res?.avisoCambioHora));
  }

  /** El aviso del cambio de hora, en cristiano. */
  function mensajeDelAviso(aviso) {
    if (!aviso) return null;
    if (aviso.enviado) return { tono: "ok", texto: "Hora cambiada y avisada por correo." };
    const porQue = {
      sin_email: "no tiene correo en su ficha",
      sin_consentimiento: "ha pedido no recibir correos",
      ya_pasada: "la cita ya había pasado",
      sin_configurar: "este cliente no tiene el correo configurado",
      error: "falló el envío",
    }[aviso.motivo] ?? "no se pudo enviar";
    return { tono: "warn", texto: `Hora cambiada, pero SIN avisar: ${porQue}. Díselo tú.` };
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
      // (se devuelve j.data al final para que quien llama pueda leer flags
      //  como `emailEnviado` del guardado del enlace de videollamada)
      // Refresca el globito de pendientes (arreglo 2026-07-23): cancelar/confirmar
      // una cita pendiente desde el calendario cambia el número de la lista de
      // espera; sin esto el contador quedaba desactualizado.
      loadPendingCount();
      return j.data;
    } catch (err) {
      setFormError(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function loadSuggestions(scope) {
    if (!openBooking) return;
    setSuggestOpen(true); setSuggestScope(scope); setSuggestLoading(true);
    setSuggestErr(null); setSuggestions([]); setSuggestNote(null); setSuggestSent(null);
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
  // Terapeuta no-admin: en vez de aplicar, MANDA la propuesta al centro (no es
  // definitivo hasta que el admin la aprueba).
  async function sendSuggestionToAdmin(s) {
    setSaving(true); setSuggestErr(null);
    try {
      const r = await fetch(`/api/citas/bookings/${openBooking.id}/reschedule-request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datetime: s.datetime, teamMemberId: s.teamMemberId || null, reason: s.reason || null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo enviar la propuesta");
      setSuggestions([]);
      setSuggestSent("Propuesta enviada al centro. Te avisaremos cuando la confirmen.");
    } catch (e) {
      setSuggestErr(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function markCompleted() { await patchBooking({ status: "completed" }); }
  /**
   * Falta: se pregunta si estaba JUSTIFICADA (punto 6.1 del sprint). No es lo
   * mismo un niño con fiebre que una familia que no aparece sin avisar; y solo
   * las NO justificadas avisan a administración.
   */
  async function markNoShow() {
    /*
     * Las dos respuestas, cada una con su frase. Antes esto era un `confirm`
     * con «Aceptar = justificada · Cancelar = sin justificar» dentro: dos
     * respuestas distintas metidas a la fuerza en un sí/no, donde además
     * cancelar no cancelaba nada — marcaba la falta como injustificada.
     */
    const respuesta = await elegir({
      titulo: "Marcar la falta",
      texto: "No es lo mismo un niño con fiebre que una familia que no aparece sin avisar: solo las faltas sin justificar avisan a administración.",
      opciones: [
        { valor: "justificada", label: "Estaba justificada", pista: "Avisaron, enfermedad, un imprevisto…" },
        { valor: "sin_justificar", label: "No avisaron", tono: "peligro" },
      ],
    });
    if (respuesta === null) return;
    const justificada = respuesta === "justificada";
    const motivo = await pedirTexto({
      titulo: justificada ? "Motivo de la falta" : "¿Qué ha pasado?",
      etiqueta: "Opcional",
      confirmar: "Marcar la falta",
      tono: justificada ? "normal" : "peligro",
    });
    if (motivo === null) return;
    await patchBooking({
      status: "no_show",
      noShowJustified: justificada,
      noShowReason: motivo.trim() || null,
    });
  }
  async function cancelBooking() {
    const reason = await pedirTexto({
      titulo: "Cancelar la cita",
      texto: "Se le avisará por correo si tiene consentimiento y correo en su ficha.",
      etiqueta: "Motivo (opcional)",
      confirmar: "Cancelar la cita",
      cancelar: "Volver",
      tono: "peligro",
    });
    if (reason === null) return;
    await patchBooking({ status: "cancelled", cancellationReason: reason.trim() || null });
  }
  async function saveNotes() { await patchBooking({ notes: detailNotes.trim() || null }); }
  /**
   * Guarda el enlace de videollamada. Con `enviar`, además manda el email al
   * cliente SIEMPRE (aunque el enlace ya estuviera puesto o se esté
   * corrigiendo): es el botón "Guardar y enviar".
   */
  async function saveMeet(enviar = false) {
    const url = detailMeet.trim() || null;
    const res = await patchBooking({ meetUrl: url, ...(enviar ? { enviarEmail: true } : {}) });
    if (enviar) {
      // `emailMotivo` dice POR QUÉ no salió. Antes solo había "enviado" o
      // "guardado", y "guardado" sugería una causa (cita no online, cancelada)
      // que casi nunca era la real.
      setMeetAviso(res?.emailEnviado ? "enviado" : (res?.emailMotivo ?? "guardado"));
      setTimeout(() => setMeetAviso(null), 8000);
    }
  }
  /**
   * Manda el aviso. Se guarda SIEMPRE (queda en el portal del cliente) aunque
   * el correo no salga, así que el resultado distingue las dos cosas: si solo
   * ha quedado publicado, hay que decirlo o ella creerá que le ha escrito.
   */
  async function enviarAviso() {
    if (!openBooking?.clientEmail) return;
    setEnviandoAviso(true);
    setAvisoResultado(null);
    try {
      const r = await fetch("/api/citas/avisos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: openBooking.clientEmail,
          clientId: openBooking.clientId ?? null,
          bookingId: openBooking.id,
          nombre: openBooking.clientName ?? null,
          titulo: avisoTitulo.trim(),
          cuerpo: avisoCuerpo.trim(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "No se pudo mandar el aviso");

      setAvisoAbierto(false);
      setAvisoTitulo("");
      setAvisoCuerpo("");
      setAvisoResultado(
        j.data?.enviadoPorCorreo
          ? { ok: true, texto: "✓ Aviso enviado por email y publicado en su área privada." }
          : {
              ok: false,
              texto:
                j.data?.correo === "sin_consentimiento"
                  ? "Aviso publicado en su área privada. Por email no se le manda: ha pedido no recibir correos."
                  : "Aviso publicado en su área privada, pero NO ha salido por email (falta configurar el correo en Configuración).",
            }
      );
    } catch (err) {
      setAvisoResultado({ ok: false, texto: err.message });
    } finally {
      setEnviandoAviso(false);
    }
  }

  async function assignTeamMember(v) { await patchBooking({ teamMemberId: v || null }); }
  async function assignPatient(v) { await patchBooking({ patientId: v || null }); }
  /**
   * Borrar la cita DE VERDAD (13/08/2026, Rodrigo: «se quedan canceladas pero
   * no desaparecen si le doy a eliminar»).
   *
   * «Eliminar» hacía lo mismo que «Cancelar cita» —la dejaba en gris en el
   * calendario—, así que una cita apuntada en el día equivocado, duplicada o de
   * una prueba se quedaba ahí para siempre. Ahora se va del todo (`?hard=true`).
   *
   * Se avisa de lo que no se ve: que al borrar NO sale ningún correo (cancelar
   * sí lo manda) y que la sesión de un bono vuelve a quedar libre. El error del
   * servidor se enseña con `avisar` y no en `formError`, que solo se pinta en el
   * alta: la negativa por tener dinero de por medio hay que poder leerla.
   */
  async function deleteBooking() {
    const futura = new Date(openBooking.scheduledAt).getTime() > Date.now();
    const letraPequena = [];
    if (futura && openBooking.status !== "cancelled") {
      letraPequena.push("Aún no ha pasado y al borrarla NO se avisa a nadie. Si quieres que se entere, cancélala antes.");
    }
    if (openBooking.sessionNumber > 0) {
      letraPequena.push(`Es la sesión ${openBooking.sessionNumber} de un bono: esa sesión le vuelve a quedar libre.`);
    }
    const seguro = await confirmar({
      titulo: "Borrar la cita",
      texto: ["Desaparece del calendario y del historial. No se puede deshacer.", ...letraPequena].join("\n\n"),
      confirmar: "Borrar",
      tono: "peligro",
    });
    if (!seguro) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/citas/bookings/${openBooking.id}?hard=true`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "No se ha podido borrar la cita");
      }
      setOpenBooking(null);
      calendarRef.current?.getApi().refetchEvents();
    } catch (err) {
      // Antes del aviso: `avisar` no resuelve hasta que lo cierran, y hasta
      // entonces la tarjeta de la cita se quedaría con todo deshabilitado.
      setSaving(false);
      await avisar({ titulo: "La cita sigue ahí", texto: err.message });
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

  /*
   * ── EL BONO PONE EL TIPO DE CITA (13/08/2026, Rodrigo) ────────────────────
   *
   * «Si tiene un bono asignado, cuando se pone el paciente en la cita manual
   * directamente el tipo de cita se pone con el bono, así no hay que ir a
   * buscarlo a la ficha.» Quien tiene un bono viene SIEMPRE a lo mismo, y con
   * 57 tipos de cita en la lista elegir el que no es se paga caro: la cita no
   * descuenta del bono y hay que rehacerla.
   *
   * Solo se pone solo si el campo está vacío. Si ya hay un tipo elegido y el del
   * bono es otro, no se pisa lo que ha escrito una persona: se ofrece.
   */
  function ponerTipoDelBono(eventTypeId) {
    updateCreateForm("eventTypeId", eventTypeId);
  }

  async function buscarBono(cliente) {
    setBonoAviso(null);
    if (!cliente?.id && !cliente?.email) return;
    try {
      const params = new URLSearchParams();
      if (cliente.id) params.set("clientId", cliente.id);
      if (cliente.email) params.set("email", cliente.email);
      const r = await fetch(`/api/citas/packs?${params.toString()}`, { cache: "no-store" });
      const j = await r.json();
      const bonos = j?.ok ? (j.data?.bonos ?? []) : [];
      if (!bonos.length) return;

      // Con varios bonos vivos no se adivina: se enseñan y elige la persona.
      if (bonos.length > 1) {
        setBonoAviso({
          tono: "aviso",
          eventTypeId: null,
          texto: `Tiene ${bonos.length} bonos activos (${bonos
            .map((b) => `«${b.nombre}», le quedan ${b.restantes}`)
            .join(" · ")}). Elige tú el tipo de cita.`,
        });
        return;
      }

      const bono = bonos[0];
      const yaHayOtroTipo = Boolean(createForm.eventTypeId) && createForm.eventTypeId !== bono.eventTypeId;
      if (!yaHayOtroTipo) ponerTipoDelBono(bono.eventTypeId);

      /*
       * ⚠️ El bono va atado al CORREO (ver `lib/citas/packs.js`): la cita se
       * engancha buscando el bono por el correo con el que se crea. Si el de la
       * ficha es otro —hay bonos dados al correo del portal—, la cita se crearía
       * con el tipo correcto y AUN ASÍ no descontaría. Es el fallo mudo de los
       * bonos, y aquí se puede decir a tiempo.
       */
      const correoCita = (cliente.email || createForm.clientEmail || "").trim().toLowerCase();
      const correoBono = (bono.correo || "").trim().toLowerCase();
      const cuenta = `le quedan ${bono.restantes} de ${bono.total}`;

      // Ficha sin correo y bono con él: se pone el del bono. Sin correo la cita
      // ni se puede crear, y ese es justo el que hace que descuente.
      const correoPuesto = Boolean(correoBono) && !correoCita;
      if (correoPuesto) setCreateForm((prev) => ({ ...prev, clientEmail: correoBono }));

      if (correoBono && correoCita && correoBono !== correoCita) {
        setBonoAviso({
          tono: "aviso",
          eventTypeId: bono.eventTypeId,
          ofrecer: yaHayOtroTipo,
          texto: `Su bono «${bono.nombre}» (${cuenta}) está a nombre de ${correoBono} y la cita va a ${correoCita}: así NO descontará del bono. Cambia el correo de la cita si quieres que cuente.`,
        });
        return;
      }

      let texto;
      if (!yaHayOtroTipo && correoPuesto) texto = `Tipo y correo puestos por su bono «${bono.nombre}»: ${cuenta}.`;
      else if (!yaHayOtroTipo) texto = `Tipo puesto por su bono «${bono.nombre}»: ${cuenta}.`;
      else if (correoPuesto) texto = `Correo puesto por su bono «${bono.nombre}»: ${cuenta}. El tipo elegido no es el del bono.`;
      else texto = `Tiene bono de «${bono.nombre}» y ${cuenta}, pero el tipo elegido es otro.`;

      setBonoAviso({
        tono: yaHayOtroTipo ? "aviso" : "bono",
        eventTypeId: bono.eventTypeId,
        ofrecer: yaHayOtroTipo,
        texto,
      });
    } catch {
      // Sin bonos que enseñar la cita se apunta igual: esto ayuda, no manda.
    }
  }

  /** Se rompe el enlace con la ficha → el bono deja de aplicar. */
  function olvidarBono() {
    if (bonoAviso?.eventTypeId && createForm.eventTypeId === bonoAviso.eventTypeId) {
      setCreateForm((prev) => ({ ...prev, eventTypeId: "", modality: "" }));
    }
    setBonoAviso(null);
  }

  // Abre "Nueva cita" con la fecha/hora ya puestas desde un clic en el
  // calendario. `iso` es la fecha ISO del hueco pulsado.
  function abrirCreacionEn(iso) {
    const d = iso ? new Date(iso) : null;
    const date = d && !Number.isNaN(d.getTime()) ? toDateInput(d) : "";
    const time = d && !Number.isNaN(d.getTime()) && iso.includes("T") ? toTimeInput(d) : "";
    setCreateForm({ ...EMPTY_BOOKING_FORM, date, time });
    setBonoAviso(null);
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
    if (info.event.extendedProps?.esBloqueo) { info.revert(); return; }
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
      await avisar({ titulo: "La cita no se ha movido", texto: err.message });
    }
  }

  async function submitCreate() {
    setFormError(null);
    if (!createForm.eventTypeId) { setFormError("Selecciona tipo de cita"); return; }
    if (!createForm.date || !createForm.time) { setFormError("Fecha y hora son obligatorias"); return; }
    if (!createForm.clientName.trim()) { setFormError("Nombre del cliente obligatorio"); return; }
    if (!createForm.clientEmail.trim()) { setFormError("Email del cliente obligatorio"); return; }
    if (!createForm.clientPhone.trim()) { setFormError("Teléfono del cliente obligatorio"); return; }
    // Solo si hay equipo del que elegir: sin módulo `team` el campo ni se pinta.
    if (teamMembers.length > 0 && !createForm.teamMemberId) {
      setFormError("Elige el profesional que la atiende");
      return;
    }
    if (!createForm.modality) { setFormError("Selecciona modalidad"); return; }

    setSaving(true);
    try {
      const scheduledAt = new Date(`${createForm.date}T${createForm.time}`).toISOString();
      const enviar = (insistir) =>
        fetch("/api/citas/bookings", {
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
            /*
             * Las DOS puertas que avisan pero no imponen: el festivo del centro
             * y el tramo de vacaciones (07/08/2026). Antes solo se reenviaba
             * `permitirFestivo`, así que al chocar con unas vacaciones el aviso
             * volvía a salir una y otra vez y la cita no se llegaba a crear.
             */
            ...(insistir ? { permitirFestivo: true, permitirBloqueo: true } : {}),
          }),
        });

      let res = await enviar(false);
      let j = await res.json();
      // 409 = el día está cerrado, o alguien está de vacaciones. No se impone:
      // se pregunta, y si insiste (una urgencia en el puente) se reenvía.
      if (res.status === 409 && !j.ok) {
        const crearIgualmente = await confirmar({
          titulo: "Ese hueco está bloqueado",
          texto: j.error,
          confirmar: "Crearla igualmente",
        });
        if (!crearIgualmente) {
          setSaving(false);
          return;
        }
        res = await enviar(true);
        j = await res.json();
      }
      if (!j.ok) throw new Error(j.error || "Error creando cita");
      /*
       * Si el paciente NO ha recibido el correo, se dice aquí y ahora
       * (07/08/2026, Rodrigo). Antes esta cita no mandaba ningún correo; ahora
       * lo manda, pero callarse cuando falla sería peor que no mandarlo: quien
       * la apunta se iría creyendo que el paciente ya lo sabe.
       *
       * Solo se avisa cuando NO sale. Si sale, no hay nada que contar.
       */
      if (j.data && j.data.emailEnviado === false) {
        const porQue = {
          sin_email: "no tiene correo en su ficha",
          sin_consentimiento: "ha pedido no recibir correos",
          sin_configurar: "este cliente no tiene el correo configurado",
          error: "falló el envío",
        }[j.data.emailMotivo] ?? "no se pudo enviar";
        await avisar({
          titulo: "Cita creada, pero sin avisar",
          texto: `Al paciente NO le ha llegado el correo: ${porQue}.\n\nAvísale tú.`,
        });
      }
      calendarRef.current?.getApi().refetchEvents();
      setOpenCreate(false);
      setCreateForm(EMPTY_BOOKING_FORM);
      setBonoAviso(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Los estilos de FullCalendar viven en app/globals.css (24/08/2026).
          Estaban aquí y en app/(dashboard)/calendario/page.jsx, copiados byte a
          byte y ya divergiendo en una regla. Al ser CSS global daba igual dónde
          se declararan, así que la copia que quedó es una. */}

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
          <Link
            href="/citas/bloqueos"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Bloqueos
          </Link>
          <button
            onClick={() => { setCreateForm(EMPTY_BOOKING_FORM); setBonoAviso(null); setOpenCreate(true); setFormError(null); }}
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
        {/* Fuera del botón: leer qué es no debe obligar a cambiar de pestaña. */}
        <HelpTooltip title="Lista de espera" placement="bottom">
          Citas que alguien ha pedido desde la web y esperan tu visto bueno. Si la cita tiene
          precio, aquí el paciente <strong className="text-white">ya tiene el dinero retenido en
          su tarjeta, pero todavía no se le ha cobrado</strong>: se le cobra al confirmar, y si la
          rechazas se le suelta.
          {" "}
          No la confundas con la lista de espera de admisión, en Clientes: esa es gente esperando
          plaza, sin fecha ni hora.
        </HelpTooltip>
        {viewerIsAdmin && (
          <button
            onClick={() => { setTab("requests"); loadChangeRequests(); }}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${
              tab === "requests" ? "bg-[var(--color-primary,#0F0F0F)] text-white" : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            Solicitudes
            {changeReqPending > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold ${
                tab === "requests" ? "bg-white/25 text-white" : "bg-red-500 text-white"
              }`}>
                {changeReqPending}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ─── Pestaña Lista de espera ─── */}
      {tab === "waitlist" && (
        <div className="flex-1 overflow-auto min-h-0">
          <Waitlist
            refreshKey={waitlistKey}
            esAdmin={viewerIsAdmin}
            onCountChange={setPendingCount}
            onActioned={() => { loadPendingCount(); calendarRef.current?.getApi().refetchEvents(); }}
          />
        </div>
      )}

      {/* ─── Pestaña Solicitudes de cambio (solo admin) ─── */}
      {tab === "requests" && viewerIsAdmin && (
        <div className="flex-1 overflow-auto min-h-0 px-6 lg:px-10 py-4">
          <p className="text-xs text-neutral-400 mb-4">
            Propuestas de cambio de cita que te mandan las terapeutas. Nada cambia hasta que apruebas.
          </p>
          {changeReqLoading ? (
            <p className="text-sm text-neutral-400">Cargando…</p>
          ) : changeRequests.length === 0 ? (
            <div className="text-center py-16 text-sm text-neutral-400">No hay solicitudes pendientes.</div>
          ) : (
            <ul className="space-y-3 max-w-3xl">
              {changeRequests.map((req) => (
                <li key={req.id} className="bg-white border border-neutral-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-[11px] text-neutral-400 mb-1.5">
                    <span className="font-medium text-neutral-600">{req.requestedByName || "Una terapeuta"}</span>
                    <span>propone mover:</span>
                  </div>
                  <div className="text-[14px] font-medium text-neutral-900">
                    {req.subjectName || "Paciente"}
                    {req.eventTypeName ? <span className="text-neutral-400 font-normal"> · {req.eventTypeName}</span> : null}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[13px] flex-wrap">
                    <span className="line-through text-neutral-400">{fmtDateTime(req.currentScheduledAt)}</span>
                    <span className="text-neutral-300">→</span>
                    <span className="font-semibold text-emerald-700">{fmtDateTime(req.proposedScheduledAt)}</span>
                    {req.proposedTeamMemberName && (
                      <span className="text-[12px] text-neutral-500">· {req.proposedTeamMemberName}</span>
                    )}
                  </div>
                  {req.reason && <div className="text-[12px] text-neutral-500 mt-1.5">Motivo: {req.reason}</div>}
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      onClick={() => resolveChangeRequest(req.id, "reject")}
                      disabled={changeReqBusyId === req.id}
                      className="text-[12px] px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                    <button
                      onClick={() => resolveChangeRequest(req.id, "approve")}
                      disabled={changeReqBusyId === req.id}
                      className="text-[12px] font-medium px-3 py-1.5 rounded-md text-white disabled:opacity-50"
                      style={{ backgroundColor: "var(--color-primary,#1B3A2D)" }}
                    >
                      {changeReqBusyId === req.id ? "…" : "Aprobar ✓"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/*
        Filtros de la agenda — una sola línea, dos desplegables (12/08/2026).
        Antes eran dos bandas de chips: en Aumenta, 74 botones en 10 filas y
        379 px de alto, más que los 335 px que le quedaban al calendario.
        El de profesional sigue siendo solo del jefe y solo si hay más de uno.
      */}
      {tab === "calendar" && eventTypes.length > 0 && (
        <div className="px-6 lg:px-10 py-2.5 flex items-center gap-x-5 gap-y-2 flex-wrap shrink-0 border-b border-neutral-100">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] uppercase tracking-wider text-neutral-400">Tipo</span>
            <div className="w-[190px]">
              <MultiSelect
                aria-label="Filtrar por tipo de cita"
                value={visibleEtIds}
                onChange={setVisibleEtIds}
                options={eventTypes.map((et) => ({
                  value: et.id,
                  label: et.name,
                  color: et.color ?? "#3F6E5B",
                }))}
                etiquetaTodos="Todos los tipos"
                resumen={(n) => `${n} tipos`}
                // Con 57 tipos, encontrar uno a ojo es el trabajo de verdad.
                searchable={eventTypes.length > 8}
              />
            </div>
          </div>

          {viewerIsAdmin && teamMembers.length > 1 && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] uppercase tracking-wider text-neutral-400">Profesional</span>
              <div className="w-[190px]">
                <MultiSelect
                  aria-label="Filtrar por profesional"
                  value={visibleTmIds}
                  onChange={setVisibleTmIds}
                  options={[
                    ...teamMembers.map((m) => ({
                      value: m.id,
                      label: m.displayName,
                      // El color casa con el de sus citas en el calendario.
                      color: m.avatarColor ?? COLOR_CITA_POR_DEFECTO,
                    })),
                    /*
                     * «Sin asignar», una más de la lista (25/08/2026, Rodrigo).
                     *
                     * Hasta hoy las citas sin profesional se colaban SIEMPRE al
                     * filtrar por una persona, sin manera de apagarlas: 70 de
                     * las 103 que veía en pantalla. Ahora no salen salvo que se
                     * pidan, y se piden aquí. Repartirlas sigue siendo trabajo
                     * de «Citas → Sin profesional», que es donde viven.
                     */
                    { value: SIN_PROFESIONAL, label: "Sin asignar", color: COLOR_CITA_POR_DEFECTO },
                  ]}
                  etiquetaTodos="Todos"
                  resumen={(n) => `${n} profesionales`}
                  searchable={teamMembers.length > 8}
                />
              </div>
            </div>
          )}

          {/* Y si no es admin, su nombre fijo en el mismo sitio: no se elige
              porque no hay nada que elegir, ve su agenda y solo su agenda. */}
          {!viewerIsAdmin && miFichaDeEquipo && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] uppercase tracking-wider text-neutral-400">Profesional</span>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-neutral-600 bg-neutral-50 border border-neutral-200"
                title="Ves tu agenda. Para ver la de otra persona hace falta dirección."
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: miFichaDeEquipo.avatarColor ?? "#3F6E5B" }}
                />
                {miFichaDeEquipo.displayName}
                <span className="text-neutral-400">· solo tus citas</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/*
        Calendario.

        ⚠️ SIN SCROLL EN LA PÁGINA (12/08/2026, Rodrigo). Antes el alto de
        FullCalendar era una resta a ojo sobre el alto de la ventana
        (`calc(100vh - 280px)`) y la fila de ayuda de arriba no entraba en la
        cuenta: sobraban unos pocos píxeles y la pantalla entera se movía. Ahora
        el calendario RELLENA lo que quede (`flex-1 min-h-0` + `height="100%"`),
        que es una medida real y no una estimación: cambie lo que cambie encima,
        no puede desbordar.
      */}
      {tab === "calendar" && (
        <div className="flex-1 min-h-0 flex flex-col px-6 lg:px-10 pt-3 pb-4">
          <p className="text-[11px] text-neutral-400 mb-2 lg:hidden shrink-0">
            Toca una cita para ver su ficha. Para crear o mover citas, mejor desde el ordenador.
          </p>
          {/* Festivos y cierres del centro. Solo admin: cerrar un día afecta a
              la agenda de todo el equipo y a la reserva pública. */}
          {viewerIsAdmin && (
            <div className="flex items-center gap-2 mb-2 flex-wrap shrink-0">
              <button
                type="button"
                onClick={() => setFestivosAbierto(true)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Festivos y cierres
              </button>
              {festivos.size > 0 && (
                <span className="text-[11px] text-neutral-400">
                  {festivos.size} día(s) cerrado(s) en la vista actual
                </span>
              )}
            </div>
          )}
          <div className="flex-1 min-h-0">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView={esMovil && calView.view === "timeGridWeek" ? "listWeek" : calView.view}
            initialDate={calView.date || undefined}
            datesSet={(arg) => {
              calViewRef.current = { view: arg.view.type, date: arg.startStr };
              cargarFestivos(arg.startStr.slice(0, 10), arg.endStr.slice(0, 10));
            }}
            // Los festivos se pintan atenuados y con la etiqueta del cierre.
            dayCellClassNames={(arg) => (festivos.has(ymdLocal(arg.date)) ? ["dia-festivo"] : [])}
            dayCellContent={(arg) => {
              const clave = ymdLocal(arg.date);
              const f = festivos.get(clave);
              // `true` = que FullCalendar pinte el número del día como siempre.
              // Devolver `undefined` NO cae al render por defecto: deja la celda vacía.
              if (!f) return true;
              return (
                <div className="flex flex-col items-end">
                  <span>{arg.dayNumberText}</span>
                  <span className="text-[9px] leading-tight text-rose-600 font-semibold truncate max-w-[90px]">
                    {f.label || "Cerrado"}
                  </span>
                </div>
              );
            }}
            headerToolbar={
              esMovil
                ? { left: "prev,next", center: "title", right: "listWeek,timeGridDay" }
                : { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }
            }
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
            /*
             * Tope de citas por día en la vista de MES (12/08/2026, Rodrigo).
             * Sin esto, un martes con doce citas estira su fila y encoge las
             * demás: el mes deja de leerse como una rejilla. A partir de la
             * cuarta, FullCalendar pone un «+N más» que abre el día entero.
             * Solo afecta a dayGrid; semana y día siguen enseñándolo todo.
             */
            dayMaxEvents={4}
            moreLinkText={(n) => `+${n} más`}
            height="100%"
            buttonText={{ today: "Hoy", month: "Mes", week: "Semana", day: "Día", list: "Lista" }}
          />
          </div>
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
                  <PagoChip
                    estado={openBooking.paymentStatus}
                    motivoCancelacion={openBooking.cancellationReason}
                    amount={openBooking.amount}
                    caducaEn={openBooking.authorizationExpiresAt}
                  />
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
                {/* Qué implica el estado del cobro para lo que ella va a hacer.
                    Enseñar solo la etiqueta obligaría a saberse las reglas de
                    memoria; lo que necesita es la consecuencia. */}
                {openBooking.paymentStatus === "pending" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      Todavía sin pagar. Si no completa el pago, el hueco se libera solo.
                    </span>
                  </div>
                )}
                {openBooking.paymentStatus === "authorizing" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      Está introduciendo su tarjeta ahora mismo. Si lo deja a medias, el hueco se
                      libera solo.
                    </span>
                  </div>
                )}
                {openBooking.paymentStatus === "authorized" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      El importe está <b className="text-neutral-700">reservado</b> en su tarjeta,
                      pero <b className="text-neutral-700">todavía no cobrado</b>. Se le cobrará en
                      cuanto confirmes la cita.
                      {openBooking.authorizationExpiresAt && (
                        <>
                          {" "}
                          La reserva {cuantoQuedaDeRetencion(openBooking.authorizationExpiresAt)?.texto};
                          después habría que pedirle la tarjeta otra vez.
                        </>
                      )}
                    </span>
                  </div>
                )}
                {openBooking.paymentStatus === "capturing" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">Cobrándose ahora mismo…</span>
                  </div>
                )}
                {openBooking.paymentStatus === "paid" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      Cobrada. Si la cancelas tú, se le devuelve el importe íntegro.
                    </span>
                  </div>
                )}
                {openBooking.paymentStatus === "refunded" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">Importe ya devuelto al paciente.</span>
                  </div>
                )}
                {openBooking.paymentStatus === "void" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      No hay nada reservado en su tarjeta: se liberó o caducó.{" "}
                      <b className="text-neutral-700">No se le ha cobrado nada.</b> Puedes confirmar
                      la cita igualmente y cobrarle en consulta.
                    </span>
                  </div>
                )}
                {openBooking.paymentStatus === "failed" && (
                  <div className="flex">
                    <span className="w-24 text-neutral-400">Cobro</span>
                    <span className="text-neutral-500">
                      {/* Dos historias distintas bajo el mismo 'failed'. El motivo real
                          ya está escrito en la cita; si no lo reconocemos, texto neutro:
                          al banco no se le culpa por defecto. */}
                      {pagoQuedoSinCompletar(openBooking.cancellationReason)
                        ? "No llegó a completar el pago (no es que se lo rechazara el banco), así que "
                        : "El cobro no se completó y "}
                      <b className="text-neutral-700">no se le ha cobrado nada</b>. Puedes
                      reintentarlo, pedirle otra tarjeta o confirmar y cobrar en consulta.
                    </span>
                  </div>
                )}
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
                  <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
                    <span
                      className={`text-[11px] ${
                        meetAviso && meetAviso !== "enviado" ? "text-amber-700" : "text-neutral-400"
                      }`}
                    >
                      {meetAviso === "enviado"
                        ? "✓ Enlace enviado por email al cliente."
                        : meetAviso === "sin_configurar"
                          ? "Enlace guardado, pero NO se ha enviado: falta configurar el correo en Configuración → Correo. Mándaselo tú mientras tanto."
                          : meetAviso === "sin_consentimiento"
                            ? "Enlace guardado. No se envía porque este cliente ha pedido no recibir avisos por email."
                            : meetAviso === "error"
                              ? "Enlace guardado, pero el envío del email ha fallado. Mándaselo tú y avisa a soporte."
                              : meetAviso === "guardado"
                                ? "Enlace guardado (no se envió: revisa que la cita sea online y no esté cancelada)."
                                : "«Guardar y enviar» manda el enlace por email, aunque ya lo hubieras guardado antes."}
                    </span>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => saveMeet(false)}
                        disabled={saving || detailMeet.trim() === (openBooking.meetUrl ?? "")}
                        className="text-[11px] px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => saveMeet(true)}
                        disabled={saving || !detailMeet.trim()}
                        className="text-[11px] px-2.5 py-1 rounded font-semibold text-white disabled:opacity-50"
                        style={{ background: "var(--color-primary, #1B3A2D)" }}
                      >
                        Guardar y enviar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Avisar al cliente ────────────────────────────────────────
                  Para todo lo que no es un cambio de la cita: «tráete los
                  análisis», «cierro en agosto», «te llamo mañana». Sale por
                  correo Y queda publicado en su área privada, que es donde
                  puede volver a mirarlo en enero. */}
              {openBooking.clientEmail && (
                <div className="pt-3 border-t border-neutral-100">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-[11px] uppercase tracking-wider text-neutral-400">
                      Avisar al cliente
                    </div>
                    {!avisoAbierto && (
                      <button
                        onClick={() => { setAvisoAbierto(true); setAvisoResultado(null); }}
                        className="text-[11px] px-2.5 py-1 rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                      >
                        Escribir un aviso
                      </button>
                    )}
                  </div>

                  {avisoResultado && (
                    <div
                      className={`mt-2 text-[11px] ${
                        avisoResultado.ok ? "text-emerald-700" : "text-amber-700"
                      }`}
                    >
                      {avisoResultado.texto}
                    </div>
                  )}

                  {avisoAbierto && (
                    <div className="mt-2 space-y-2">
                      <input
                        value={avisoTitulo}
                        onChange={(e) => setAvisoTitulo(e.target.value)}
                        placeholder="Asunto (p. ej. «Trae los análisis a la próxima»)"
                        maxLength={160}
                        className={inputCls}
                      />
                      <textarea
                        value={avisoCuerpo}
                        onChange={(e) => setAvisoCuerpo(e.target.value)}
                        placeholder="Lo que quieras contarle. Lo verá en su área privada y le llegará por email."
                        maxLength={4000}
                        className={`${inputCls} min-h-[80px]`}
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => { setAvisoAbierto(false); setAvisoTitulo(""); setAvisoCuerpo(""); }}
                          className="text-[11px] px-2.5 py-1 rounded border border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={enviarAviso}
                          disabled={enviandoAviso || !avisoTitulo.trim() || !avisoCuerpo.trim()}
                          className="text-[11px] px-2.5 py-1 rounded font-semibold text-white disabled:opacity-50"
                          style={{ background: "var(--color-primary, #1B3A2D)" }}
                        >
                          {enviandoAviso ? "Enviando…" : "Enviar aviso"}
                        </button>
                      </div>
                    </div>
                  )}
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

              {/* Respuestas del formulario del tipo de cita (04/08/2026). Se
                  enseña el ENUNCIADO guardado con la respuesta, no el de la
                  pregunta actual: si la profesional reformuló la pregunta
                  después, lo que se leyó ese día fue lo otro. */}
              {Array.isArray(openBooking.formAnswers?.respuestas) &&
                openBooking.formAnswers.respuestas.length > 0 && (
                  <div className="pt-3 border-t border-neutral-100">
                    <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1.5">
                      Antes de la cita
                    </div>
                    <div className="space-y-2">
                      {openBooking.formAnswers.respuestas.map((r) => (
                        <div key={r.id}>
                          <div className="text-[11px] text-neutral-500">{r.label}</div>
                          <div className="text-[13px] text-neutral-800 whitespace-pre-wrap">
                            {r.valor === "" || r.valor == null ? "—" : String(r.valor)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Bono de sesiones: por dónde va esta persona. */}
              {openBooking.sessionNumber > 0 && (
                <div className="pt-3 border-t border-neutral-100">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Bono</div>
                  <div className="text-[13px] text-neutral-800">
                    Sesión {openBooking.sessionNumber}
                    {Number(openBooking.eventType?.sessionsCount) > 1
                      ? ` de ${openBooking.eventType.sessionsCount}`
                      : ""}
                  </div>
                </div>
              )}

              {/*
                Fecha y hora a mano (07/08/2026, Rodrigo): «me gustaría poder
                editar la hora exacta y fecha de una cita en su card, no solo
                poder moverlas físicamente en el calendario».

                Arrastrar sirve para correr media hora dentro de la semana que
                se está viendo; para pasarla a otro mes hay que ir buscándola, y
                para dejarla a las 10:05 no hay forma. Es el mismo guardado que
                el arrastre, así que respeta igual los solapes y los bloqueos.
              */}
              <div className="pt-3 border-t border-neutral-100">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1.5">Fecha y hora</div>
                <div className="flex gap-2 items-center flex-wrap">
                  <input
                    type="date"
                    value={detailFecha}
                    onChange={(e) => setDetailFecha(e.target.value)}
                    className={`${inputCls} flex-1 min-w-[9rem]`}
                  />
                  <input
                    type="time"
                    value={detailHora}
                    onChange={(e) => setDetailHora(e.target.value)}
                    className={`${inputCls} w-28`}
                  />
                  <button
                    onClick={guardarFechaHora}
                    disabled={
                      saving ||
                      (detailFecha === fechaMadrid(openBooking.scheduledAt) &&
                        detailHora === horaMadrid(openBooking.scheduledAt))
                    }
                    className="text-[11px] px-2.5 py-1.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 shrink-0"
                  >
                    {saving ? "Guardando…" : "Cambiar hora"}
                  </button>
                </div>
                <p className="text-[10px] text-neutral-400 mt-1">Hora de Madrid, como en el calendario.</p>
                {avisoHora && (
                  <p className={`text-[11px] mt-1 ${avisoHora.tono === "ok" ? "text-emerald-700" : "text-amber-700"}`}>
                    {avisoHora.texto}
                  </p>
                )}
              </div>

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
                    {viewerIsAdmin && (
                      <button onClick={() => loadSuggestions("company")}
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${suggestScope === "company" ? "border-transparent text-white" : "border-neutral-200 text-neutral-500 hover:bg-white"}`}
                        style={suggestScope === "company" ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>Todo el centro</button>
                    )}
                    <button onClick={() => setSuggestOpen(false)} className="text-neutral-400 hover:text-neutral-700 px-1" aria-label="Cerrar">✕</button>
                  </div>
                </div>
                {!viewerIsAdmin && (
                  <p className="text-[11px] text-neutral-400 mb-2">Elige un horario y se lo mandas al centro para que lo confirme.</p>
                )}
                {suggestLoading ? (
                  <p className="text-[12px] text-neutral-400 py-2">Buscando huecos…</p>
                ) : suggestErr ? (
                  <p className="text-[12px] text-rose-600 py-2">{suggestErr}</p>
                ) : suggestSent ? (
                  <p className="text-[12px] text-emerald-600 py-2">✓ {suggestSent}</p>
                ) : suggestions.length === 0 ? (
                  <p className="text-[12px] text-neutral-400 py-2">{suggestNote || "Sin huecos que proponer."}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {suggestions.map((s, i) => (
                      <div key={i} className="bg-white border border-neutral-200 rounded-lg p-2.5 flex flex-col">
                        <div className="text-[12px] font-medium text-neutral-800 capitalize">{s.label}</div>
                        {s.teamMemberName && <div className="text-[11px] text-neutral-500">{s.teamMemberName}</div>}
                        <div className="text-[10px] text-neutral-400 mt-1 flex-1 leading-snug">{s.reason}</div>
                        {viewerIsAdmin ? (
                          <button onClick={() => applySuggestion(s)} disabled={saving} className="mt-2 text-[11px] font-medium px-2 py-1 rounded-md text-white disabled:opacity-50" style={{ backgroundColor: "var(--color-primary,#1B3A2D)" }}>Elegir esta</button>
                        ) : (
                          <button onClick={() => sendSuggestionToAdmin(s)} disabled={saving} className="mt-2 text-[11px] font-medium px-2 py-1 rounded-md text-white disabled:opacity-50" style={{ backgroundColor: "var(--color-primary,#1B3A2D)" }}>Enviar al centro</button>
                        )}
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
                {openBooking.status === "no_show" && (
                  <span className={`text-[12px] px-2.5 py-1.5 rounded-md ${openBooking.noShowJustified ? "bg-neutral-100 text-neutral-600" : "bg-red-50 text-red-700"}`}>
                    {openBooking.noShowJustified ? "Falta justificada" : "Falta sin justificar"}
                    {openBooking.noShowReason ? ` · ${openBooking.noShowReason}` : ""}
                  </span>
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
                title="La quita del calendario y del historial. No se puede deshacer y no se avisa a nadie."
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

              {/*
                PRIMERO QUIÉN, DESPUÉS QUÉ (13/08/2026, Rodrigo: «poner en la
                cita manual primero el paciente y segundo el tipo de cita»). El
                formulario empezaba por el tipo, que es el campo que más se
                falla —Aumenta tiene 57— y el único que la ficha de la persona
                puede rellenar sola: eligiéndola antes, su bono pone el tipo (ver
                `buscarBono`) y su terapeuta pone el profesional.
              */}
              <BuscadorPaciente
                etiqueta={patients.length > 0 ? "Cliente (la familia) *" : "Cliente / paciente *"}
                nombre={createForm.clientName}
                vinculadaA={createForm.clientId}
                onEscribir={(texto) => {
                  olvidarBono();
                  setCreateForm((prev) => ({ ...prev, clientName: texto, clientId: "" }));
                }}
                onElegir={(c) => {
                  setCreateForm((prev) => ({
                    ...prev,
                    clientId: c.id,
                    clientName: c.name || "",
                    clientEmail: c.email || prev.clientEmail,
                    clientPhone: c.phone || prev.clientPhone,
                  }));
                  buscarBono(c);
                }}
                onDesvincular={() => {
                  olvidarBono();
                  setCreateForm((prev) => ({ ...prev, clientId: "" }));
                }}
              />

              {/*
                «Cliente» arriba y «Paciente» aquí NO son lo mismo, y leídos
                seguidos lo parecían (12/08/2026, Rodrigo). En un centro clínico
                el cliente es la familia que paga y el paciente es el hijo que
                viene a la sesión, así que cada campo dice de quién habla. Donde
                no hay módulo de pacientes esta caja ni aparece, y entonces el
                cliente ES el paciente — por eso el rótulo de arriba cambia.
              */}
              {patients.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Paciente</label>
                  <Select
                    value={createForm.patientId}
                    onChange={(v) => updateCreateForm("patientId", v)}
                    options={patientOptions}
                    placeholder="Sin paciente asignado"
                    searchable
                  />
                  <p className="text-[10px] text-neutral-400 mt-1">
                    Quién viene a la sesión. Si la familia tiene varios, elige de quién es la cita.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Tipo de cita *</label>
                <Select
                  value={createForm.eventTypeId}
                  onChange={(v) => {
                    // Cambiarlo a mano deja sin sentido el cartel del bono.
                    if (bonoAviso?.eventTypeId && v !== bonoAviso.eventTypeId) setBonoAviso(null);
                    updateCreateForm("eventTypeId", v);
                  }}
                  options={[
                    { value: "", label: "— Selecciona —", pinned: true },
                    ...eventTypes.map((e) => ({ value: e.id, label: `${e.name} (${e.duration} min)` })),
                  ]}
                  className={inputCls}
                  /*
                   * SIEMPRE, no a partir de N tipos (12/08/2026, Rodrigo).
                   * Aumenta tiene 57 y encontrar el que toca bajando por la
                   * lista es el trabajo de verdad. Se probó con el umbral del
                   * filtro del calendario (`> 8`) y se descartó: quien apunta
                   * citas todo el día escribe siempre las primeras letras, y
                   * que la caja aparezca o no según el cliente convierte un
                   * gesto automático en algo que hay que mirar antes.
                   */
                  searchable
                />
                {bonoAviso && (
                  <div
                    className={`mt-1.5 text-[11px] leading-snug rounded-md px-2.5 py-1.5 border ${
                      bonoAviso.tono === "aviso"
                        ? "text-amber-800 bg-amber-50 border-amber-100"
                        : "text-emerald-800 bg-emerald-50 border-emerald-100"
                    }`}
                  >
                    {bonoAviso.texto}
                    {bonoAviso.ofrecer && (
                      <button
                        type="button"
                        onClick={() => ponerTipoDelBono(bonoAviso.eventTypeId)}
                        className="ml-1.5 underline underline-offset-2 font-medium"
                      >
                        Poner el del bono
                      </button>
                    )}
                  </div>
                )}
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

              {/*
                El profesional es OBLIGATORIO desde el 12/08/2026 (Rodrigo). Se
                podía apuntar una cita sin nadie que la atendiera, y esas citas
                acaban en la cola de `/citas/sin-profesional`: 1.827 de las
                12.030 que importó Aumenta vinieron así. Solo se exige si hay
                equipo del que elegir — un tenant sin módulo `team` no ve el
                campo y no puede quedarse bloqueado por él.
              */}
              {teamMembers.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Profesional *</label>
                  <Select
                    value={createForm.teamMemberId}
                    onChange={(v) => updateCreateForm("teamMemberId", v)}
                    options={[
                      { value: "", label: "— Selecciona —", pinned: true },
                      ...teamMembers.map((m) => ({ value: m.id, label: m.displayName })),
                    ]}
                    placeholder="— Selecciona —"
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

      {/* Festivos y cierres, en una pantalla del CRM y no en una cadena de
          ventanas del navegador (12/08/2026, Rodrigo). */}
      {festivosAbierto && (
        <ModalFestivos
          onCerrar={() => setFestivosAbierto(false)}
          onCambio={recargarFestivosDeLaVista}
        />
      )}

      {/* Las preguntas y avisos sueltos (cancelar, falta, borrar…). */}
      {dialogo}
    </div>
  );
}

// ─── Lista de espera ────────────────────────────────────────────────────────
// Las reservas en estado 'pending': solicitudes de la web que la persona ya
// eligió con fecha y hora y esperan que se confirmen o rechacen.
function Waitlist({ refreshKey, esAdmin, onCountChange, onActioned }) {
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

  /**
   * Confirmar. Cuando la cita tiene dinero retenido, esto ADEMÁS lo cobra, y si
   * el cobro no sale la cita NO se confirma: el servidor responde 409 con el
   * motivo. Se le enseña ese motivo tal cual —es una frase escrita para ella— en
   * vez de un "error al confirmar" que no dice nada.
   *
   * `sinCobrar` es la salida para cuando la reserva de la tarjeta ha caducado:
   * hay una persona real esperando y lo correcto no es rechazarla, es aceptarla
   * y cobrarle en consulta.
   */
  async function confirm(id, { sinCobrar = false } = {}) {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/citas/bookings/${id}/confirm`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sinCobrar ? { sinCobrar: true } : {}),
      });
      const j = await r.json();
      if (!j.ok) { setError(j.error || "Error al confirmar"); return; }
      onActioned?.();
      load();
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Pedirle al paciente que vuelva a poner una tarjeta.
   *
   * Se le dice a la profesional si el correo salió DE VERDAD: dar esto por hecho
   * cuando el envío ha fallado la deja esperando una respuesta que nadie va a
   * dar. Si no salió, se le ofrece el enlace para mandarlo por donde pueda.
   */
  async function pedirTarjeta(id) {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/citas/bookings/${id}/pedir-tarjeta`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) { setError(j.error || "No se pudo pedir la tarjeta"); return; }
      if (j.data?.correoEnviado === false) {
        setError(
          `Retención preparada, pero el correo NO salió. Pásale este enlace: ${j.data.enlace}`
        );
      }
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
                  {/* Sin esto, una solicitud cobrada y otra sin pagar se veían
                      idénticas aquí, y se podía confirmar la que nadie ha pagado. */}
                  <PagoChip
                    estado={b.paymentStatus}
                    motivoCancelacion={b.cancellationReason}
                    amount={b.amount}
                    caducaEn={b.authorizationExpiresAt}
                  />
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
                    {/* El botón dice lo que va a pasar. "Confirmar" a secas,
                        cuando además cobra 45 €, es información que se le
                        oculta justo en el momento en que la necesita.

                        Y mientras el paciente teclea su tarjeta NO se puede
                        confirmar: el servidor lo rechaza, pero un botón activo
                        que devuelve un error es una trampa. Se apaga y se dice
                        por qué. */}
                    {/* Apuntar, rechazar y CONFIRMAR: cualquiera del equipo
                        desde el 06/08/2026. Confirmar se abrió después que los
                        otros dos, con Rodrigo revisándolo, porque puede cobrar
                        la tarjeta retenida. */}
                    <button
                      onClick={() => confirm(b.id)}
                      disabled={busyId === b.id || b.paymentStatus === "authorizing"}
                      title={b.paymentStatus === "authorizing" ? "Está introduciendo su tarjeta ahora mismo" : undefined}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-md transition-colors disabled:opacity-50"
                    >
                      {busyId === b.id
                        ? "…"
                        : b.paymentStatus === "authorizing"
                          ? "Esperando su tarjeta…"
                          : b.paymentStatus === "authorized" && Number.isInteger(b.amount)
                            ? `Confirmar y cobrar ${formatMoney(b.amount)}`
                            : "Confirmar"}
                    </button>

                    {/* Sin dinero reservado (caducó, lo soltaron o el banco lo
                        rechazó) queda una persona real esperando. La salida no
                        es rechazarla: es aceptarla y cobrarle en consulta. */}
                    {(b.paymentStatus === "void" || b.paymentStatus === "failed") && (
                      <>
                        {/* Esta sí sigue siendo de admin: manda a la paciente
                            un correo con un enlace de pago, y no se pidió
                            abrirla. Quien no lo sea tiene al lado la salida
                            buena para este caso —confirmar sin cobrar y cobrar
                            en consulta—, así que no se queda atascado. */}
                        {esAdmin && (
                          <button
                            onClick={() => pedirTarjeta(b.id)}
                            disabled={busyId === b.id}
                            className="bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 text-xs font-medium py-2 rounded-md transition-colors disabled:opacity-50"
                            title="Le enviamos un correo con un enlace para que meta otra tarjeta. La cita se le guarda mientras tanto."
                          >
                            Pedirle otra tarjeta
                          </button>
                        )}
                        <button
                          onClick={() => confirm(b.id, { sinCobrar: true })}
                          disabled={busyId === b.id}
                          className="bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 text-xs font-medium py-2 rounded-md transition-colors disabled:opacity-50"
                          title="La cita queda confirmada sin cobrar nada online. Le cobras en consulta."
                        >
                          Confirmar sin cobrar
                        </button>
                      </>
                    )}

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
