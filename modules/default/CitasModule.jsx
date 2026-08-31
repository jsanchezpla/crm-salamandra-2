"use client";

/**
 * CitasModule (default) — agenda "vanilla" usada por tenants sin override.
 * El wrapper `app/(dashboard)/citas/page.jsx` decide entre este componente
 * y el override según `x-tenant` del request.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import HelpTooltip from "../../components/ui/HelpTooltip.jsx";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import MultiSelect from "@/components/ui/MultiSelect.jsx";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import ModalFestivos from "@/components/citas/ModalFestivos.jsx";
import { COLOR_BLOQUEO_POR_DEFECTO, colorTextoSobre } from "@/lib/citas/coloresBloqueo.js";
import { SIN_PROFESIONAL, COLOR_CITA_POR_DEFECTO } from "@/lib/citas/filtros.js";
import { fmtDateTime, toDateInput, toTimeInput } from "./citas/chips.jsx";
import { CitaDetalleModal } from "./citas/CitaDetalleModal.jsx";
import { CitaMenuContextual } from "./citas/CitaMenuContextual.jsx";
import { destinoDePegado, sePuedeMover } from "@/lib/citas/pegarCita.js";
import { fichaDeLaCita } from "@/lib/citas/fichaDeLaCita.js";
import { NuevaCitaDrawer } from "./citas/NuevaCitaDrawer.jsx";
import { Waitlist } from "./citas/Waitlist.jsx";
import MiniMeses from "./citas/MiniMeses.jsx";

/**
 * `conClientes` y `vocabulario` los resuelve la página (servidor): son para el
 * botón que lleva de una cita a la ficha. Ver `lib/citas/fichaDeLaCita.js`.
 */
