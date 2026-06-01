"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

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

export default function WidgetCancelPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug;
  const token = params?.token;

  const [info, setInfo] = useState(null);
  const [booking, setBooking] = useState(null);
  const [state, setState] = useState("loading"); // loading|ready|done|gone|notfound|error
  const [errorMsg, setErrorMsg] = useState(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!tenantSlug || !token) return;
    let cancelled = false;
    async function load() {
      try {
        const [infoRes, bRes] = await Promise.all([
          fetch(`/api/public/c/${tenantSlug}/info`, { cache: "no-store" }),
          fetch(`/api/public/c/${tenantSlug}/booking/${token}`, { cache: "no-store" }),
        ]);
        if (!infoRes.ok) throw new Error("Profesional no encontrado");
        const infoJson = await infoRes.json();
        if (cancelled) return;
        setInfo(infoJson.data);

        if (bRes.status === 404) { setState("notfound"); return; }
        if (bRes.status === 410) {
          const j = await bRes.json();
          setErrorMsg(j?.error || "Esta cita ya no se puede cancelar");
          setState("gone");
          return;
        }
        const bJson = await bRes.json();
        if (!bJson.ok) throw new Error(bJson?.error || "Error cargando la reserva");
        setBooking(bJson.data);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err.message);
        setState("error");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantSlug, token]);

  async function submitCancel() {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/public/c/${tenantSlug}/cancel/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      if (res.status === 410) {
        const j = await res.json();
        setErrorMsg(j?.error || "Esta cita ya no se puede cancelar");
        setState("gone");
        return;
      }
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error || "No se pudo cancelar");
      setState("done");
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const brandStyle = useMemo(() => {
    if (!info?.brand) return {};
    const out = {};
    if (info.brand.primaryColor) out["--brand-primary"] = info.brand.primaryColor;
    if (info.brand.secondaryColor) out["--brand-secondary"] = info.brand.secondaryColor;
    if (info.brand.accentColor) out["--brand-accent"] = info.brand.accentColor;
    return out;
  }, [info]);

  const headingStyle = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };

  return (
    <div className="min-h-screen" style={brandStyle}>
      <header className="px-6 lg:px-10 py-6 border-b border-[var(--widget-border)] bg-[var(--widget-card)]">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
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
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)]">Cancelar cita</div>
            <h1
              className="text-[22px] lg:text-[26px] leading-tight text-[var(--widget-text)] truncate tracking-tight"
              style={headingStyle}
            >
              {info?.name}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 lg:px-10 py-10">
        <div className="bg-[var(--widget-card)] rounded-xl border border-[var(--widget-border)] p-6 lg:p-8">
          {state === "loading" && (
            <div className="text-sm text-[var(--widget-text-muted)]">Cargando reserva…</div>
          )}

          {state === "notfound" && (
            <div>
              <h2 className="text-2xl mb-2 text-[var(--widget-text)] tracking-tight" style={headingStyle}>
                No encontramos esa reserva
              </h2>
              <p className="text-sm text-[var(--widget-text-muted)]">
                Es posible que el enlace esté caducado o sea incorrecto.
              </p>
            </div>
          )}

          {state === "gone" && (
            <div>
              <h2 className="text-2xl mb-2 text-[var(--widget-text)] tracking-tight" style={headingStyle}>
                Esta cita ya no se puede cancelar
              </h2>
              <p className="text-sm text-[var(--widget-text-muted)]">{errorMsg ?? "Ya fue cancelada o ya ha pasado."}</p>
            </div>
          )}

          {state === "error" && (
            <div>
              <h2 className="text-2xl mb-2 text-[var(--widget-text)] tracking-tight" style={headingStyle}>
                Algo ha fallado
              </h2>
              <p className="text-sm text-[var(--widget-text-muted)]">{errorMsg}</p>
            </div>
          )}

          {state === "ready" && booking && (
            <>
              <h2 className="text-2xl mb-2 text-[var(--widget-text)] tracking-tight" style={headingStyle}>
                ¿Quieres cancelar esta cita?
              </h2>
              <p className="text-sm text-[var(--widget-text-muted)] mb-5">
                Si confirmas, liberaremos el hueco para que otra persona pueda reservarlo.
              </p>

              <div className="bg-[var(--widget-bg)] rounded-lg border border-[var(--widget-border)] p-4 text-[14px] mb-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ background: booking.eventTypeColor || "var(--brand-primary, var(--widget-button))" }}
                  />
                  <span className="font-medium text-[var(--widget-text)]">{booking.eventTypeName}</span>
                </div>
                <div className="text-[var(--widget-text)]">{fmtLong(booking.scheduledAt)}</div>
                <div className="text-[12px] text-[var(--widget-text-muted)]">
                  {booking.duration} min · A nombre de {booking.clientName}
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-[11px] font-medium text-[var(--widget-text-muted)] mb-1">
                  Motivo (opcional)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm text-[var(--widget-text)] bg-[var(--widget-card)] border border-[var(--widget-border)] focus:outline-none focus:border-[var(--brand-primary,var(--widget-button))] focus:ring-2 focus:ring-[var(--widget-focus)] min-h-[80px] placeholder:text-[var(--widget-text-faint)]/80"
                  placeholder="Si nos cuentas el motivo, nos ayudas a mejorar."
                />
              </div>

              {errorMsg && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 mb-3">
                  {errorMsg}
                </div>
              )}

              <button
                onClick={submitCancel}
                disabled={submitting}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2 focus:ring-offset-[var(--widget-bg)]"
              >
                {submitting ? "Cancelando…" : "Sí, cancelar la cita"}
              </button>
            </>
          )}

          {state === "done" && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M16.704 5.296a1 1 0 010 1.414l-7.5 7.5a1 1 0 01-1.414 0l-3.5-3.5a1 1 0 011.414-1.414L8.5 12.086l6.793-6.79a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <h2 className="text-2xl text-[var(--widget-text)] tracking-tight" style={headingStyle}>
                  Cita cancelada correctamente
                </h2>
              </div>
              <p className="text-sm text-[var(--widget-text-muted)]">
                Hemos liberado el hueco. Si más adelante quieres reservar de nuevo, puedes hacerlo desde la web.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
