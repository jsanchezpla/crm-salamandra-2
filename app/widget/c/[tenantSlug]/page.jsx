"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { AuthGateScreen, useWidgetAuth } from "./_components/AuthGate.jsx";
import { useCitasPortalSession } from "./_components/useCitasPortalSession.js";
import { useAdmision } from "./_components/useAdmision.js";
import PuertaScreen from "./_components/PuertaScreen.jsx";
import BienvenidaGate from "./_components/BienvenidaGate.jsx";
import { formatMoney } from "../../../../lib/payments/money.js";

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DAY_HEADERS_ES = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

function pad(n) { return String(n).padStart(2, "0"); }
function isoDate(year, month, day) { return `${year}-${pad(month)}-${pad(day)}`; }
function todayParts() {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const map = {};
  for (const p of f.formatToParts(new Date())) map[p.type] = p.value;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

export default function WidgetSelectionPage() {
  const router = useRouter();
  const params = useParams();
  const tenantSlug = params?.tenantSlug;

  const [info, setInfo] = useState(null);
  const [eventTypes, setEventTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [selectedEventTypeId, setSelectedEventTypeId] = useState(null);
  const [calendarYear, setCalendarYear] = useState(() => todayParts().year);
  const [calendarMonth, setCalendarMonth] = useState(() => todayParts().month);
  const [availableDays, setAvailableDays] = useState([]);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null); // "YYYY-MM-DD"
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedDatetime, setSelectedDatetime] = useState(null);

  /*
   * Enlace directo a UN tipo de cita (04/08/2026, Rodrigo): «poder enviar un
   * link de cita solo de un tipo de cita».
   *
   *   /widget/c/{tenant}?tipo=valoracion-inicial
   *
   * Va por el SLUG del tipo de cita y no por su id: el enlace se manda por
   * WhatsApp y se lee en voz alta, y un UUID de 36 caracteres no se puede ni
   * dictar ni comprobar de un vistazo. El slug ya existía y es único.
   *
   * Con el parámetro puesto se preselecciona ese tipo y la lista deja de
   * pintarse: quien recibe el enlace ve directamente el calendario. Sin él, la
   * pantalla se comporta como siempre. Si el slug no existe (renombrado, cita
   * desactivada) NO se rompe: se enseña la lista entera, que es lo que había
   * antes de que existiera esto.
   */
  const searchParams = useSearchParams();
  const tipoDelEnlace = searchParams.get("tipo");
  // Sin setter en la UI: un enlace de un solo tipo NO se puede abrir al resto
  // del catálogo desde la pantalla (ver el bloque "Tu cita" más abajo).
  const [soloUnTipo, setSoloUnTipo] = useState(false);

  // Sesión del portal (SSO de WordPress). Se canjea aquí arriba, ANTES de pedir
  // los tipos de cita, porque desde el 05/08/2026 la lista depende de quién
  // mira: los tipos ocultos solo se le enseñan a quien tiene bono. Además
  // pre-rellena y bloquea su email en /book, que es para lo que nació.
  const portal = useCitasPortalSession(tenantSlug);

  // ── Carga inicial: info + event-types ─────────────────────────────────────
  useEffect(() => {
    // Se espera a saber si hay sesión: pedir la lista antes devolvería la de
    // una anónima y la paciente no vería su programa hasta recargar.
    if (portal.status === "loading") return;
    let cancelled = false;
    async function load() {
      try {
        const [infoRes, typesRes] = await Promise.all([
          fetch(`/api/public/c/${tenantSlug}/info`, { cache: "no-store" }),
          portal.authFetch("/event-types", { cache: "no-store" }),
        ]);
        if (!infoRes.ok) throw new Error("Profesional no encontrado");
        if (!typesRes.ok) throw new Error("No hay tipos de cita disponibles");
        const infoJson = await infoRes.json();
        const typesJson = await typesRes.json();
        if (cancelled) return;
        setInfo(infoJson.data);
        const tipos = typesJson.data ?? [];
        setEventTypes(tipos);

        // El enlace manda: si trae un tipo que existe, se elige solo.
        const delEnlace = tipoDelEnlace
          ? tipos.find((t) => t.slug === tipoDelEnlace) ?? null
          : null;
        if (delEnlace) {
          setSelectedEventTypeId(delEnlace.id);
          setSoloUnTipo(true);
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantSlug, tipoDelEnlace, portal.status, portal.authFetch]);

  // ── Carga de días disponibles del mes según EventType y mes ───────────────
  useEffect(() => {
    if (!selectedEventTypeId) { setAvailableDays([]); return; }
    let cancelled = false;
    setLoadingMonth(true);
    fetch(
      `/api/public/c/${tenantSlug}/availability/month?eventTypeId=${selectedEventTypeId}&year=${calendarYear}&month=${calendarMonth}`,
      { cache: "no-store" }
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok) setAvailableDays(j.data.availableDays ?? []);
        else setAvailableDays([]);
      })
      .catch(() => { if (!cancelled) setAvailableDays([]); })
      .finally(() => { if (!cancelled) setLoadingMonth(false); });
    return () => { cancelled = true; };
  }, [tenantSlug, selectedEventTypeId, calendarYear, calendarMonth]);

  // ── Carga de slots del día seleccionado ───────────────────────────────────
  useEffect(() => {
    if (!selectedEventTypeId || !selectedDate) { setSlots([]); return; }
    let cancelled = false;
    setLoadingSlots(true);
    fetch(
      `/api/public/c/${tenantSlug}/availability?eventTypeId=${selectedEventTypeId}&date=${selectedDate}`,
      { cache: "no-store" }
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok) setSlots(j.data.slots ?? []);
        else setSlots([]);
      })
      .catch(() => { if (!cancelled) setSlots([]); })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
  }, [tenantSlug, selectedEventTypeId, selectedDate]);

  // Reset cascada al cambiar EventType
  function handleSelectEventType(id) {
    setSelectedEventTypeId(id);
    setSelectedDate(null);
    setSelectedDatetime(null);
    setSlots([]);
  }
  function handleSelectDate(d) {
    setSelectedDate(d);
    setSelectedDatetime(null);
  }

  const selectedEventType = useMemo(
    () => eventTypes.find((e) => e.id === selectedEventTypeId) ?? null,
    [eventTypes, selectedEventTypeId]
  );
  const maxAdvanceDays = useMemo(
    () => Math.max(60, ...eventTypes.map((e) => e.maxAdvanceDays ?? 60)),
    [eventTypes]
  );

  // Calcular mes máximo navegable
  const today = todayParts();
  const todayDateNum = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const maxDate = new Date(todayDateNum.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);
  const canGoNext = (calendarYear < maxDate.getUTCFullYear()) ||
    (calendarYear === maxDate.getUTCFullYear() && calendarMonth - 1 < maxDate.getUTCMonth());
  const canGoPrev = (calendarYear > today.year) ||
    (calendarYear === today.year && calendarMonth > today.month);

  function goPrevMonth() {
    if (!canGoPrev) return;
    if (calendarMonth === 1) { setCalendarYear((y) => y - 1); setCalendarMonth(12); }
    else { setCalendarMonth((m) => m - 1); }
  }
  function goNextMonth() {
    if (!canGoNext) return;
    if (calendarMonth === 12) { setCalendarYear((y) => y + 1); setCalendarMonth(1); }
    else { setCalendarMonth((m) => m + 1); }
  }

  // La sesión del portal decide si está identificada; el `?wpa=1` de la URL ya
  // no basta (ver la nota en AuthGate.jsx).
  const auth = useWidgetAuth(info?.auth, portal);

  // Su situación con el formulario. Se pregunta con la sesión del portal, así
  // que solo habla de ELLA: el endpoint no acepta correos por parámetro.
  const admision = useAdmision(tenantSlug, portal);

  /*
   * «¿A qué entras hoy?» TAMBIÉN aquí (06/08/2026, Rodrigo).
   *
   * La bifurcación existía solo en el área privada, y por eso no se veía: quien
   * pulsa RESERVAR CITA en la web no pasa por el perfil, entra directo a la
   * agenda. Se plantaba delante del catálogo entero de la consulta en su primera
   * visita —incluido el acompañamiento mensual— sin que nadie le hubiera
   * explicado que lo suyo es empezar por la valoración.
   *
   * NO se pregunta cuando:
   *   · el enlace ya trae un tipo (`?tipo=`): alguien decidió por ella a
   *     propósito, y esa decisión manda;
   *   · el centro no ha marcado ninguna valoración inicial;
   *   · ya tiene su valoración, próxima o pasada. Quien ya la reservó no vuelve
   *     a la casilla de salida cada vez que entra.
   */
  const valoracion = useMemo(
    () => eventTypes.find((t) => t.isInitialAssessment) ?? null,
    [eventTypes]
  );
  const [preguntarBienvenida, setPreguntarBienvenida] = useState(null); // null = aún no se sabe

  useEffect(() => {
    if (loading) return;
    if (!valoracion || tipoDelEnlace || !portal.sessionToken) {
      setPreguntarBienvenida(false);
      return;
    }
    let cancelado = false;
    portal
      .authFetch("/citas-portal/bookings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelado) return;
        const d = j?.data ?? {};
        const todas = [...(d.upcoming ?? []), ...(d.history ?? [])];
        setPreguntarBienvenida(!todas.some((b) => b.esValoracionInicial));
      })
      // Si no se pueden leer sus citas, no se pregunta: la agenda es lo que
      // había antes de existir esta pantalla, y es mejor que un muro.
      .catch(() => { if (!cancelado) setPreguntarBienvenida(false); });
    return () => { cancelado = true; };
  }, [loading, valoracion, tipoDelEnlace, portal.sessionToken, portal.authFetch]);

  const goContinue = useCallback(() => {
    if (!selectedEventTypeId || !selectedDatetime) return;
    const params = new URLSearchParams({
      eventTypeId: selectedEventTypeId,
      datetime: selectedDatetime,
    });
    // Si el padre WP nos dio ?wpa=1, propágalo a /book para que el gate
    // siga aceptando aunque sessionStorage no esté disponible.
    if (info?.auth?.required && auth.allowed) params.set("wpa", "1");
    router.push(`/widget/c/${tenantSlug}/book?${params.toString()}`);
  }, [router, tenantSlug, selectedEventTypeId, selectedDatetime, info, auth.allowed]);

  // CSS vars del brand (sobreescribe el botón si el tenant tiene primaryColor)
  const brandStyle = useMemo(() => {
    if (!info?.brand) return {};
    const out = {};
    if (info.brand.primaryColor) out["--brand-primary"] = info.brand.primaryColor;
    if (info.brand.secondaryColor) out["--brand-secondary"] = info.brand.secondaryColor;
    if (info.brand.accentColor) out["--brand-accent"] = info.brand.accentColor;
    return out;
  }, [info]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[var(--widget-text-muted)]">
        Cargando…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1
            className="text-2xl mb-2 text-[var(--widget-text)] tracking-tight"
            style={{ fontFamily: "var(--widget-font-display)" }}
          >
            No se puede cargar la reserva
          </h1>
          <p className="text-sm text-[var(--widget-text-muted)]">{loadError}</p>
        </div>
      </div>
    );
  }

  if (info?.auth?.required) {
    if (!auth.ready) {
      return (
        <div className="min-h-screen flex items-center justify-center text-sm text-[var(--widget-text-muted)]">
          Cargando…
        </div>
      );
    }
    if (!auth.allowed) return <AuthGateScreen info={info} />;
  }

  // ── ¿Le falta el formulario? (05/08/2026, Rodrigo) ────────────────────────
  // El aviso salía DESPUÉS de elegir día, hora y rellenar sus datos: quien
  // acababa de crearse la cuenta veía la agenda entera y solo al final se
  // enteraba de que antes hacía falta el formulario. Ahora se le dice aquí,
  // antes de que toque nada.
  //
  // Mientras se comprueba no se pinta la agenda: enseñarla medio segundo y
  // quitarla es peor que esperar.
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

  // «¿A qué entras hoy?» — va DESPUÉS de la admisión (primero el formulario) y
  // ANTES de la agenda. `null` es «todavía no se sabe»: se espera, igual que con
  // la admisión, para no pintar el catálogo y quitarlo medio segundo después.
  if (preguntarBienvenida === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[var(--widget-text-muted)]">
        Cargando…
      </div>
    );
  }
  if (preguntarBienvenida && valoracion) {
    return (
      <div style={brandStyle}>
        <BienvenidaGate
          profesional={info?.name}
          valoracion={valoracion}
          hrefValoracion={`/widget/c/${tenantSlug}?tipo=${encodeURIComponent(valoracion.slug)}`}
          // Al perfil con la elección hecha: `?perfil=1` para que allí no le
          // vuelvan a preguntar lo mismo nada más llegar.
          onEntrarPerfil={() => router.push(`/widget/c/${tenantSlug}/mi-perfil?perfil=1`)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={brandStyle}>
      {/* Header */}
      <header className="px-6 lg:px-10 py-6 border-b border-[var(--widget-border)] bg-[var(--widget-card)]">
        <div className="max-w-[1440px] mx-auto flex items-center gap-4">
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
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)]">
              Reserva tu cita
            </div>
            <h1
              className="text-[22px] lg:text-[26px] leading-tight text-[var(--widget-text)] truncate tracking-tight"
              style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}
            >
              {info?.name}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-[1440px] mx-auto px-4 lg:px-10 py-6 lg:py-10">
        {/* Columnas que se reparten solas, SIN punto de corte (04/08/2026).
            Primero fue `lg` (1024) y se apilaba dentro de la web de la
            profesional; luego `md` (768) y seguía apilándose, porque con el
            escalado de Windows al 125% ese hueco de ~940px en pantalla son 752
            para el navegador. Perseguir el número correcto es perder: depende
            del zoom, del theme y de la pantalla de cada uno.

            `auto-fit` + `minmax` deja que quepan las que quepan con un ancho
            digno: tres en cuanto hay sitio, menos si no lo hay, una en el
            móvil. Nadie tiene que acertar un número nunca más. */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-6">
          {/* Col 1 — cards de EventType */}
          <section>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-3">
              {soloUnTipo ? "Tu cita" : "Tipo de cita"}
            </div>
            {soloUnTipo && selectedEventType ? (
              /* Enlace directo: no hay nada que elegir, así que en vez de una
                 lista de un solo elemento se enseña lo que ha reservado y ya.
                 ⚠️ SIN salida al resto del catálogo (06/08/2026, Rodrigo). Hubo
                 un «Ver el resto de citas» y era justo lo contrario de para lo
                 que existe un enlace de un solo tipo: se manda para que esa
                 persona vea ESA cita y ninguna otra —una valoración inicial
                 gratuita, un tipo oculto asignado a dedo—. Enseñarle el catálogo
                 entero de la consulta con un clic vacía la decisión de quien
                 preparó el enlace. */
              <div className="bg-[var(--widget-card)] rounded-lg border border-[var(--brand-primary,var(--widget-button))] p-4">
                <div className="flex items-start gap-3">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                    style={{ background: selectedEventType.color || "var(--widget-button)" }}
                  />
                  <div className="min-w-0">
                    <div className="text-[15px] text-[var(--widget-text)]">{selectedEventType.name}</div>
                    <div className="text-[12px] text-[var(--widget-text-muted)] mt-0.5">
                      {selectedEventType.duration} min
                    </div>
                    {selectedEventType.description && (
                      <p className="text-[12px] text-[var(--widget-text-muted)] mt-1.5 leading-relaxed">
                        {selectedEventType.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : eventTypes.length === 0 ? (
              <div className="text-sm text-[var(--widget-text-muted)] bg-[var(--widget-card)] rounded-lg border border-[var(--widget-border)] p-4">
                No hay tipos de cita disponibles online en este momento.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {eventTypes.map((et) => {
                  const active = et.id === selectedEventTypeId;
                  return (
                    <button
                      key={et.id}
                      onClick={() => handleSelectEventType(et.id)}
                      className={`text-left bg-[var(--widget-card)] rounded-lg border p-4 transition focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] focus:ring-offset-1 focus:ring-offset-[var(--widget-bg)] ${
                        active
                          ? "border-[var(--brand-primary,var(--widget-button))] ring-2 ring-[var(--widget-focus)]"
                          : "border-[var(--widget-border)] hover:border-[var(--widget-button)]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                          style={{ background: et.color || "var(--brand-primary, var(--widget-button))" }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <div className="text-sm font-medium text-[var(--widget-text)] flex-1 min-w-0">
                              {et.name}
                            </div>
                            {/* El precio se ve ANTES de elegir: nadie debe descubrir
                                que la cita se paga al final del formulario. */}
                            {Number.isInteger(et.price) && et.price > 0 && (
                              <span className="text-[13px] text-[var(--widget-text)] shrink-0 tabular-nums">
                                {formatMoney(et.price)}
                              </span>
                            )}
                          </div>
                          {et.description && (
                            <div className="text-[12px] text-[var(--widget-text-muted)] mt-0.5 line-clamp-2">
                              {et.description}
                            </div>
                          )}
                          <div className="text-[11px] text-[var(--widget-text-faint)] mt-1.5">
                            {et.duration} min · Online
                            {/* Tipo oculto que se está viendo porque tiene bono
                                (05/08/2026). Se dice para que no parezca una
                                oferta más: es SU programa, ya pagado. */}
                            {et.soloParaTi && (
                              <span className="ml-1.5 text-[var(--brand-primary,var(--widget-button))]">
                                · tu programa
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Col 2 — calendario */}
          <section>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-3">
              Selecciona día
            </div>
            <div className={`bg-[var(--widget-card)] rounded-lg border border-[var(--widget-border)] p-4 ${!selectedEventTypeId ? "opacity-60" : ""}`}>
              {!selectedEventTypeId && (
                <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5 mb-3">
                  Selecciona primero un tipo de cita
                </div>
              )}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={goPrevMonth}
                  disabled={!canGoPrev}
                  className="p-1.5 rounded-md text-[var(--widget-text-muted)] hover:bg-[var(--widget-bg)] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
                  aria-label="Mes anterior"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 010 1.06L9.06 10l3.73 3.71a.75.75 0 11-1.06 1.06l-4.25-4.24a.75.75 0 010-1.06l4.25-4.24a.75.75 0 011.06 0z" clipRule="evenodd" />
                  </svg>
                </button>
                <div
                  className="text-[18px] text-[var(--widget-text)] tracking-tight"
                  style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}
                >
                  {MONTH_NAMES_ES[calendarMonth - 1]} {calendarYear}
                </div>
                <button
                  onClick={goNextMonth}
                  disabled={!canGoNext}
                  className="p-1.5 rounded-md text-[var(--widget-text-muted)] hover:bg-[var(--widget-bg)] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
                  aria-label="Mes siguiente"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 010-1.06L10.94 10 7.21 6.29a.75.75 0 111.06-1.06l4.25 4.24a.75.75 0 010 1.06l-4.25 4.24a.75.75 0 01-1.06 0z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              <CalendarGrid
                year={calendarYear}
                month={calendarMonth}
                today={today}
                availableDays={selectedEventTypeId ? availableDays : []}
                selectedDate={selectedDate}
                onSelectDate={handleSelectDate}
                loading={loadingMonth}
              />
              <div className="mt-3 flex items-center gap-3 text-[11px] text-[var(--widget-text-faint)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--brand-primary, var(--widget-button))" }} />
                  Disponible
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--widget-border)]" />
                  Sin huecos
                </span>
              </div>
            </div>
          </section>

          {/* Col 3 — slots horarios */}
          <section>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-3">
              Horario
            </div>
            <div className="bg-[var(--widget-card)] rounded-lg border border-[var(--widget-border)] p-4 min-h-[160px]">
              {!selectedDate && (
                <div className="text-[13px] text-[var(--widget-text-faint)] h-full flex items-center justify-center text-center">
                  Selecciona un día para ver las horas disponibles.
                </div>
              )}
              {selectedDate && loadingSlots && (
                <div className="text-[13px] text-[var(--widget-text-faint)] text-center py-6">Cargando…</div>
              )}
              {selectedDate && !loadingSlots && slots.length === 0 && (
                <div className="text-[13px] text-[var(--widget-text-muted)] text-center py-6">
                  Sin horas disponibles ese día.
                </div>
              )}
              {selectedDate && !loadingSlots && slots.length > 0 && (
                <>
                  <div className="text-[12px] text-[var(--widget-text-muted)] mb-2">
                    Hora de Madrid · {selectedEventType?.duration} min
                  </div>
                  <div className="grid grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
                    {slots.map((s) => {
                      const active = selectedDatetime === s.datetime;
                      return (
                        <button
                          key={s.datetime}
                          onClick={() => setSelectedDatetime(s.datetime)}
                          className={`px-2 py-2 text-[13px] rounded-md border transition focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] ${
                            active
                              ? "text-white border-transparent"
                              : "bg-[var(--widget-card)] text-[var(--widget-text)] border-[var(--widget-border)] hover:border-[var(--widget-button)] hover:bg-[var(--widget-bg)]"
                          }`}
                          style={active ? { backgroundColor: "var(--brand-primary, var(--widget-button))" } : undefined}
                        >
                          {s.time}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {selectedDatetime && (
              <div className="mt-4">
                <button
                  onClick={goContinue}
                  className="w-full px-4 py-2.5 text-sm font-medium rounded-md text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] focus:ring-offset-2 focus:ring-offset-[var(--widget-bg)]"
                >
                  Continuar →
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function CalendarGrid({ year, month, today, availableDays, selectedDate, onSelectDate, loading }) {
  // Lunes-first grid. Construimos celdas con offsets.
  const firstDayDate = new Date(Date.UTC(year, month - 1, 1));
  const jsDow = firstDayDate.getUTCDay(); // 0=domingo .. 6=sábado
  const leadingBlanks = (jsDow + 6) % 7; // lunes=0, domingo=6
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const availableSet = new Set(availableDays);
  const isToday = (d) => d === today.day && month === today.month && year === today.year;
  const todayDateNum = new Date(Date.UTC(today.year, today.month - 1, today.day)).getTime();

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1.5">
        {DAY_HEADERS_ES.map((h) => (
          <div key={h} className="text-center text-[10px] uppercase tracking-[0.16em] text-[var(--widget-text-faint)]">
            {h}
          </div>
        ))}
      </div>
      <div className={`grid grid-cols-7 gap-1 ${loading ? "opacity-50" : ""}`}>
        {cells.map((d, i) => {
          if (d == null) return <div key={`b${i}`} />;
          const iso = isoDate(year, month, d);
          const cellDateNum = new Date(Date.UTC(year, month - 1, d)).getTime();
          const isPast = cellDateNum < todayDateNum;
          const available = availableSet.has(d) && !isPast;
          const isSelected = selectedDate === iso;
          const today_ = isToday(d);

          let cls = "h-9 flex items-center justify-center text-[13px] rounded-md transition focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]";
          if (isSelected) {
            cls += " text-white";
          } else if (available) {
            cls += " text-[var(--widget-text)] bg-[var(--widget-focus)]/30 hover:bg-[var(--widget-focus)]/55 cursor-pointer";
          } else {
            cls += " text-[var(--widget-text-faint)]/60 cursor-not-allowed";
          }
          if (today_ && !isSelected) cls += " ring-1 ring-[var(--widget-focus)]";

          return (
            <button
              key={iso}
              disabled={!available}
              onClick={() => available && onSelectDate(iso)}
              className={cls}
              style={isSelected ? { backgroundColor: "var(--brand-primary, var(--widget-button))" } : undefined}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