export default function CitasModule({ conClientes = false, vocabulario = undefined }) {
  const calendarRef = useRef(null);
  const router = useRouter();
  // Menú contextual de una cita (clic derecho sobre la caja): { x, y, titulo,
  // cita: { id, startStr, props } } o null. Y el portapapeles de cortar/copiar:
  // { modo: "cortar" | "copiar", cita } — el siguiente clic sobre el
  // calendario pega (lib/citas/pegarCita.js).
  const [menuCita, setMenuCita] = useState(null);
  const [portapapeles, setPortapapeles] = useState(null);
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

  /*
   * La columna de meses «tipo Organízate» (31/08/2026, Rodrigo): dos meses en
   * miniatura a la izquierda para saltar a un día de un clic. En Organízate
   * está siempre; aquí se abre con el botón «Meses» de la botonera y se
   * cierra para recuperar el calendario a todo lo ancho. Se queda como se
   * dejó (localStorage): quien venía de Organízate la querrá siempre puesta.
   * Arranca cerrada y el guardado se lee tras montar, que es como se evita
   * que el HTML del servidor y el del navegador digan cosas distintas.
   */
  const [mesesAbiertos, setMesesAbiertos] = useState(false);
  useEffect(() => {
    try { setMesesAbiertos(localStorage.getItem("citas.miniMeses") === "1"); } catch { /* sin memoria, arranca cerrada */ }
  }, []);
  // Lo que enseña el calendario grande, en milisegundos, para que la columna
  // marque esos días y pinte el mes que se está mirando (datesSet lo rellena).
  const [vistaRango, setVistaRango] = useState(null);
  // Al abrir o cerrar la columna cambia el ancho disponible sin que cambie la
  // ventana, y FullCalendar solo se re-mide solo con la ventana: se le pide.
  useEffect(() => {
    calendarRef.current?.getApi()?.updateSize();
  }, [mesesAbiertos]);
  const [eventTypes, setEventTypes] = useState([]);
  const [visibleEtIds, setVisibleEtIds] = useState(null); // null = todos
  const [openBooking, setOpenBooking] = useState(null); // booking abierto en modal detalle
  // Drawer de "Nueva cita": null = cerrado; { date, time } = abierto con ese hueco.
  const [creacion, setCreacion] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  /*
   * ¿Ve la agenda de TODO el centro? (26/08/2026)
   *
   * NO es lo mismo que ser dirección, y confundirlo es lo que dejó a las
   * quince terapeutas de Aumenta sin filtro por profesional: con la agenda
   * compartida encendida ven las citas de las dieciocho personas del centro
   * —eso ya lo decide el servidor— y no tenían nada con que separarlas.
   *
   * Lo contesta /api/auth/me con la MISMA función que filtra en el servidor
   * (lib/citas/visibilidad.js), así que pantalla y servidor no pueden decir
   * cosas distintas. Arranca en false: hasta saberlo, no se promete de más.
   */
  const [veTodaLaAgenda, setVeTodaLaAgenda] = useState(false);
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
        setVeTodaLaAgenda(j?.data?.veTodaLaAgenda === true);
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

  /*
   * Aquí se montaban las opciones del desplegable de paciente a partir de los
   * 300 que cabían. Ya no: el alta pregunta al servidor según se escribe
   * (`components/citas/SelectorPaciente.jsx`). `patients` se queda solo como
   * puerta del módulo —si el endpoint contesta 403 llega vacío y la caja ni
   * aparece—, no como lista de la que elegir.
   */

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
       * El filtro por profesional lo usa quien ve más de una agenda: el servidor ya acota
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
    }
  }

  // Abre "Nueva cita" con la fecha/hora ya puestas desde un clic en el
  // calendario. `iso` es la fecha ISO del hueco pulsado.
  function abrirCreacionEn(iso) {
    const d = iso ? new Date(iso) : null;
    const date = d && !Number.isNaN(d.getTime()) ? toDateInput(d) : "";
    const time = d && !Number.isNaN(d.getTime()) && iso.includes("T") ? toTimeInput(d) : "";
    setCreacion({ date, time });
  }

  /*
   * ── MENÚ CONTEXTUAL DE LA CITA (31/08/2026, Rodrigo en la formación) ──────
   * Clic derecho sobre una cita → información del paciente, cortar, copiar y
   * cobrar. Cortar y copiar dejan la cita en `portapapeles` y el SIGUIENTE
   * clic sobre el calendario la pega (cortar reprograma la misma cita; copiar
   * crea una nueva con los mismos datos). Cobrar salta a Cobros con el
   * cliente ya puesto. Las reglas puras viven en lib/citas/pegarCita.js.
   */
  function handleEventContextMenu(e, info) {
    if (info.event.extendedProps?.esBloqueo) return;
    e.preventDefault();
    setMenuCita({
      x: e.clientX,
      y: e.clientY,
      titulo: info.event.title,
      cita: { id: info.event.id, startStr: info.event.startStr, props: info.event.extendedProps },
    });
  }

  function accionesDeMenu() {
    if (!menuCita) return [];
    const { cita } = menuCita;
    const ficha = fichaDeLaCita(cita.props, { conClientes, vocabulario });
    const viva = sePuedeMover(cita.props?.status);
    const cerrar = () => setMenuCita(null);
    return [
      {
        id: "ficha",
        icono: "👤",
        rotulo: ficha ? `Información de ${ficha.rotulo.toLowerCase()}` : "Información del paciente",
        deshabilitada: !ficha,
        motivo: "La cita no está enlazada a ninguna ficha",
        onClick: () => { cerrar(); if (ficha) router.push(ficha.href); },
      },
      {
        id: "cortar",
        icono: "✂️",
        rotulo: "Cortar (mover a otro hueco)",
        deshabilitada: !viva,
        motivo: "Una cita cancelada o pasada ya no se mueve",
        onClick: () => { cerrar(); setPortapapeles({ modo: "cortar", cita }); },
      },
      {
        id: "copiar",
        icono: "📋",
        rotulo: "Copiar a otro hueco",
        deshabilitada: false,
        onClick: () => { cerrar(); setPortapapeles({ modo: "copiar", cita }); },
      },
      {
        id: "cobrar",
        icono: "💶",
        rotulo: "Cobrar",
        deshabilitada: !cita.props?.clientId,
        motivo: "Sin ficha enlazada no se sabe a quién cobrar",
        onClick: () => {
          cerrar();
          router.push(`/facturacion/cobros?abrir=cuota&cliente=${cita.props.clientId}`);
        },
      },
    ];
  }

  // Pegar lo cortado/copiado en el hueco pulsado. Cortar = reprogramar la
  // MISMA cita (el PATCH ya valida solapamientos); copiar = alta nueva con los
  // datos de la original (el POST valida festivos, bloqueos y solapes igual
  // que el drawer de «Nueva cita»).
  async function pegarEn(dateStr) {
    const { modo, cita } = portapapeles;
    setPortapapeles(null);
    const destino = destinoDePegado(dateStr, cita.startStr);
    if (!destino) return;
    try {
      if (modo === "cortar") {
        const res = await fetch(`/api/citas/bookings/${cita.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledAt: destino }),
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "No se pudo mover la cita");
      } else {
        const p = cita.props ?? {};
        const res = await fetch("/api/citas/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventTypeId: p.eventTypeId,
            clientName: p.clientName,
            clientId: p.clientId || null,
            patientId: p.patientId || null,
            clientEmail: p.clientEmail || null,
            clientPhone: p.clientPhone || null,
            teamMemberId: p.teamMemberId || null,
            modality: p.modality,
            scheduledAt: destino,
          }),
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "No se pudo copiar la cita");
      }
      calendarRef.current?.getApi().refetchEvents();
    } catch (err) {
      await avisar({ titulo: modo === "cortar" ? "La cita no se ha movido" : "La cita no se ha copiado", texto: err.message });
    }
  }

  // Con el portapapeles cargado, Escape cancela sin pegar nada.
  useEffect(() => {
    if (!portapapeles) return;
    function tecla(e) { if (e.key === "Escape") setPortapapeles(null); }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [portapapeles]);

  // Doble clic en un hueco vacío → nueva cita lista para editar. FullCalendar
  // no distingue el doble clic, así que lo detectamos: dos `dateClick` sobre
  // la MISMA hora en menos de 400 ms. Un clic suelto no hace nada (evita abrir
  // el formulario cada vez que rozas el calendario).
  const lastClickRef = useRef({ at: 0, key: "" });
  function handleDateClick(info) {
    // Con algo en el portapapeles, el clic PEGA en vez de crear.
    if (portapapeles) { pegarEn(info.dateStr); return; }
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
    // Un clic suelto también dispara `select` (además de `dateClick`): con el
    // portapapeles cargado, ese clic está PEGANDO una cita — abrir encima el
    // drawer de «Nueva cita» era un segundo efecto no pedido. El pegado ya lo
    // hace handleDateClick; aquí solo se deshace la selección.
    if (portapapeles) { info.view?.calendar?.unselect(); return; }
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Los estilos de FullCalendar viven en app/globals.css (24/08/2026).
          Estaban aquí y en app/(dashboard)/calendario/page.jsx, copiados byte a
          byte y ya divergiendo en una regla. Al ser CSS global daba igual dónde
          se declararan, así que la copia que quedó es una. */}

      {/* Header. Más recogido que el resto de cabeceras (31/08/2026, Rodrigo):
          aquí cada píxel de arriba se lo come al calendario, que es lo que se
          viene a mirar. */}
      <div className="px-6 lg:px-10 pt-5 pb-4 flex items-end justify-between shrink-0 border-b border-[var(--ink-200)] gap-6 flex-wrap">
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
            onClick={() => abrirCreacionEn(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-md hover:bg-[#222] transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nueva cita manual
          </button>
        </div>
      </div>

      {/*
        Pestañas y filtros en UNA sola fila (31/08/2026, Rodrigo). Eran tres
        bandas apiladas —pestañas, debajo Tipo/Profesional, y Festivos con fila
        propia ya dentro del calendario— y la agenda arrancaba tres dedos más
        abajo de lo necesario. Todo lo que gobierna la vista comparte ahora
        fila: pestañas a la izquierda, filtros y Festivos pegados a la derecha;
        donde no caben (móvil), la fila envuelve sola.

        Los filtros son dos desplegables y no chips desde el 12/08/2026: en
        Aumenta eran 74 botones en 10 filas, más alto que el propio calendario.
      */}
      <div className="px-6 lg:px-10 py-2.5 flex items-center gap-x-4 gap-y-2 flex-wrap shrink-0 border-b border-neutral-100">
        <div className="flex items-center gap-1">
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

        {/* Lo que gobierna el calendario, solo con el calendario delante.
            Sin rotulitos «TIPO»/«PROFESIONAL» delante de los desplegables
            (31/08/2026): lo que enseñan ya lo dice — «Todos los tipos»,
            «Todo el equipo», «3 tipos»… — y sus ~110 px eran justo los que
            hacían saltar la fila a dos líneas en un portátil. */}
        {tab === "calendar" && (
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap lg:ml-auto">
            {eventTypes.length > 0 && (
            <>
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

            {/* El filtro es de quien ve más de una agenda, no de quien manda:
                con agenda compartida una terapeuta ve las de todo el centro y
                necesita separarlas igual que dirección. */}
            {veTodaLaAgenda && teamMembers.length > 1 && (
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
                  etiquetaTodos="Todo el equipo"
                  resumen={(n) => `${n} profesionales`}
                  searchable={teamMembers.length > 8}
                />
              </div>
            )}

            {/* Y si solo ve la suya, su nombre fijo en el mismo sitio: no se
                elige porque no hay nada que elegir. Iba por rol y mentía —con
                agenda compartida ponía «solo tus citas» encima de las citas de
                todo el centro—, así que ahora pregunta lo mismo que el filtro. */}
            {!veTodaLaAgenda && miFichaDeEquipo && (
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
            )}
            </>
            )}

            {/* Festivos y cierres del centro. Solo admin: cerrar un día afecta
                a la agenda de todo el equipo y a la reserva pública. El
                recuento de días cerrados en la vista va dentro del botón. */}
            {viewerIsAdmin && (
              <button
                type="button"
                onClick={() => setFestivosAbierto(true)}
                title={festivos.size > 0 ? `${festivos.size} día(s) cerrado(s) en la vista actual` : undefined}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors whitespace-nowrap"
              >
                Festivos y cierres{festivos.size > 0 ? ` · ${festivos.size}` : ""}
              </button>
            )}
          </div>
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
        <div className={`flex-1 min-h-0 flex flex-col px-6 lg:px-10 pt-3 pb-4 ${mesesAbiertos ? "meses-abiertos" : ""}`}>
          <p className="text-[11px] text-neutral-400 mb-2 lg:hidden shrink-0">
            Toca una cita para ver su ficha. Para crear o mover citas, mejor desde el ordenador.
          </p>
          <div className="flex-1 min-h-0 flex gap-4">
          {/* La columna de meses, cuando está desplegada: achata el calendario
              y desaparece al cerrarla. En móvil nunca: no cabe. */}
          {mesesAbiertos && !esMovil && (
            <MiniMeses
              vista={vistaRango}
              alPulsarDia={(d) => calendarRef.current?.getApi()?.gotoDate(d)}
            />
          )}
          <div className="flex-1 min-w-0 min-h-0">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView={esMovil && calView.view === "timeGridWeek" ? "listWeek" : calView.view}
            initialDate={calView.date || undefined}
            datesSet={(arg) => {
              calViewRef.current = { view: arg.view.type, date: arg.startStr };
              cargarFestivos(arg.startStr.slice(0, 10), arg.endStr.slice(0, 10));
              /*
               * Para la columna de meses. OJO: `render()` también dispara
               * datesSet (ver la nota de firmaFestivos), así que si la vista
               * no ha cambiado se devuelve el MISMO objeto — un objeto nuevo
               * con los mismos números re-renderizaría a cada repintado.
               */
              const s = arg.view.activeStart.getTime();
              const e = arg.view.activeEnd.getTime();
              const c = arg.view.currentStart.getTime();
              setVistaRango((prev) =>
                prev && prev.start === s && prev.end === e && prev.current === c
                  ? prev
                  : { start: s, end: e, current: c }
              );
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
                ? { left: "prev,next", center: "title", right: "listWeek,timeGridTresDias,timeGridDay" }
                : { left: "meses prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridTresDias,timeGridDay,listWeek" }
            }
            /*
             * El botón que abre y cierra la columna de meses. Va DENTRO de la
             * botonera de FullCalendar y no suelto por la página: es un mando
             * del calendario y ahí queda pegado a lo que gobierna. En móvil ni
             * aparece: la columna no cabe y no se pinta.
             */
            customButtons={{
              meses: {
                text: "Meses",
                hint: "Enseñar u ocultar los meses para saltar a un día",
                click: () => {
                  setMesesAbiertos((v) => {
                    try { localStorage.setItem("citas.miniMeses", v ? "0" : "1"); } catch { /* sin memoria, solo esta visita */ }
                    return !v;
                  });
                },
              },
            }}
            /*
             * Vista «3 días» (30/08/2026, Rodrigo): entre el día suelto y la
             * semana entera faltaba el término medio con el que se trabaja una
             * agenda llena — hoy y los dos días siguientes, con columnas el
             * doble de anchas que en semana. prev/next salta de tres en tres.
             * En el móvil es además la primera vista de rejilla que cabe.
             */
            views={{
              timeGridTresDias: {
                type: "timeGrid",
                duration: { days: 3 },
                buttonText: "3 días",
              },
            }}
            locale="es"
            firstDay={1}
            slotMinTime="07:00:00"
            slotMaxTime="22:00:00"
            /*
             * Solo la hora de INICIO en la caja (30/08/2026, Rodrigo): el
             * «12:00 - 12:30» de antes se comía el ancho y el nombre salía
             * cortado justo en las citas de media hora, que son la mayoría.
             * El final ya lo dice el alto de la caja, y la ficha lo trae
             * exacto. El otro medio arreglo (cortar con «…» lo que aun así no
             * quepa) es CSS y vive en app/globals.css.
             */
            displayEventEnd={false}
            /*
             * Citas pegadas SIN montarse (31/08/2026, Rodrigo). FullCalendar
             * estira toda caja hasta un mínimo de 15 px y usa la caja YA
             * estirada para decidir si dos eventos chocan (computeSegVCoords
             * de timegrid, con un «:(» del propio autor en esa línea). Un
             * bloqueo de un cuarto de hora medía ~12 px, se estiraba, e
             * invadía a la cita de las «y cuarto», que salía montada encima,
             * a media anchura y con el nombre cortado. Tres piezas que van
             * juntas: la rejilla es más alta (`.fc-timegrid-slot` en
             * globals.css) para que un cuarto de hora ya mida más de 15 px y
             * le quepa su línea de texto; el mínimo baja a 8 px para que una
             * caja nunca ocupe más tiempo del que dura; y los solapes DE
             * VERDAD (dos citas a la misma hora) se reparten lado a lado en
             * vez de pintarse una tapando a la otra.
             */
            eventMinHeight={8}
            slotEventOverlap={false}
            allDaySlot={false}
            events={fetchEvents}
            eventClick={handleEventClick}
            // Clic derecho sobre la caja → menú contextual. FullCalendar no
            // trae onContextMenu: se engancha al montarse cada evento (el
            // listener muere con el elemento, no hay que soltarlo a mano).
            eventDidMount={(info) => {
              info.el.addEventListener("contextmenu", (e) => handleEventContextMenu(e, info));
            }}
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
        </div>
      )}

      {/* Menú contextual de la cita (clic derecho) y el aviso del pegado. */}
      {menuCita && (
        <CitaMenuContextual menu={menuCita} acciones={accionesDeMenu()} onCerrar={() => setMenuCita(null)} />
      )}
      {portapapeles && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-neutral-900 text-white text-xs rounded-full px-4 py-2 shadow-pop flex items-center gap-3">
          <span>
            {portapapeles.modo === "cortar" ? "✂️ Cortando" : "📋 Copiando"} «{portapapeles.cita.props?.clientName ?? "cita"}» — haz clic en el hueco de destino
          </span>
          <button type="button" onClick={() => setPortapapeles(null)} className="text-white/60 hover:text-white transition-colors">
            Cancelar (Esc)
          </button>
        </div>
      )}

      {/* ─── Modal de detalle de booking ───
          Vive en modules/default/citas/CitaDetalleModal.jsx con su estado
          dentro. El key hace que abrir OTRA cita estrene el estado (notas,
          fecha tecleada, propuestas…), que es lo que antes hacían los resets
          de handleEventClick. */}
      {openBooking && (
        <CitaDetalleModal
          key={openBooking.id}
          booking={openBooking}
          conClientes={conClientes}
          vocabulario={vocabulario}
          teamMembers={teamMembers}
          patients={patients}
          viewerIsAdmin={viewerIsAdmin}
          confirmar={confirmar}
          avisar={avisar}
          pedirTexto={pedirTexto}
          elegir={elegir}
          onClose={() => setOpenBooking(null)}
          onChanged={(data) => {
            setOpenBooking(data);
            calendarRef.current?.getApi().refetchEvents();
            // Cancelar/confirmar una pendiente cambia el número de la lista de
            // espera; sin esto el contador quedaba desactualizado (2026-07-23).
            loadPendingCount();
          }}
          onDeleted={() => {
            setOpenBooking(null);
            calendarRef.current?.getApi().refetchEvents();
          }}
        />
      )}

      {/* ─── Drawer "Nueva cita manual" ───
          Vive en modules/default/citas/NuevaCitaDrawer.jsx con su formulario
          dentro; aquí solo se decide con qué hueco se abre. */}
      {creacion && (
        <NuevaCitaDrawer
          inicial={creacion}
          eventTypes={eventTypes}
          teamMembers={teamMembers}
          patients={patients}
          confirmar={confirmar}
          avisar={avisar}
          onClose={() => setCreacion(null)}
          onCreated={() => {
            calendarRef.current?.getApi().refetchEvents();
            setCreacion(null);
          }}
        />
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
