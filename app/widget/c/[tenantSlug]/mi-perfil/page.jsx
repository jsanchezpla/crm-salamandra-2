"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useCitasPortalSession } from "../_components/useCitasPortalSession.js";
import { useAdmision } from "../_components/useAdmision.js";
import PuertaScreen from "../_components/PuertaScreen.jsx";
import MisDocumentos from "../_components/MisDocumentos.jsx";
import BienvenidaGate from "../_components/BienvenidaGate.jsx";
import ContratoGate from "../_components/ContratoGate.jsx";
import DatosGate from "../_components/DatosGate.jsx";
import ComunicacionesGate from "../_components/ComunicacionesGate.jsx";
import ConsentimientoImagenGate from "../_components/ConsentimientoImagenGate.jsx";
import { googleCalendarUrl } from "../../../../../lib/citas/googleCalendar.js";
import { debePreguntarBienvenida } from "../../../../../lib/citas/bienvenida.js";

function fmtLong(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MODALITY_ES = { presencial: "Presencial", phone: "Llamada", online: "Online" };

const STATUS_BADGE = {
  pending:   { label: "Pendiente de confirmar", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  confirmed: { label: "Confirmada",             cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  completed: { label: "Realizada",              cls: "bg-[var(--widget-bg)] text-[var(--widget-text-muted)] border-[var(--widget-border)]" },
  cancelled: { label: "Cancelada",              cls: "bg-red-50 text-red-700 border-red-100" },
  no_show:   { label: "No asististe",           cls: "bg-[var(--widget-bg)] text-[var(--widget-text-muted)] border-[var(--widget-border)]" },
};

const headingStyle = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };

function StatusBadge({ status }) {
  const b = STATUS_BADGE[status] ?? { label: status, cls: "bg-[var(--widget-bg)] text-[var(--widget-text-muted)] border-[var(--widget-border)]" };
  return (
    <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full border ${b.cls}`}>
      {b.label}
    </span>
  );
}

function BookingCard({ booking, muted, onCancel, profesional }) {
  /*
   * «Añadir a Google Calendar», SOLO en las confirmadas y que no han pasado
   * (06/08/2026, Rodrigo). Este enlace existía únicamente en la pantalla del
   * momento de reservar, y ahí ya no se pinta cuando la cita nace pendiente del
   * visto bueno: a quien se la confirmaban después no le quedaba ninguna forma
   * de llevársela a su calendario. Aquí es donde vuelve a mirarla.
   *
   * En una cita pendiente no sale a propósito: apuntar una hora que todavía no
   * es suya es pedirle que se presente a algo que puede no existir.
   */
  const gcal =
    !muted && booking.status === "confirmed"
      ? googleCalendarUrl({
          name: booking.eventTypeName ?? "Cita",
          description: profesional ? `Cita con ${profesional}` : "",
          start: booking.scheduledAt,
          durationMinutes: booking.duration,
          location: booking.meetUrl || "",
        })
      : null;

  return (
    <div
      className={`bg-[var(--widget-card)] rounded-lg border border-[var(--widget-border)] p-4 ${muted ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: booking.eventTypeColor || "var(--brand-primary, var(--widget-button))" }}
          />
          <span className="font-medium text-[var(--widget-text)] truncate">
            {booking.eventTypeName ?? "Cita"}
          </span>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <div className="mt-2 text-[14px] text-[var(--widget-text)] first-letter:uppercase">
        {fmtLong(booking.scheduledAt)}
      </div>
      <div className="text-[12px] text-[var(--widget-text-faint)] mt-0.5">
        {booking.duration} min · {MODALITY_ES[booking.modality] ?? booking.modality} · Hora de Madrid
      </div>

      {(booking.meetUrl || booking.cancellable || gcal) && (
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          {booking.meetUrl && (
            <a
              href={booking.meetUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-md text-white bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              Entrar a la videollamada
            </a>
          )}
          {booking.cancellable && (
            <button
              onClick={() => onCancel(booking)}
              className="inline-flex items-center px-3 py-1.5 text-[13px] font-medium rounded-md border border-[var(--widget-border)] text-[var(--widget-text)] hover:bg-[var(--widget-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              Cancelar
            </button>
          )}
          {gcal && (
            <a
              href={gcal}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center text-[13px] text-[var(--widget-text-muted)] hover:text-[var(--widget-text)] underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] rounded-sm"
            >
              Añadir a Google Calendar
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Pantalla-gate: sin sesión válida (no-token / invalid / expired). */
function Gate({ info, variant }) {
  const loginUrl = info?.auth?.loginUrl;
  const brandStyle = {};
  if (info?.brand?.primaryColor) brandStyle["--brand-primary"] = info.brand.primaryColor;
  if (info?.brand?.secondaryColor) brandStyle["--brand-secondary"] = info.brand.secondaryColor;

  const title = variant === "expired" ? "Tu sesión ha caducado" : "Inicia sesión para ver tu perfil";
  const body =
    variant === "expired"
      ? `Vuelve a abrir esta página desde tu cuenta en la web de ${info?.name ?? "la profesional"}.`
      : `Para ver tus citas y tus documentos necesitas abrir esta página desde tu cuenta en la web de ${info?.name ?? "la profesional"}. Inicia sesión y vuelve a esta página.`;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={brandStyle}>
      <div className="max-w-md w-full bg-[var(--widget-card)] rounded-2xl border border-[var(--widget-border)] p-7 lg:p-9 text-center shadow-sm">
        {info?.brand?.logoUrl ? (
          <img src={info.brand.logoUrl} alt="" className="h-12 w-auto mx-auto mb-5" />
        ) : (
          <div
            className="h-12 w-12 mx-auto mb-5 rounded-full flex items-center justify-center text-white text-base font-semibold"
            style={{ backgroundColor: "var(--brand-primary, var(--widget-button))" }}
          >
            {info?.name?.[0]?.toUpperCase() ?? "·"}
          </div>
        )}
        <h1 className="text-[24px] lg:text-[28px] leading-tight text-[var(--widget-text)] tracking-tight mb-2" style={headingStyle}>
          {title}
        </h1>
        <p className="text-[14px] text-[var(--widget-text-muted)] leading-relaxed mb-6">{body}</p>
        {loginUrl && (
          <a
            href={loginUrl}
            target="_top"
            rel="noopener"
            className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-xl text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] focus:ring-offset-2 focus:ring-offset-[var(--widget-bg)]"
          >
            Iniciar sesión
            <span aria-hidden="true">→</span>
          </a>
        )}
      </div>
    </div>
  );
}

export default function MiPerfilPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug;

  const [info, setInfo] = useState(null);
  const portal = useCitasPortalSession(tenantSlug);
  const { status, authFetch } = portal;

  // Su situación con el formulario (05/08/2026, Rodrigo). El área privada es la
  // OTRA puerta de entrada, y tiene que contestar lo mismo que la agenda: si
  // «Reservar cita» te manda al formulario, «Mi perfil» también.
  const admision = useAdmision(tenantSlug, portal);

  const [data, setData] = useState(null); // { upcoming, history }
  const [avisos, setAvisos] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState(null);

  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  // Contrato del Centro (sprint 2026-07, 2.1): nada más entrar tapa el portal
  // hasta que la familia firma. `aplazado` es el «lo firmo más tarde»: deja
  // pasar, pero solo hasta que se cierre la pestaña — al volver a entrar la
  // pantalla vuelve a salir, que para eso el contrato es obligatorio.
  const [contrato, setContrato] = useState(null);
  const [aplazado, setAplazado] = useState(false);
  // Segundo paso al entrar (01/08): por dónde quiere que le escribamos. NO
  // bloquea —se puede pasar sin marcar nada— pero se pregunta una vez.
  const [comunicaciones, setComunicaciones] = useState(null);
  const [comunicacionesVistas, setComunicacionesVistas] = useState(false);

  // Permiso de imágenes: se pregunta una vez por sesión. El componente se
  // esconde solo si ya han contestado por todos sus hijos.
  const [imagenVista, setImagenVista] = useState(false);

  // «¿A qué entras?» (04/08/2026, Rodrigo). Va ANTES del contrato: quien viene
  // a una primera visita no tiene por qué firmar el acuerdo de servicio para
  // pedirla. `valoracion` es el tipo de cita que el centro haya marcado como
  // valoración inicial; sin ninguno marcado, esta pregunta no existe.
  const [valoracion, setValoracion] = useState(null);
  // `?perfil=1` = ya contestó a «¿a qué entras hoy?» en la agenda y eligió el
  // perfil. Sin esto se le preguntaría dos veces seguidas lo mismo, una en cada
  // pantalla, y la segunda vez parecería que el botón no ha hecho nada.
  const searchParams = useSearchParams();
  const [eligioPerfil, setEligioPerfil] = useState(searchParams.get("perfil") === "1");

  // «Completa tus datos», ahora DESPUÉS de firmar (04/08/2026, Rodrigo). Antes
  // iba delante del contrato y era un peaje en la puerta; lo único que se sigue
  // pidiendo antes es la fecha de nacimiento, porque decide si hace falta el
  // consentimiento del tutor. `datosAplazados` es el «más tarde»: deja pasar
  // hasta que cierre la pestaña, igual que el contrato.
  const [datosAplazados, setDatosAplazados] = useState(false);
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  const [errorDatos, setErrorDatos] = useState(null);

  // Info del tenant (branding / header / loginUrl).
  useEffect(() => {
    if (!tenantSlug) return;
    let cancelled = false;
    fetch(`/api/public/c/${tenantSlug}/info`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.data) setInfo(j.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tenantSlug]);

  // ¿Cuál es la valoración inicial de este centro? Es público (los tipos de
  // cita ya lo son), así que no gasta la sesión del portal. Si falla, el portal
  // se comporta como toda la vida: derecho al contrato.
  useEffect(() => {
    if (!tenantSlug) return;
    let cancelled = false;
    fetch(`/api/public/c/${tenantSlug}/event-types`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        setValoracion((j?.data ?? []).find((t) => t.isInitialAssessment) ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tenantSlug]);

  const loadBookings = useCallback(async () => {
    setLoadingData(true);
    setDataError(null);
    try {
      const res = await authFetch("/citas-portal/bookings", { cache: "no-store" });
      if (res.status === 401) return; // el hook pasa a "expired"
      if (!res.ok) throw new Error("No pudimos cargar tus citas");
      const j = await res.json();
      setData(j.data ?? { upcoming: [], history: [] });
    } catch (err) {
      setDataError(err.message);
    } finally {
      setLoadingData(false);
    }
  }, [authFetch]);

  /**
   * Avisos del centro. Best-effort a propósito: si esto falla, el portal tiene
   * que seguir enseñando las citas — es una sección más, no la pantalla.
   */
  const loadAvisos = useCallback(async () => {
    try {
      const res = await authFetch("/citas-portal/avisos", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      setAvisos(j.data?.avisos ?? []);
    } catch {
      /* sin avisos que enseñar, el resto del portal sigue igual */
    }
  }, [authFetch]);

  /** «Entendido»: se marca leído en el servidor y se pinta al momento. */
  const marcarLeido = useCallback(
    async (id) => {
      setAvisos((prev) => prev.map((a) => (a.id === id ? { ...a, leido: true } : a)));
      try {
        await authFetch("/citas-portal/avisos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [id] }),
        });
      } catch {
        /* si no se pudo marcar, volverá a salir la próxima vez: es lo correcto */
      }
    },
    [authFetch]
  );

  const loadContrato = useCallback(async () => {
    try {
      const res = await authFetch("/citas-portal/contract", { cache: "no-store" });
      if (!res.ok) return; // 401 lo gestiona el hook; cualquier otro fallo no cierra el portal
      const j = await res.json();
      setContrato(j.data ?? null);
    } catch {
      /* si no se puede consultar, no se bloquea a nadie */
    }
  }, [authFetch]);

  const loadComunicaciones = useCallback(async () => {
    try {
      const res = await authFetch("/citas-portal/comunicaciones", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      setComunicaciones(j.data ?? null);
    } catch {
      /* si no se puede consultar, no se le pregunta nada */
    }
  }, [authFetch]);

  useEffect(() => {
    if (status === "ready") {
      loadBookings();
      loadAvisos();
      loadContrato();
      loadComunicaciones();
    }
  }, [status, loadBookings, loadAvisos, loadContrato, loadComunicaciones]);

  const brandStyle = useMemo(() => {
    if (!info?.brand) return {};
    const out = {};
    if (info.brand.primaryColor) out["--brand-primary"] = info.brand.primaryColor;
    if (info.brand.secondaryColor) out["--brand-secondary"] = info.brand.secondaryColor;
    if (info.brand.accentColor) out["--brand-accent"] = info.brand.accentColor;
    return out;
  }, [info]);

  function openCancel(booking) {
    setCancelTarget(booking);
    setCancelReason("");
    setCancelError(null);
  }
  function closeCancel() {
    if (cancelling) return;
    setCancelTarget(null);
    setCancelReason("");
    setCancelError(null);
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await authFetch(`/citas-portal/cancel/${cancelTarget.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() || null }),
      });
      if (res.status === 401) return; // expired → hook + gate
      const j = await res.json().catch(() => ({}));
      if (res.status === 410) {
        setCancelError(j?.error || "Esta cita ya no se puede cancelar");
        await loadBookings();
        return;
      }
      if (!res.ok || !j.ok) throw new Error(j?.error || "No se pudo cancelar");
      setCancelTarget(null);
      setCancelReason("");
      await loadBookings();
    } catch (err) {
      setCancelError(err.message);
    } finally {
      setCancelling(false);
    }
  }

  // ── Estados de sesión ──────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[var(--widget-text-muted)]">
        Cargando…
      </div>
    );
  }
  if (status === "no-token" || status === "invalid" || status === "expired" || status === "error") {
    return <Gate info={info} variant={status} />;
  }

  // ── status === "ready" ─────────────────────────────────────────────────────
  const upcoming = data?.upcoming ?? [];
  const history = data?.history ?? [];
  const isEmpty = !loadingData && !dataError && upcoming.length === 0 && history.length === 0;

  // ── «¿A qué entras?» ──────────────────────────────────────────────────────
  // Va DELANTE del contrato (04/08/2026): a la primera visita se entra sin
  // firmar nada. Se salta sola —sin preguntar— cuando la persona YA tiene su
  // valoración cogida, sea próxima o pasada: quien ya la reservó no vuelve a la
  // casilla de salida cada vez que abre el portal.
  //
  // Se espera a que carguen las citas (`loadingData`) a propósito: preguntar
  // antes de saberlo se la enseñaría un instante a quien no le tocaba.
  // ── Antes que nada: ¿ha pasado por el formulario? (05/08/2026, Rodrigo) ───
  // Va DELANTE de la bienvenida a propósito. Sin solicitud aceptada no hay
  // ficha, y sin ficha el área privada no puede pedirle ni contratos ni datos:
  // la dejaba entrar directa a sus documentos como si estuviera todo hecho.
  //
  // Mientras se comprueba no se pinta nada: enseñarle la bienvenida y
  // sustituirla medio segundo después es peor que esperar.
  if (admision.cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[var(--widget-text-muted)]">
        Cargando…
      </div>
    );
  }
  if (!admision.admitida) {
    return (
      <PuertaScreen
        aviso={admision.aviso}
        urlFormulario={admision.urlFormulario}
        brandStyle={brandStyle}
      />
    );
  }

  /*
   * La regla de cuándo se pregunta vive en `lib/citas/bienvenida.js`, compartida
   * con la agenda (06/08/2026). Antes se miraba solo si tenía reservada una
   * VALORACIÓN, y por eso a quien acababa de firmar todos sus documentos —o ya
   * tenía cita de otro tipo— se le volvía a preguntar «¿a qué entras hoy?» cada
   * vez que entraba: la decisión ya estaba tomada y la pantalla no se enteraba.
   */
  const preguntarBienvenida = debePreguntarBienvenida({
    valoracion,
    citas: [...upcoming, ...history],
    contrato,
  });
  if (preguntarBienvenida && !eligioPerfil && !loadingData && !dataError) {
    return (
      <div style={brandStyle}>
        <BienvenidaGate
          profesional={info?.name}
          valoracion={valoracion}
          /**
           * A la agenda con la VALORACIÓN ya elegida y sin el resto de citas a
           * la vista (05/08/2026, Rodrigo).
           *
           * Iba directa a `/book?eventTypeId=…`, que es el formulario de datos
           * SIN haber elegido día ni hora: la pantalla a la que se llega
           * después de escoger hueco. Ahora va a la agenda con `?tipo=`, que
           * preselecciona ese tipo y NO pinta la lista (ver `soloUnTipo` en la
           * pantalla de selección).
           *
           * Por qué importa que no vea el resto: es su primera visita. Si le
           * enseñas los cuatro tipos, puede coger un acompañamiento mensual de
           * 360 € antes de haber hablado contigo ni una vez.
           *
           * Va por SLUG y no por id: es lo que acepta ese parámetro, y además
           * el enlace se puede leer y dictar.
           */
          /*
           * `wpa=1` viaja con ella (06/08/2026). Este enlace sale del área
           * privada, o sea de alguien YA identificado, y llevaba a la agenda sin
           * ninguna marca de identidad en la URL. Si por lo que sea la sesión
           * guardada no está disponible al llegar —caducó, otra pestaña, el
           * navegador con el almacenamiento bloqueado—, la agenda le plantaba
           * «Inicia sesión para reservar» a quien acababa de salir de su propio
           * perfil. Es la misma marca que ya propaga el botón de continuar.
           */
          hrefValoracion={`/widget/c/${tenantSlug}?tipo=${encodeURIComponent(valoracion.slug)}&wpa=1`}
          onEntrarPerfil={() => setEligioPerfil(true)}
        />
      </div>
    );
  }

  // Guarda en la ficha los datos que se piden tras firmar. Mismo endpoint que
  // usa ContratoGate para los previos: la ficha es la misma.
  async function guardarMisDatos(datos) {
    if (guardandoDatos) return;
    setGuardandoDatos(true);
    setErrorDatos(null);
    try {
      const res = await authFetch("/citas-portal/mis-datos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datos }),
      });
      if (res.status === 401) return;
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j?.error || "No pudimos guardar tus datos");
      setContrato((c) => ({ ...c, ...j.data }));
      loadContrato();
    } catch (err) {
      setErrorDatos(err.message);
    } finally {
      setGuardandoDatos(false);
    }
  }

  // La pantalla del contrato va DELANTE de todo lo demás.
  if (contrato?.requiereFirma && !aplazado) {
    return (
      <div style={brandStyle}>
        <ContratoGate
          estado={contrato}
          authFetch={authFetch}
          tenantSlug={tenantSlug}
          profesional={info?.name}
          onFirmado={(nuevo) => {
            // Con el consentimiento parental detrás del contrato la firma NO ha
            // terminado: se encadena el siguiente documento sin soltar la
            // pantalla (`nuevo.plantilla` ya trae el que toca).
            const quedan = nuevo?.quedanDocumentos ?? 0;
            setContrato((c) => ({ ...c, ...nuevo, requiereFirma: quedan > 0, yaFirme: quedan === 0 }));
            loadContrato();
          }}
          onMasTarde={() => setAplazado(true)}
        />
      </div>
    );
  }

  // Ya está firmado: AHORA se le piden el domicilio y los datos de facturación
  // (04/08/2026). Se puede aplazar: tener la ficha completa es cosa del centro,
  // no un requisito para ver tus propias citas.
  if ((contrato?.datosPosteriores?.length ?? 0) > 0 && !datosAplazados) {
    return (
      <div style={brandStyle}>
        <DatosGate
          campos={contrato.datosPosteriores}
          profesional={info?.name}
          enviando={guardandoDatos}
          error={errorDatos}
          onGuardar={guardarMisDatos}
          onMasTarde={() => setDatosAplazados(true)}
        />
      </div>
    );
  }

  // Segundo paso: las comunicaciones. Solo la primera vez (mientras no hayan
  // contestado nunca) y solo si el contrato ya no tapa la pantalla.
  if (
    comunicaciones?.disponible &&
    !comunicaciones.yaRespondio &&
    !comunicacionesVistas &&
    !(contrato?.requiereFirma && !aplazado)
  ) {
    return (
      <div style={brandStyle}>
        <ComunicacionesGate
          authFetch={authFetch}
          profesional={info?.name}
          onGuardado={(d) => {
            setComunicaciones((c) => ({ ...c, ...d, yaRespondio: true }));
            setComunicacionesVistas(true);
          }}
          onMasTarde={() => setComunicacionesVistas(true)}
        />
      </div>
    );
  }

  // Tercer paso: el permiso de imágenes de cada niño. Va el ÚLTIMO porque es el
  // único de los tres que se puede saltar sin consecuencias: el contrato es el
  // acuerdo de servicio y los canales son operativos, pero esto es opcional de
  // verdad. El propio componente se esconde solo si no queda nadie por contestar.
  // OJO: se pinta ENCIMA del portal (es `fixed inset-0`), no en su lugar. Al
  // principio lo puse como los otros dos, con un `return` que sustituía la
  // página — y eso dejaba el portal EN BLANCO en cada visita mientras se
  // consultaba si quedaba alguien por contestar, incluso en centros donde esta
  // pantalla ni aplica. Ahora la familia ve su portal desde el primer momento y
  // el aviso aparece encima solo si hay algo que preguntar.

  return (
    <div className="min-h-screen" style={brandStyle}>
      {!imagenVista && (
        <ConsentimientoImagenGate
          authFetch={authFetch}
          profesional={info?.name}
          onTerminado={() => setImagenVista(true)}
          onMasTarde={() => setImagenVista(true)}
        />
      )}
      <header className="px-6 lg:px-10 py-6 border-b border-[var(--widget-border)] bg-[var(--widget-card)]">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          {info?.brand?.logoUrl ? (
            <img src={info.brand.logoUrl} alt="" className="h-10 w-auto" />
          ) : (
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
              style={{ backgroundColor: "var(--brand-primary, var(--widget-button))" }}
            >
              {info?.name?.[0]?.toUpperCase() ?? "·"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)]">Mi perfil</div>
            <h1 className="text-[22px] lg:text-[26px] leading-tight text-[var(--widget-text)] truncate tracking-tight" style={headingStyle}>
              {info?.name}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 lg:px-10 py-6 lg:py-10">
        {/* Contrato pendiente: o lo aplazó quien entra, o falta la firma del
            otro progenitor. En los dos casos la documentación sigue cerrada,
            así que se dice aquí arriba y no escondido en «Mis documentos». */}
        {contrato?.bloqueado && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] text-amber-900 min-w-0">
              {contrato.yaFirme ? (
                <>
                  Ya has firmado. Falta la firma de{" "}
                  <span className="font-medium">{contrato.pendientes?.join(" y ") || "el otro tutor"}</span> para
                  abrir la documentación.
                </>
              ) : (
                <>Tienes el contrato del centro pendiente de firmar. Hasta entonces no podrás ver tus documentos.</>
              )}
            </div>
            {!contrato.yaFirme && contrato.puedeFirmar && (
              <button
                type="button"
                onClick={() => setAplazado(false)}
                className="shrink-0 px-3.5 py-2 text-[13px] font-medium rounded-md text-white bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
              >
                Firmar ahora
              </button>
            )}
          </div>
        )}

        {loadingData && (
          <div className="text-[13px] text-[var(--widget-text-muted)] py-6">Cargando tus citas…</div>
        )}
        {dataError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 mb-4">
            {dataError}
          </div>
        )}

        <div className="space-y-10">
          {/* ── Avisos del centro ──────────────────────────────────────────
              Van los PRIMEROS y solo aparecen si hay alguno: una sección vacía
              permanente enseña a no mirarla. Los no leídos van destacados y
              arriba; los ya leídos se quedan debajo, apagados, porque poder
              volver a un aviso de hace un mes es justo lo que el correo no
              permite. */}
          {avisos.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-3">
                Avisos de {info?.name ?? "tu profesional"}
              </div>
              <div className="flex flex-col gap-3">
                {[...avisos].sort((a, b) => Number(a.leido) - Number(b.leido)).map((a) => (
                  <div
                    key={a.id}
                    className={`rounded-xl border p-4 ${
                      a.leido
                        ? "border-[var(--widget-border)] bg-[var(--widget-card)]"
                        : "border-[var(--brand-primary,var(--widget-button))] bg-[var(--widget-card)] shadow-sm"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium text-[var(--widget-text)]">{a.titulo}</div>
                        <div className="text-[11px] text-[var(--widget-text-faint)] mt-0.5">
                          {fmtLong(a.creado)}
                        </div>
                      </div>
                      {!a.leido && (
                        <span className="shrink-0 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full text-white bg-[var(--brand-primary,var(--widget-button))]">
                          Nuevo
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] leading-relaxed text-[var(--widget-text-muted)] mt-2 whitespace-pre-line">
                      {a.cuerpo}
                    </p>
                    {!a.leido && (
                      <button
                        type="button"
                        onClick={() => marcarLeido(a.id)}
                        className="mt-3 text-[12px] font-medium text-[var(--brand-primary,var(--widget-button))] hover:underline"
                      >
                        Entendido
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Mis citas ── */}
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-3">
              Mis citas
            </div>

            {/*
              SIN botón de reservar (06/08/2026, Rodrigo). Aquí había un
              «Reservar una cita» que sacaba a la paciente del área privada
              (`target="_top"`) hacia la agenda, y ese salto se llevaba por
              delante la sesión del portal más de una vez: quien salía de su
              propio perfil acababa en «Inicia sesión para reservar».

              Para reservar está el botón del menú de la web, que hace el mismo
              recorrido pero desde WordPress, que es quien tiene la sesión y
              firma el acceso. Aquí solo se cuenta lo que hay.
            */}
            {isEmpty && (
              <div className="text-[13px] text-[var(--widget-text-muted)] bg-[var(--widget-card)] rounded-lg border border-[var(--widget-border)] p-4">
                No tienes citas próximas.
              </div>
            )}

            {!loadingData && !isEmpty && (
              <div className="space-y-8">
                <section>
                  <div className="text-[12px] text-[var(--widget-text-muted)] mb-2">Próximas</div>
                  {upcoming.length === 0 ? (
                    <div className="text-[13px] text-[var(--widget-text-muted)] bg-[var(--widget-card)] rounded-lg border border-[var(--widget-border)] p-4">
                      No tienes citas próximas.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {upcoming.map((b) => (
                        <BookingCard key={b.id} booking={b} onCancel={openCancel} profesional={info?.name} />
                      ))}
                    </div>
                  )}
                </section>

                {history.length > 0 && (
                  <section>
                    <div className="text-[12px] text-[var(--widget-text-muted)] mb-2">Historial</div>
                    <div className="flex flex-col gap-3">
                      {history.map((b) => (
                        <BookingCard key={b.id} booking={b} muted />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>

          {/* ── Mis documentos ── (siempre, aunque aún no haya citas) */}
          <MisDocumentos
            tenantSlug={tenantSlug}
            authFetch={authFetch}
            profesional={info?.name}
            onFirmar={contrato?.puedeFirmar ? () => setAplazado(false) : null}
          />
        </div>
      </div>

      {/* Confirmación de cancelación */}
      {/* SIN sombreado de fondo a propósito: esto vive dentro de un iframe
          embebido en la web del profesional, así que un `bg-black/40` no oscurece
          la página — solo pinta un rectángulo oscuro del tamaño del widget en
          mitad de su web, que parece un error de maquetación. La capa sigue
          existiendo (invisible) para centrar el diálogo y para que no se pueda
          tocar la lista de detrás; lo que separa el diálogo del fondo es ahora su
          sombra, por eso es más marcada que la de un modal normal. */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 py-6">
          <div className="w-full max-w-md bg-[var(--widget-card)] rounded-xl border border-[var(--widget-border)] p-6 shadow-[0_8px_40px_rgba(0,0,0,0.28)]">
            <h2 className="text-[20px] text-[var(--widget-text)] tracking-tight mb-1" style={headingStyle}>
              ¿Cancelar esta cita?
            </h2>
            <p className="text-sm text-[var(--widget-text-muted)] mb-4">
              Si confirmas, liberaremos el hueco para que otra persona pueda reservarlo.
            </p>

            {/* Qué pasa con su dinero, ANTES de pulsar. Sin esto, alguien con la
                cita pagada cancelaba con menos de 24 h, perdía el importe entero
                y no se enteraba ni antes ni después. */}
            <p className="text-[13px] leading-relaxed">
              <AvisoDinero siCancela={cancelTarget?.siCancela} />
            </p>

            <div className="bg-[var(--widget-bg)] rounded-lg border border-[var(--widget-border)] p-3 text-[13px] mb-4">
              <div className="font-medium text-[var(--widget-text)]">{cancelTarget.eventTypeName ?? "Cita"}</div>
              <div className="text-[var(--widget-text)] first-letter:uppercase">{fmtLong(cancelTarget.scheduledAt)}</div>
            </div>

            <label className="block text-[11px] font-medium text-[var(--widget-text-muted)] mb-1">
              Motivo (opcional)
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-sm text-[var(--widget-text)] bg-[var(--widget-card)] border border-[var(--widget-border)] focus:outline-none focus:border-[var(--brand-primary,var(--widget-button))] focus:ring-2 focus:ring-[var(--widget-focus)] min-h-[72px] placeholder:text-[var(--widget-text-faint)]/80 mb-4"
              placeholder="Si nos cuentas el motivo, nos ayudas a mejorar."
            />

            {cancelError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 mb-3">
                {cancelError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={closeCancel}
                disabled={cancelling}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-md border border-[var(--widget-border)] text-[var(--widget-text)] hover:bg-[var(--widget-bg)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
              >
                Volver
              </button>
              <button
                onClick={confirmCancel}
                disabled={cancelling}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-300"
              >
                {cancelling ? "Cancelando…" : "Sí, cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Lo que pasa con el dinero si cancela. El servidor lo calcula (`siCancela`) y
 * aquí solo se pinta: si la pantalla hiciera su propia cuenta acabaría
 * prometiendo devoluciones que la política real no da.
 *
 * El caso que hay que decir SÍ O SÍ es "se_pierde": cancelar con menos de 24
 * horas no devuelve nada, y enterarse después es enterarse tarde.
 */
export function AvisoDinero({ siCancela }) {
  if (!siCancela || siCancela.tipo === "nada" || !siCancela.importe) return null;
  const importe = (siCancela.importe / 100).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });

  if (siCancela.tipo === "se_pierde") {
    return (
      <span className="block rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
        Quedan menos de 24 horas para la cita, así que <b>no se te devolverán los {importe}</b> que
        ya has pagado.
      </span>
    );
  }
  if (siCancela.tipo === "se_devuelve") {
    return (
      <span className="block rounded-md border border-[var(--widget-border)] bg-[var(--widget-bg)] px-3 py-2 text-[var(--widget-text-muted)]">
        Se te devolverán los {importe} íntegros.
      </span>
    );
  }
  if (siCancela.tipo === "se_libera") {
    return (
      <span className="block rounded-md border border-[var(--widget-border)] bg-[var(--widget-bg)] px-3 py-2 text-[var(--widget-text-muted)]">
        No se te ha cobrado nada: los {importe} reservados en tu tarjeta se liberan.
      </span>
    );
  }
  return null;
}
