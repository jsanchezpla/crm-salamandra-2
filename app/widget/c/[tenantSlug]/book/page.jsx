"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AuthGateScreen, useWidgetAuth } from "../_components/AuthGate.jsx";
import { useCitasPortalSession } from "../_components/useCitasPortalSession.js";

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

function googleCalendarUrl({ name, description, start, durationMinutes, location }) {
  const startDate = new Date(start);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  const fmt = (d) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: name,
    dates: `${fmt(startDate)}/${fmt(endDate)}`,
    details: description ?? "",
    location: location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function WidgetBookPage() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const tenantSlug = params?.tenantSlug;
  const eventTypeId = search.get("eventTypeId");
  const datetime = search.get("datetime");

  const [info, setInfo] = useState(null);
  const [eventType, setEventType] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    additionalData: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!eventTypeId || !datetime) {
      router.replace(`/widget/c/${tenantSlug}`);
    }
  }, [router, tenantSlug, eventTypeId, datetime]);

  useEffect(() => {
    if (!eventTypeId) return;
    let cancelled = false;
    async function load() {
      try {
        const [infoRes, typesRes] = await Promise.all([
          fetch(`/api/public/c/${tenantSlug}/info`, { cache: "no-store" }),
          fetch(`/api/public/c/${tenantSlug}/event-types`, { cache: "no-store" }),
        ]);
        if (!infoRes.ok) throw new Error("Profesional no encontrado");
        const infoJson = await infoRes.json();
        const typesJson = await typesRes.json();
        if (cancelled) return;
        setInfo(infoJson.data);
        const found = (typesJson.data ?? []).find((e) => e.id === eventTypeId) ?? null;
        if (!found) throw new Error("Tipo de cita no disponible");
        setEventType(found);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantSlug, eventTypeId]);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(e) {
    e?.preventDefault?.();
    setSubmitError(null);

    if (!form.clientName.trim()) { setSubmitError("Nombre obligatorio"); return; }
    if (!form.clientEmail.trim()) { setSubmitError("Email obligatorio"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.clientEmail.trim())) {
      setSubmitError("Email inválido"); return;
    }
    if (!form.clientPhone.trim()) { setSubmitError("Teléfono obligatorio"); return; }
    if (eventType?.additionalDataRequired && !form.additionalData.trim()) {
      setSubmitError(`${eventType.additionalDataLabel || "Información adicional"} es obligatorio`);
      return;
    }

    setSubmitting(true);
    try {
      const headers = { "Content-Type": "application/json" };
      if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
      const res = await fetch(`/api/public/c/${tenantSlug}/book`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          eventTypeId,
          scheduledAt: datetime,
          clientName: form.clientName.trim(),
          clientEmail: form.clientEmail.trim(),
          clientPhone: form.clientPhone.trim(),
          additionalData: form.additionalData.trim() || null,
        }),
      });
      const j = await res.json();
      if (res.status === 409) {
        setSubmitError("Esa hora ya no está disponible. Te llevamos de vuelta…");
        setTimeout(() => router.push(`/widget/c/${tenantSlug}`), 1500);
        return;
      }
      if (!res.ok || !j.ok) {
        throw new Error(j?.error || "No se pudo confirmar la cita");
      }
      setSuccess(j.data.booking);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const auth = useWidgetAuth(info?.auth);

  // Sesión SSO: si el cliente está logueado en WordPress, su email va
  // pre-rellenado y bloqueado, y se envía el sessionToken en /book para que el
  // backend fuerce ese email (la cita queda ligada a su cuenta → "Mis citas").
  const { email: sessionEmail, sessionToken } = useCitasPortalSession(tenantSlug);
  const emailLocked = !!sessionEmail;

  useEffect(() => {
    if (sessionEmail) setForm((prev) => ({ ...prev, clientEmail: sessionEmail }));
  }, [sessionEmail]);

  const brandStyle = useMemo(() => {
    if (!info?.brand) return {};
    const out = {};
    if (info.brand.primaryColor) out["--brand-primary"] = info.brand.primaryColor;
    if (info.brand.secondaryColor) out["--brand-secondary"] = info.brand.secondaryColor;
    if (info.brand.accentColor) out["--brand-accent"] = info.brand.accentColor;
    return out;
  }, [info]);

  const inputCls =
    "w-full rounded-lg px-3 py-2 text-sm text-[var(--widget-text)] bg-[var(--widget-card)] border border-[var(--widget-border)] focus:outline-none focus:border-[var(--brand-primary,var(--widget-button))] focus:ring-2 focus:ring-[var(--widget-focus)] transition placeholder:text-[var(--widget-text-faint)]/80";

  if (!eventTypeId || !datetime) return null;
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
            No se puede completar la reserva
          </h1>
          <p className="text-sm text-[var(--widget-text-muted)] mb-4">{loadError}</p>
          <button
            onClick={() => router.push(`/widget/c/${tenantSlug}`)}
            className="text-sm text-[var(--widget-text-muted)] underline hover:text-[var(--widget-text)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] rounded-sm"
          >
            Volver al inicio
          </button>
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

  // ── Estado SUCCESS ────────────────────────────────────────────────────────
  if (success) {
    const cancelPath = `/widget/c/${tenantSlug}/cancel/${success.cancellationToken}`;
    const cancelUrl = typeof window !== "undefined" ? `${window.location.origin}${cancelPath}` : cancelPath;
    const gcalUrl = googleCalendarUrl({
      name: success.eventTypeName,
      description: `Reunión online con ${info?.name ?? ""}`,
      start: success.scheduledAt,
      durationMinutes: success.duration,
      location: success.meetUrl || "",
    });
    return (
      <div className="min-h-screen" style={brandStyle}>
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
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)]">Cita confirmada</div>
              <h1
                className="text-[22px] lg:text-[26px] leading-tight text-[var(--widget-text)] truncate tracking-tight"
                style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}
              >
                {info?.name}
              </h1>
            </div>
          </div>
        </header>

        <div className="max-w-2xl mx-auto px-4 lg:px-10 py-10">
          <div className="bg-[var(--widget-card)] rounded-xl border border-[var(--widget-border)] p-6 lg:p-8">
            <div className="flex items-center gap-3 mb-5">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white"
                style={{ backgroundColor: "var(--brand-primary, var(--widget-button))" }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M16.704 5.296a1 1 0 010 1.414l-7.5 7.5a1 1 0 01-1.414 0l-3.5-3.5a1 1 0 011.414-1.414L8.5 12.086l6.793-6.79a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h2
                  className="text-[26px] leading-tight text-[var(--widget-text)] tracking-tight"
                  style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}
                >
                  Cita confirmada
                </h2>
                <div className="text-[13px] text-[var(--widget-text-muted)]">Hemos guardado tu reserva.</div>
              </div>
            </div>

            <div className="space-y-2.5 text-[14px] border-t border-[var(--widget-border)]/60 pt-5">
              <Row label="Servicio" value={success.eventTypeName} />
              <Row label="Cuándo" value={fmtLong(success.scheduledAt)} extra="(hora de Madrid)" />
              <Row label="Duración" value={`${success.duration} min`} />
              <Row label="Modalidad" value="Reunión online" />
            </div>

            {success.meetUrl && (
              <a
                href={success.meetUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md text-white bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] focus:ring-offset-2 focus:ring-offset-[var(--widget-bg)]"
              >
                Unirse a Google Meet
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M6 3a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 11-2 0V5.414L7.707 10.707a1 1 0 01-1.414-1.414L11.586 4H7a1 1 0 01-1-1zM3 5a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2v-2a1 1 0 10-2 0v2H3V7h2a1 1 0 100-2H3z" />
                </svg>
              </a>
            )}

            <div className="mt-5 pt-5 border-t border-[var(--widget-border)]/60 space-y-3 text-[13px]">
              <div className="text-[var(--widget-text-muted)]">
                Hemos enviado los detalles de tu reserva a <b className="text-[var(--widget-text)]">{success.clientEmail}</b>.
              </div>
              <a
                href={gcalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[var(--widget-text-muted)] hover:text-[var(--widget-text)] underline focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] rounded-sm"
              >
                Añadir a Google Calendar
              </a>
            </div>

            <details className="mt-6 pt-5 border-t border-[var(--widget-border)]/60 text-[13px]">
              <summary className="cursor-pointer text-[var(--widget-text-muted)] hover:text-[var(--widget-text)]">
                ¿Necesitas cancelar?
              </summary>
              <div className="mt-2 text-[var(--widget-text-muted)] space-y-2">
                <div>Guarda este enlace para cancelar la cita si lo necesitas:</div>
                <code className="block bg-[var(--widget-bg)] border border-[var(--widget-border)] rounded-md px-2.5 py-1.5 text-[12px] break-all text-[var(--widget-text)]">
                  {cancelUrl}
                </code>
              </div>
            </details>
          </div>
        </div>
      </div>
    );
  }

  // ── Estado FORM ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={brandStyle}>
      <header className="px-6 lg:px-10 py-6 border-b border-[var(--widget-border)] bg-[var(--widget-card)]">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <button
            onClick={() => router.push(`/widget/c/${tenantSlug}`)}
            className="text-[var(--widget-text-muted)] hover:text-[var(--widget-text)] p-1.5 rounded-md hover:bg-[var(--widget-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            aria-label="Volver"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 010 1.06L9.06 10l3.73 3.71a.75.75 0 11-1.06 1.06l-4.25-4.24a.75.75 0 010-1.06l4.25-4.24a.75.75 0 011.06 0z" clipRule="evenodd" />
            </svg>
          </button>
          {info?.brand?.logoUrl ? (
            <img src={info.brand.logoUrl} alt="" className="h-9 w-auto" />
          ) : (
            <div
              className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-semibold"
              style={{ backgroundColor: "var(--brand-primary, var(--widget-button))" }}
            >
              {info?.name?.[0]?.toUpperCase() ?? "·"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)]">Tus datos</div>
            <h1
              className="text-[22px] lg:text-[26px] leading-tight text-[var(--widget-text)] truncate tracking-tight"
              style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}
            >
              {info?.name}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 lg:px-10 py-6 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Resumen */}
          <aside className="lg:col-span-1">
            <div className="bg-[var(--widget-card)] rounded-lg border border-[var(--widget-border)] p-4 text-[13px]">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-2">
                Estás reservando
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: eventType?.color || "var(--brand-primary, var(--widget-button))" }}
                />
                <span className="font-medium text-[var(--widget-text)]">{eventType?.name}</span>
              </div>
              <div className="text-[var(--widget-text)]">{fmtLong(datetime)}</div>
              <div className="text-[12px] text-[var(--widget-text-faint)] mt-1">
                {eventType?.duration} min · Hora de Madrid
              </div>
              <div className="text-[12px] text-[var(--widget-text-muted)] mt-3 pt-3 border-t border-[var(--widget-border)]/60">
                Reunión online · enviaremos el enlace al confirmar.
              </div>
            </div>
          </aside>

          {/* Form */}
          <form onSubmit={submit} className="lg:col-span-2 bg-[var(--widget-card)] rounded-lg border border-[var(--widget-border)] p-5 space-y-4">
            {submitError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                {submitError}
              </div>
            )}

            <Field label="Nombre y apellidos" required>
              <input
                type="text"
                value={form.clientName}
                onChange={(e) => updateField("clientName", e.target.value)}
                autoComplete="name"
                className={inputCls}
                placeholder="Tu nombre completo"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Email" required>
                <input
                  type="email"
                  value={form.clientEmail}
                  onChange={(e) => { if (!emailLocked) updateField("clientEmail", e.target.value); }}
                  readOnly={emailLocked}
                  autoComplete="email"
                  className={`${inputCls}${emailLocked ? " bg-[var(--widget-bg)] text-[var(--widget-text-muted)] cursor-not-allowed" : ""}`}
                  placeholder="tu@email.com"
                />
                {emailLocked && (
                  <p className="text-[11px] text-[var(--widget-text-faint)] mt-1">Es el email de tu cuenta.</p>
                )}
              </Field>
              <Field label="Teléfono" required>
                <input
                  type="tel"
                  value={form.clientPhone}
                  onChange={(e) => updateField("clientPhone", e.target.value)}
                  autoComplete="tel"
                  className={inputCls}
                  placeholder="+34 600 000 000"
                />
              </Field>
            </div>

            <Field
              label={eventType?.additionalDataLabel || "Información adicional"}
              required={!!eventType?.additionalDataRequired}
            >
              <textarea
                value={form.additionalData}
                onChange={(e) => updateField("additionalData", e.target.value)}
                rows={4}
                className={`${inputCls} min-h-[88px]`}
                placeholder="Cualquier dato útil para la consulta (opcional)."
              />
            </Field>

            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-md text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] focus:ring-offset-2 focus:ring-offset-[var(--widget-bg)]"
              >
                {submitting ? "Confirmando…" : "Confirmar reserva"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-medium text-[var(--widget-text-muted)] mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </div>
      {children}
    </label>
  );
}

function Row({ label, value, extra }) {
  return (
    <div className="flex">
      <div className="w-28 text-[var(--widget-text-faint)]">{label}</div>
      <div className="flex-1 text-[var(--widget-text)]">
        {value} {extra && <span className="text-[var(--widget-text-faint)] text-[12px]">{extra}</span>}
      </div>
    </div>
  );
}
