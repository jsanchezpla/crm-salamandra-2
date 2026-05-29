"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";

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

  // ── Carga inicial: info + event-types ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [infoRes, typesRes] = await Promise.all([
          fetch(`/api/public/c/${tenantSlug}/info`, { cache: "no-store" }),
          fetch(`/api/public/c/${tenantSlug}/event-types`, { cache: "no-store" }),
        ]);
        if (!infoRes.ok) throw new Error("Profesional no encontrado");
        if (!typesRes.ok) throw new Error("No hay tipos de cita disponibles");
        const infoJson = await infoRes.json();
        const typesJson = await typesRes.json();
        if (cancelled) return;
        setInfo(infoJson.data);
        setEventTypes(typesJson.data ?? []);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantSlug]);

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

  const goContinue = useCallback(() => {
    if (!selectedEventTypeId || !selectedDatetime) return;
    const params = new URLSearchParams({
      eventTypeId: selectedEventTypeId,
      datetime: selectedDatetime,
    });
    router.push(`/widget/c/${tenantSlug}/book?${params.toString()}`);
  }, [router, tenantSlug, selectedEventTypeId, selectedDatetime]);

  // CSS vars del brand
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
      <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">
        Cargando…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-medium text-neutral-900 mb-2">No se puede cargar la reserva</h1>
          <p className="text-sm text-neutral-600">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={brandStyle}>
      {/* Header */}
      <header className="px-6 lg:px-10 py-6 border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          {info?.brand?.logoUrl ? (
            <img src={info.brand.logoUrl} alt="" className="h-10 w-auto" />
          ) : (
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
              style={{ backgroundColor: "var(--brand-primary, #3F6E5B)" }}
            >
              {info?.name?.[0]?.toUpperCase() ?? "·"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400">Reserva tu cita</div>
            <h1 className="text-base lg:text-lg font-semibold text-neutral-900 truncate">{info?.name}</h1>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 lg:px-10 py-6 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Col 1 — cards de EventType */}
          <section>
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3">Tipo de cita</div>
            {eventTypes.length === 0 ? (
              <div className="text-sm text-neutral-500 bg-white rounded-lg border border-neutral-200 p-4">
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
                      className={`text-left bg-white rounded-lg border p-4 transition ${
                        active
                          ? "border-[var(--brand-primary,#3F6E5B)] ring-2 ring-[var(--brand-primary,#3F6E5B)]/15"
                          : "border-neutral-200 hover:border-neutral-300"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                          style={{ background: et.color || "var(--brand-primary, #3F6E5B)" }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-neutral-900">{et.name}</div>
                          {et.description && (
                            <div className="text-[12px] text-neutral-500 mt-0.5 line-clamp-2">{et.description}</div>
                          )}
                          <div className="text-[11px] text-neutral-400 mt-1.5">
                            {et.duration} min · Online
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
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3">Selecciona día</div>
            <div className={`bg-white rounded-lg border border-neutral-200 p-4 ${!selectedEventTypeId ? "opacity-60" : ""}`}>
              {!selectedEventTypeId && (
                <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5 mb-3">
                  Selecciona primero un tipo de cita
                </div>
              )}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={goPrevMonth}
                  disabled={!canGoPrev}
                  className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Mes anterior"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 010 1.06L9.06 10l3.73 3.71a.75.75 0 11-1.06 1.06l-4.25-4.24a.75.75 0 010-1.06l4.25-4.24a.75.75 0 011.06 0z" clipRule="evenodd" />
                  </svg>
                </button>
                <div className="text-sm font-medium text-neutral-800">
                  {MONTH_NAMES_ES[calendarMonth - 1]} {calendarYear}
                </div>
                <button
                  onClick={goNextMonth}
                  disabled={!canGoNext}
                  className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
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
              <div className="mt-3 flex items-center gap-3 text-[11px] text-neutral-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--brand-primary, #3F6E5B)" }} />
                  Disponible
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-neutral-200" />
                  Sin huecos
                </span>
              </div>
            </div>
          </section>

          {/* Col 3 — slots horarios */}
          <section>
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3">Horario</div>
            <div className="bg-white rounded-lg border border-neutral-200 p-4 min-h-[160px]">
              {!selectedDate && (
                <div className="text-[13px] text-neutral-400 h-full flex items-center justify-center text-center">
                  Selecciona un día para ver las horas disponibles.
                </div>
              )}
              {selectedDate && loadingSlots && (
                <div className="text-[13px] text-neutral-400 text-center py-6">Cargando…</div>
              )}
              {selectedDate && !loadingSlots && slots.length === 0 && (
                <div className="text-[13px] text-neutral-500 text-center py-6">
                  Sin horas disponibles ese día.
                </div>
              )}
              {selectedDate && !loadingSlots && slots.length > 0 && (
                <>
                  <div className="text-[12px] text-neutral-500 mb-2">
                    Hora de Madrid · {selectedEventType?.duration} min
                  </div>
                  <div className="grid grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
                    {slots.map((s) => {
                      const active = selectedDatetime === s.datetime;
                      return (
                        <button
                          key={s.datetime}
                          onClick={() => setSelectedDatetime(s.datetime)}
                          className={`px-2 py-2 text-[13px] rounded-md border transition ${
                            active
                              ? "bg-[var(--brand-primary,#3F6E5B)] text-white border-[var(--brand-primary,#3F6E5B)]"
                              : "bg-white text-neutral-700 border-neutral-200 hover:border-[var(--brand-primary,#3F6E5B)]/40 hover:bg-neutral-50"
                          }`}
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
                  className="w-full px-4 py-2.5 text-sm font-medium rounded-md text-white transition hover:opacity-90"
                  style={{ backgroundColor: "var(--brand-primary, #3F6E5B)" }}
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
          <div key={h} className="text-center text-[10px] uppercase tracking-wider text-neutral-400">{h}</div>
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

          let cls = "h-9 flex items-center justify-center text-[13px] rounded-md transition";
          if (isSelected) {
            cls += " text-white";
          } else if (available) {
            cls += " text-neutral-800 bg-[var(--brand-primary,#3F6E5B)]/8 hover:bg-[var(--brand-primary,#3F6E5B)]/15 cursor-pointer";
          } else {
            cls += " text-neutral-300 cursor-not-allowed";
          }
          if (today_ && !isSelected) cls += " ring-1 ring-[var(--brand-primary,#3F6E5B)]/30";

          return (
            <button
              key={iso}
              disabled={!available}
              onClick={() => available && onSelectDate(iso)}
              className={cls}
              style={isSelected ? { backgroundColor: "var(--brand-primary, #3F6E5B)" } : undefined}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
