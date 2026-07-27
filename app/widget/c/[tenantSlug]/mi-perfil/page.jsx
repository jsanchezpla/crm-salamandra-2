"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useCitasPortalSession } from "../_components/useCitasPortalSession.js";
import MisDocumentos from "../_components/MisDocumentos.jsx";

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

function BookingCard({ booking, muted, onCancel }) {
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

      {(booking.meetUrl || booking.cancellable) && (
        <div className="mt-3 flex flex-wrap gap-2">
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
  const { status, authFetch } = useCitasPortalSession(tenantSlug);

  const [data, setData] = useState(null); // { upcoming, history }
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState(null);

  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);

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

  useEffect(() => {
    if (status === "ready") loadBookings();
  }, [status, loadBookings]);

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
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)]">Mi perfil</div>
            <h1 className="text-[22px] lg:text-[26px] leading-tight text-[var(--widget-text)] truncate tracking-tight" style={headingStyle}>
              {info?.name}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 lg:px-10 py-6 lg:py-10">
        {loadingData && (
          <div className="text-[13px] text-[var(--widget-text-muted)] py-6">Cargando tus citas…</div>
        )}
        {dataError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 mb-4">
            {dataError}
          </div>
        )}

        <div className="space-y-10">
          {/* ── Mis citas ── */}
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-3">
              Mis citas
            </div>

            {isEmpty && (
              <div className="bg-[var(--widget-card)] rounded-xl border border-[var(--widget-border)] p-8 text-center">
                <h2 className="text-[20px] text-[var(--widget-text)] tracking-tight mb-2" style={headingStyle}>
                  Todavía no tienes citas
                </h2>
                <p className="text-sm text-[var(--widget-text-muted)] mb-5">
                  Cuando reserves una cita, aparecerá aquí.
                </p>
                <a
                  href={`/widget/c/${tenantSlug}`}
                  target="_top"
                  rel="noopener"
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md text-white bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
                >
                  Reservar una cita
                </a>
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
                        <BookingCard key={b.id} booking={b} onCancel={openCancel} />
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
          <MisDocumentos tenantSlug={tenantSlug} authFetch={authFetch} profesional={info?.name} />
        </div>
      </div>

      {/* Confirmación de cancelación */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-md bg-[var(--widget-card)] rounded-xl border border-[var(--widget-border)] p-6 shadow-xl">
            <h2 className="text-[20px] text-[var(--widget-text)] tracking-tight mb-1" style={headingStyle}>
              ¿Cancelar esta cita?
            </h2>
            <p className="text-sm text-[var(--widget-text-muted)] mb-4">
              Si confirmas, liberaremos el hueco para que otra persona pueda reservarlo.
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
