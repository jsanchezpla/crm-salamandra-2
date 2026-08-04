"use client";

import { useEffect, useMemo, useState } from "react";
import PasoTarjeta from "../_components/PasoTarjeta.jsx";
import { textoConsentimiento } from "../../../../../lib/citas/consentimientoRetencion.js";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AuthGateScreen, useWidgetAuth } from "../_components/AuthGate.jsx";
import { useCitasPortalSession } from "../_components/useCitasPortalSession.js";
import { formatMoney } from "../../../../../lib/payments/money.js";

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
  // Respuesta de la puerta de admisión cuando esta persona todavía no puede
  // reservar (ver lib/citas/puertaFormulario.js).
  const [puerta, setPuerta] = useState(null);
  const [success, setSuccess] = useState(null);
  // Paso de tarjeta: cuando está puesto, se pinta el formulario de Stripe en
  // lugar del formulario de datos. Ya no se sale del iframe a ninguna parte.
  const [pago, setPago] = useState(null);
  // La casilla de condiciones. Empieza SIN marcar a propósito: es la prueba de
  // que leyó que se le va a retener dinero, y una casilla premarcada no prueba
  // nada.
  const [aceptaRetencion, setAceptaRetencion] = useState(false);
  // Cómo quiere pagar el bono: de una vez o a plazos. Por defecto, de una vez
  // (es lo más barato para ella).
  const [pricingMode, setPricingMode] = useState("upfront");
  // Respuestas del formulario propio del tipo de cita, si lo tiene.
  const [formAnswers, setFormAnswers] = useState({});
  // Tarjeta ya validada y dinero retenido. NO es "cita confirmada": la solicitud
  // queda esperando a que la profesional decida, y decirle otra cosa al paciente
  // sería mentirle.
  const [solicitudEnviada, setSolicitudEnviada] = useState(null);

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

    // La casilla de la retención no aplica a un bono: ahí no se retiene nada,
    // se paga. Sin esta salvedad el botón se quedaba bloqueado para siempre,
    // porque la casilla ni siquiera se pinta.
    if (precio != null && !esBono && !aceptaRetencion) {
      setSubmitError("Tienes que aceptar las condiciones de la reserva para continuar");
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
          // Solo se manda si hay precio; el servidor lo exige en ese caso y
          // archiva la prueba con la sesión de pago. En un bono no hay
          // retención que aceptar: se paga entero.
          ...(precio != null && !esBono ? { aceptaRetencion } : {}),
          // Cómo quiere pagar el bono. El IMPORTE no viaja: lo pone el servidor
          // desde lo que configuró la profesional.
          ...(esBono ? { pricingMode } : {}),
          // Respuestas del formulario del tipo de cita. El servidor las valida
          // con las MISMAS reglas del módulo Formularios.
          ...(preguntas.length ? { formAnswers } : {}),
        }),
      });
      const j = await res.json();
      if (res.status === 409) {
        setSubmitError("Esa hora ya no está disponible. Te llevamos de vuelta…");
        setTimeout(() => router.push(`/widget/c/${tenantSlug}`), 1500);
        return;
      }
      if (res.status === 503) {
        // Tiene precio pero el profesional no ha terminado de configurar el cobro.
        throw new Error(j?.error || "El pago online no está disponible ahora mismo.");
      }
      // Puerta de admisión: no ha pasado por el formulario, o está sin revisar.
      // No es un error suyo, así que no se pinta en rojo con el resto: se le
      // enseña qué le falta y por dónde. Sus datos siguen en el formulario por
      // si vuelve.
      if (res.status === 403 && j?.codigo) {
        // `irAlPortal` lo manda la puerta de CONTRATOS (04/08/2026): allí no
        // hay un formulario al que ir, sino el área privada donde se firma.
        setPuerta({
          titulo: j.titulo,
          texto: j.error,
          urlFormulario: j.urlFormulario ?? null,
          irAlPortal: j.irAlPortal ?? false,
        });
        return;
      }
      if (!res.ok || !j.ok) {
        throw new Error(j?.error || "No se pudo confirmar la cita");
      }

      // ── Cita de pago ────────────────────────────────────────────────────
      // El backend ha creado una reserva provisional y devuelve lo necesario
      // para pintar el formulario de tarjeta AQUÍ MISMO. Antes se sacaba al
      // paciente del iframe hacia la página de Stripe, o sea que se le echaba de
      // la web de su nutricionista a mitad de la reserva.
      //
      // Al pasar a este paso NO hay dinero retenido todavía, y la cita aún no
      // existe para nadie: eso pasa cuando confirme la tarjeta.
      // ── Compra de un BONO ───────────────────────────────────────────────
      // Un bono no se retiene, se paga entero, y el pago fraccionado solo
      // existe en la pantalla de Stripe (Klarna no admite retenciones). Aquí sí
      // se sale del iframe, y a propósito: la alternativa sería pedirle los
      // datos de una financiación dentro de una web de terceros.
      if (j.data?.paymentRequired && j.data?.checkoutUrl) {
        window.location.href = j.data.checkoutUrl;
        return;
      }

      if (j.data?.paymentRequired && j.data?.clientSecret) {
        setPago({
          clientSecret: j.data.clientSecret,
          publishableKey: j.data.publishableKey,
          importe: j.data.amount,
          booking: j.data.booking,
        });
        return;
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

  // Precio EN CÉNTIMOS del tipo de cita. null = gratuita, y entonces todo el
  // flujo es el de siempre: ni se menciona el pago ni se pasa por Stripe.
  const precio = Number.isInteger(eventType?.price) && eventType.price > 0 ? eventType.price : null;

  // ── Bono de sesiones (04/08/2026) ─────────────────────────────────────────
  // Con `sessionsCount` a 1 —todo lo de hoy— nada de esto se pinta y el flujo
  // es exactamente el de siempre.
  // Preguntas propias de este tipo de cita (04/08/2026). Vacío = ninguna, que
  // es como se comportan todos los de hoy.
  // Las preguntas viven en el tipo de cita desde el 04/08/2026 (antes se
  // enganchaba un formulario del módulo Formularios).
  const preguntas = Array.isArray(eventType?.preguntas) ? eventType.preguntas : [];

  const sesiones = Number(eventType?.sessionsCount) || 1;
  const esBono = sesiones > 1;
  const fraccionado =
    esBono && Number(eventType?.instalmentPrice) > 0 && Number(eventType?.instalmentMonths) > 1
      ? {
          cuota: Number(eventType.instalmentPrice),
          meses: Number(eventType.instalmentMonths),
          total: Number(eventType.instalmentPrice) * Number(eventType.instalmentMonths),
        }
      : null;

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

  // ── Puerta de admisión ───────────────────────────────────────────────────
  // Todavía no puede reservar: le falta el formulario, o está sin revisar. Se
  // le enseña qué hacer, no un error. «Volver» conserva lo que había escrito.
  if (puerta) {
    return (
      <div className="min-h-screen bg-[var(--widget-bg)] px-4 py-10" style={brandStyle}>
        <div className="max-w-md mx-auto">
          <div className="rounded-lg border border-[var(--widget-border)] bg-[var(--widget-card)] p-6">
            <p className="text-[11px] tracking-[0.14em] uppercase text-[var(--widget-text-faint)] mb-2">
              Un paso antes
            </p>
            <h1
              className="text-[26px] leading-tight text-[var(--widget-text)] mb-3"
              style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}
            >
              {puerta.titulo}
            </h1>
            <p className="text-[13px] leading-relaxed text-[var(--widget-text-muted)] mb-6">
              {puerta.texto}
            </p>

            {puerta.urlFormulario && (
              <a
                href={puerta.urlFormulario}
                target="_top"
                rel="noopener"
                className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
              >
                Ir al formulario
                <span aria-hidden="true">→</span>
              </a>
            )}

            {puerta.irAlPortal && (
              <a
                href={`/widget/c/${tenantSlug}/mi-perfil`}
                target="_top"
                rel="noopener"
                className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
              >
                Ir a mi área privada
                <span aria-hidden="true">→</span>
              </a>
            )}

            <button
              type="button"
              onClick={() => setPuerta(null)}
              className="mt-3 w-full px-5 py-3 text-sm rounded-lg border border-[var(--widget-border)] text-[var(--widget-text-muted)] hover:text-[var(--widget-text)] transition"
            >
              Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Solicitud enviada (con tarjeta retenida) ─────────────────────────────
  // Deliberadamente NO dice "cita confirmada". Hay dinero retenido y una
  // solicitud en la lista de espera; la cita existe cuando la profesional la
  // confirme. Prometer aquí una cita confirmada es exactamente lo que hace que
  // alguien se presente a una hora que nadie le dio.
  if (solicitudEnviada) {
    return (
      <div className="min-h-screen bg-[var(--widget-bg)] px-4 py-10">
        <div className="max-w-md mx-auto">
          <div className="rounded-lg border border-[var(--widget-border)] bg-[var(--widget-card)] p-6">
            <p className="text-[11px] tracking-[0.14em] uppercase text-[var(--widget-text-faint)] mb-2">
              Solicitud enviada
            </p>
            <h1 className="text-[26px] leading-tight text-[var(--widget-text)] mb-3" style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}>
              Hemos recibido tu solicitud
            </h1>
            <p className="text-[13px] leading-relaxed text-[var(--widget-text-muted)] mb-5">
              {info?.name ?? "El profesional"} la revisará y te avisará por email en cuanto la
              confirme. Suele ser cuestión de horas.
            </p>

            <div className="space-y-2 border-t border-[var(--widget-border)] pt-4">
              <Row label="Servicio" value={solicitudEnviada.eventTypeName} />
              <Row label="Fecha propuesta" value={fmtLong(solicitudEnviada.scheduledAt)} extra="(hora de Madrid)" />
              <Row label="Duración" value={`${solicitudEnviada.duration} min`} />
            </div>

            <div className="mt-5 rounded-md border border-[var(--widget-border)] bg-[var(--widget-bg)] p-4">
              <p className="text-[13px] font-medium text-[var(--widget-text)] mb-1.5">
                No se te ha cobrado nada
              </p>
              <p className="text-[12px] leading-relaxed text-[var(--widget-text-muted)]">
                Hemos reservado {formatMoney(solicitudEnviada.importe)} en tu tarjeta para guardarte
                la hora. Tu banco puede mostrarlo como un cargo pendiente: no lo es. Solo se cobrará
                si se confirma la cita; si no, se libera solo.
              </p>
            </div>

            {solicitudEnviada.clientEmail && (
              <p className="text-[12px] text-[var(--widget-text-faint)] mt-4 text-center">
                Te hemos escrito a{" "}
                <b className="text-[var(--widget-text-muted)]">{solicitudEnviada.clientEmail}</b>.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Paso de tarjeta ───────────────────────────────────────────────────────
  if (pago) {
    return (
      <div className="min-h-screen bg-[var(--widget-bg)] px-4 py-10">
        <div className="max-w-md mx-auto">
          <div className="rounded-lg border border-[var(--widget-border)] bg-[var(--widget-card)] p-6">
            <p className="text-[11px] tracking-[0.14em] uppercase text-[var(--widget-text-faint)] mb-2">
              Último paso
            </p>
            <h1 className="text-[26px] leading-tight text-[var(--widget-text)] mb-3" style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}>
              Tus datos de pago
            </h1>

            <div className="space-y-2 border-b border-[var(--widget-border)] pb-4 mb-5">
              <Row label="Servicio" value={eventType?.name} />
              <Row label="Cuándo" value={fmtLong(datetime)} extra="(hora de Madrid)" />
              <Row label="Importe" value={formatMoney(pago.importe)} />
            </div>

            <PasoTarjeta
              clientSecret={pago.clientSecret}
              publishableKey={pago.publishableKey}
              importe={pago.importe}
              nombreServicio={eventType?.name}
              onListo={() =>
                setSolicitudEnviada({
                  ...pago.booking,
                  eventTypeName: pago.booking?.eventTypeName ?? eventType?.name,
                  importe: pago.importe,
                })
              }
            />
          </div>
        </div>
      </div>
    );
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

            {/* ── ¿Necesitas cancelar? ────────────────────────────────────────
                Con área privada se le manda allí: puede ver sus citas, los
                avisos y cancelar cuando quiera. Pedirle que se guarde una URL
                con un identificador dentro es pedirle que haga de archivador,
                y esa nota se pierde el mismo día.

                Sin área privada configurada se mantiene el enlace directo,
                porque entonces es lo ÚNICO que tiene para cancelar. Va como
                enlace normal, no como bloque de código a copiar. */}
            <div className="mt-6 pt-5 border-t border-[var(--widget-border)]/60 text-[13px] text-[var(--widget-text-muted)]">
              {info?.portalUrl ? (
                <>
                  ¿Necesitas cancelar o cambiar la cita? Puedes hacerlo desde{" "}
                  <a
                    href={info.portalUrl}
                    target="_top"
                    rel="noopener"
                    className="font-medium text-[var(--brand-primary,var(--widget-button))] hover:underline"
                  >
                    tu área privada
                  </a>
                  , con el mismo correo con el que has reservado.
                </>
              ) : (
                <>
                  ¿No puedes asistir?{" "}
                  <a
                    href={cancelUrl}
                    target="_top"
                    rel="noopener"
                    className="font-medium text-[var(--brand-primary,var(--widget-button))] hover:underline"
                  >
                    Cancela la cita aquí
                  </a>
                  . También tienes este enlace en el correo de confirmación.
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Estado FORM ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={brandStyle}>
      <header className="px-6 lg:px-10 py-6 border-b border-[var(--widget-border)] bg-[var(--widget-card)]">
        {/* max-w-6xl, igual que la pantalla de la que se viene (04/08/2026,
            Rodrigo: «parece de móvil, hay que scrollear»). Estaba en 3xl —la
            mitad de ancho— con el MISMO grid de tres columnas dentro, así que
            el calendario salía encajonado y en vertical según por dónde
            hubieras entrado. */}
        <div className="max-w-6xl mx-auto flex items-center gap-4">
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

      <div className="max-w-6xl mx-auto px-4 lg:px-10 py-6 lg:py-10">
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

              {/* Decía "A pagar ahora". Con el flujo de retención eso es
                  literalmente falso y contradecía al aviso de dos centímetros
                  más abajo ("no es un cobro"): la contradicción no la resuelve
                  el paciente, la sufre. */}
              {precio != null && (
                <div className="mt-3 pt-3 border-t border-[var(--widget-border)]/60 flex items-baseline justify-between">
                  <span className="text-[12px] text-[var(--widget-text-muted)]">Precio de la sesión</span>
                  <span
                    className="text-[17px] text-[var(--widget-text)] tracking-tight"
                    style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}
                  >
                    {formatMoney(precio)}
                  </span>
                </div>
              )}

              <div className="text-[12px] text-[var(--widget-text-muted)] mt-3 pt-3 border-t border-[var(--widget-border)]/60">
                {precio != null
                  ? "Reunión online · te confirmaremos la plaza por email."
                  : "Reunión online · enviaremos el enlace al confirmar."}
              </div>

              {precio != null && (
                <div className="text-[11px] text-[var(--widget-text-faint)] mt-2 leading-relaxed">
                  Una vez confirmada, cancelando con 24 h o más de antelación se te devuelve el
                  importe íntegro.
                </div>
              )}
            </div>
          </aside>

          {/* Form */}
          <form onSubmit={submit} className="lg:col-span-2 bg-[var(--widget-card)] rounded-lg border border-[var(--widget-border)] p-5 space-y-4">
            {submitError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                {submitError}
              </div>
            )}

            {/* Aviso por delante de la puerta de admisión: se dice AQUÍ, junto
                al email, y no solo al enviar, para que quien no haya pasado por
                el formulario no rellene la reserva entera para nada. */}
            {info?.admision?.requerida && (
              <div className="text-xs leading-relaxed text-[var(--widget-text-muted)] bg-[var(--widget-bg)] border border-[var(--widget-border)] rounded-md px-3 py-2.5">
                Para dar cita hace falta haber completado antes el formulario de primer contacto
                con el mismo correo que pongas aquí.
                {info.admision.urlFormulario && (
                  <>
                    {" "}
                    <a
                      href={info.admision.urlFormulario}
                      target="_top"
                      rel="noopener"
                      className="font-semibold text-[var(--brand-primary,var(--widget-button))] hover:underline"
                    >
                      Completar el formulario
                    </a>
                  </>
                )}
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

            {/* ── Preguntas del tipo de cita (04/08/2026) ────────────────────
                Van AQUÍ, después de haber elegido fecha y hora, que es lo que
                se pidió: una supervisión profesional necesita saber de qué caso
                se va a hablar antes de que llegue el día.

                Las define la profesional en el propio tipo de cita (Citas →
                Tipos de cita). Cuatro clases: número, escala de círculos, texto
                corto y texto largo — ver lib/citas/preguntasCita.js. */}
            {preguntas.length > 0 && (
              <fieldset className="rounded-md border border-[var(--widget-border)] bg-[var(--widget-bg)] p-3 space-y-3">
                <legend className="px-1 text-[12px] font-medium text-[var(--widget-text)]">
                  Antes de tu cita
                </legend>
                {preguntas.map((p) => {
                  const valor = formAnswers[p.id] ?? "";
                  const set = (v) => setFormAnswers((prev) => ({ ...prev, [p.id]: v }));

                  // Escala: círculos para tocar con el pulgar, no un desplegable.
                  // Es lo que se contesta de un toque en el móvil, que es donde
                  // se reserva casi siempre.
                  if (p.type === "escala") {
                    const tope = p.max ?? 5;
                    return (
                      <div key={p.id}>
                        <div className="text-[12px] text-[var(--widget-text)] mb-1.5">
                          {p.label}
                          {p.required && <span className="text-[var(--widget-text-faint)]"> *</span>}
                        </div>
                        {p.help && (
                          <p className="text-[11px] text-[var(--widget-text-faint)] mb-1.5">{p.help}</p>
                        )}
                        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={p.label}>
                          {Array.from({ length: tope }, (_, k) => k + 1).map((n) => {
                            const elegido = Number(valor) === n;
                            return (
                              <button
                                key={n}
                                type="button"
                                role="radio"
                                aria-checked={elegido}
                                onClick={() => set(n)}
                                className={`h-9 w-9 rounded-full text-[13px] font-medium border transition focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] ${
                                  elegido
                                    ? "bg-[var(--brand-primary,var(--widget-button))] text-white border-transparent"
                                    : "bg-[var(--widget-card)] text-[var(--widget-text-muted)] border-[var(--widget-border)] hover:border-[var(--widget-text-faint)]"
                                }`}
                              >
                                {n}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <Field key={p.id} label={p.label} required={p.required} help={p.help}>
                      {p.type === "largo" ? (
                        <textarea
                          value={valor}
                          onChange={(e) => set(e.target.value)}
                          rows={3}
                          maxLength={2000}
                          className={`${inputCls} min-h-[72px]`}
                        />
                      ) : (
                        <input
                          type={p.type === "numero" ? "number" : "text"}
                          inputMode={p.type === "numero" ? "decimal" : undefined}
                          value={valor}
                          onChange={(e) => set(e.target.value)}
                          maxLength={p.type === "numero" ? undefined : 200}
                          className={inputCls}
                        />
                      )}
                    </Field>
                  );
                })}
              </fieldset>
            )}

            {/* ── Cómo quiere pagar el bono ──────────────────────────────────
                La elección va AQUÍ y no en la pantalla de Stripe porque los dos
                importes son distintos (360 € de una vez frente a 3 × 130 = 390),
                y Stripe enseña todos los métodos con UN solo importe ya fijado.
                Se dice el total del fraccionado sin adornos: que financiar cuesta
                más se ve antes de elegir, no después. */}
            {esBono && fraccionado && (
              <fieldset className="rounded-md border border-[var(--widget-border)] bg-[var(--widget-bg)] p-3">
                <legend className="px-1 text-[12px] font-medium text-[var(--widget-text)]">
                  ¿Cómo prefieres pagar las {sesiones} sesiones?
                </legend>
                <div className="flex flex-col gap-2 mt-1">
                  {[
                    {
                      key: "upfront",
                      titulo: `Pago único: ${formatMoney(precio)}`,
                      pie: "Un solo cargo hoy.",
                    },
                    {
                      key: "instalment",
                      titulo: `${formatMoney(fraccionado.cuota)} al mes durante ${fraccionado.meses} meses`,
                      pie: `${formatMoney(fraccionado.total)} en total, financiado con Klarna.`,
                    },
                  ].map((opcion) => (
                    <label key={opcion.key} className="flex gap-2.5 items-start cursor-pointer">
                      <input
                        type="radio"
                        name="pricingMode"
                        checked={pricingMode === opcion.key}
                        onChange={() => setPricingMode(opcion.key)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-primary,var(--widget-button))]"
                      />
                      <span className="text-[12px] leading-relaxed">
                        <span className="text-[var(--widget-text)]">{opcion.titulo}</span>
                        <span className="block text-[var(--widget-text-faint)]">{opcion.pie}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {/* Condiciones de la retención. Solo aparecen si la cita se cobra, y
                la casilla NO viene marcada: es la prueba de que lo ha leído. Un
                BONO no se retiene, se paga entero: ahí no hay nada que aceptar. */}
            {precio != null && !esBono && (
              <label className="flex gap-2.5 items-start rounded-md border border-[var(--widget-border)] bg-[var(--widget-bg)] p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aceptaRetencion}
                  onChange={(e) => setAceptaRetencion(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-primary,var(--widget-button))]"
                />
                <span className="text-[12px] leading-relaxed text-[var(--widget-text-muted)]">
                  {textoConsentimiento(precio).map((f, i) => (
                    <span key={f} className={i === 0 ? "text-[var(--widget-text)]" : undefined}>
                      {f}{" "}
                    </span>
                  ))}
                </span>
              </label>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting || (precio != null && !esBono && !aceptaRetencion)}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-md text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] focus:ring-offset-2 focus:ring-offset-[var(--widget-bg)]"
              >
                {submitting
                  ? "Preparando…"
                  : precio != null
                    ? "Continuar al pago"
                    : "Confirmar reserva"}
              </button>
              {precio != null && !submitting && (
                <p className="text-[11px] text-[var(--widget-text-faint)] text-center mt-2">
                  {esBono
                    ? "Te llevamos a la pantalla de pago para completar la compra."
                    : "El siguiente paso son los datos de tu tarjeta. No se te cobrará nada todavía."}
                </p>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children, help }) {
  return (
    <label className="block">
      <div className="text-[11px] font-medium text-[var(--widget-text-muted)] mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </div>
      {children}
      {/* Ayuda de la pregunta, cuando la profesional la escribió (04/08/2026). */}
      {help && <div className="text-[11px] text-[var(--widget-text-faint)] mt-1">{help}</div>}
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
