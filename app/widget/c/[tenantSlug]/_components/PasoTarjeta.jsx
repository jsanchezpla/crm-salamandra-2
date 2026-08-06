"use client";

import { useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { textoConsentimiento } from "../../../../../lib/citas/consentimientoRetencion.js";

/**
 * El formulario de tarjeta, DENTRO del widget.
 *
 * ── DOS COSAS QUE NO SE PUEDEN TOCAR ─────────────────────────────────────────
 * 1. Stripe.js viene de js.stripe.com a través de `@stripe/stripe-js`, NUNCA
 *    empaquetado con la app. Empaquetarlo rompe el cumplimiento PCI: el script
 *    dejaría de venir de un origen que Stripe controla.
 * 2. Los campos de la tarjeta los pinta un iframe de Stripe (`PaymentElement`),
 *    no HTML nuestro. En cuanto un input de tarjeta salga de nuestro propio
 *    marcado, salimos de SAQ A y entramos en un régimen de auditoría muy
 *    distinto. Es una línea que se cruza sin darse cuenta al "personalizar un
 *    poco" el formulario.
 *
 * `loadStripe` se llama fuera del componente por clave, y memoizado: crearlo en
 * cada render volvería a inyectar el script y a remontar el iframe, perdiendo lo
 * que el paciente llevara escrito.
 */
const cacheStripe = new Map();
function stripeDe(publishableKey) {
  if (!cacheStripe.has(publishableKey)) cacheStripe.set(publishableKey, loadStripe(publishableKey));
  return cacheStripe.get(publishableKey);
}

function euros(centimos) {
  return (centimos / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

/**
 * Aspecto del formulario de Stripe. Se le pasan los mismos colores y tipografías
 * del widget para que no parezca una pieza pegada de otro sitio: el paciente
 * está en la web de su nutricionista, no en una pasarela.
 *
 * Los valores se leen de las variables CSS ya calculadas porque Stripe necesita
 * colores literales — no entiende `var(--widget-card)`.
 */
function aparienciaDelWidget() {
  if (typeof window === "undefined") return {};
  const css = getComputedStyle(document.documentElement);
  const v = (n, fallback) => (css.getPropertyValue(n) || "").trim() || fallback;
  return {
    theme: "stripe",
    variables: {
      colorPrimary: v("--brand-primary", v("--widget-button", "#A97873")),
      colorBackground: v("--widget-card", "#ffffff"),
      colorText: v("--widget-text", "#1f2937"),
      colorDanger: "#b42318",
      fontFamily: v("--widget-font-body", "system-ui, sans-serif"),
      borderRadius: "6px",
      spacingUnit: "4px",
    },
  };
}

function Formulario({ importe, onListo, onError, nombreServicio }) {
  const stripe = useStripe();
  const elements = useElements();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [listoElemento, setListoElemento] = useState(false);

  const frases = useMemo(() => textoConsentimiento(importe), [importe]);

  async function enviar(e) {
    e.preventDefault();
    if (!stripe || !elements || enviando) return;
    setError(null);
    setEnviando(true);

    // `redirect: "if_required"` mantiene al paciente aquí siempre que se pueda.
    // El 3D Secure del banco se resuelve en una ventana de Stripe encima de esta
    // página; solo se saldría del widget si el banco exigiera una redirección
    // completa, que es el caso raro. El `return_url` es para ese caso.
    const { error: err, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });

    if (err) {
      // Stripe ya devuelve mensajes en el idioma del navegador y NUNCA revela el
      // motivo real de una tarjeta perdida o robada. No se enriquecen.
      setError(err.message || "No se ha podido validar la tarjeta.");
      setEnviando(false);
      onError?.(err);
      return;
    }

    if (paymentIntent?.status === "requires_capture") {
      // Retenido. La cita todavía no está en la lista de espera: eso lo hace el
      // webhook. Se avisa al padre para que enseñe "solicitud enviada", que es
      // la verdad — no "cita confirmada".
      onListo?.(paymentIntent);
      return;
    }

    setError("La tarjeta no ha quedado validada. Inténtalo de nuevo.");
    setEnviando(false);
  }

  /*
   * Red de seguridad por tiempo: hay bloqueadores que no fallan, simplemente
   * dejan la petición colgada, y entonces `onLoadError` no llega nunca.
   */
  useEffect(() => {
    if (listoElemento) return;
    const t = setTimeout(() => {
      setError((actual) =>
        actual ||
        "El formulario de pago está tardando más de la cuenta. Recarga la página; si vuelve a pasar, prueba con otro navegador o desactiva el bloqueador de anuncios."
      );
    }, 12_000);
    return () => clearTimeout(t);
  }, [listoElemento]);

  return (
    <form onSubmit={enviar} className="space-y-5">
      <div className="rounded-md border border-[var(--widget-border)] bg-[var(--widget-card)] p-4">
        <PaymentElement
          onReady={() => setListoElemento(true)}
          /*
           * ── UN FORMULARIO DE PAGO QUE NO CARGA TIENE QUE DECIRLO ───────────
           * (06/08/2026, Rodrigo: «Stripe se queda pillado en el pago».)
           *
           * Si Stripe no consigue montar el formulario —un bloqueador de
           * anuncios o de rastreadores que corta js.stripe.com, una red que no
           * le deja salir, un problema suyo—, el recuadro se queda en gris para
           * siempre: sin error, sin botón y sin ninguna pista de qué ha pasado.
           * Quien está intentando pagar se queda mirando una pantalla muerta y
           * lo normal es que se vaya.
           *
           * El error de Stripe se enseña tal cual (lo escribe él, en español y
           * para quien lo lee), y si no llega ninguno pero tampoco carga, a los
           * 12 segundos se le dice qué puede hacer.
           */
          onLoadError={(e) =>
            setError(
              e?.error?.message ||
                "No hemos podido cargar el formulario de pago. Si usas un bloqueador de anuncios, desactívalo en esta página o prueba con otro navegador."
            )
          }
          options={{ layout: "tabs", fields: { billingDetails: { address: "never" } } }}
        />
      </div>

      {/* El aviso va JUNTO a la tarjeta, no en la letra pequeña: es exactamente
          lo que el paciente va a ver en su banco dentro de un rato. */}
      <div className="rounded-md border border-[var(--widget-border)] bg-[var(--widget-bg)] p-4">
        <p className="text-[13px] font-medium text-[var(--widget-text)] mb-1.5">
          Todavía no te vamos a cobrar
        </p>
        <ul className="space-y-1">
          {frases.map((f) => (
            <li key={f} className="text-[12px] leading-relaxed text-[var(--widget-text-muted)]">
              {f}
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <p className="text-[13px] text-[#b42318] bg-[#fef3f2] border border-[#fecdca] rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!stripe || !listoElemento || enviando}
        className="w-full px-4 py-2.5 text-sm font-medium rounded-md text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)] focus:ring-offset-2 focus:ring-offset-[var(--widget-bg)]"
      >
        {enviando ? "Validando la tarjeta…" : `Reservar ${nombreServicio ? `“${nombreServicio}”` : ""}`.trim()}
      </button>

      <p className="text-[11px] text-center text-[var(--widget-text-faint)]">
        Se reservarán {euros(importe)} en tu tarjeta. Pago seguro con Stripe: tus datos no pasan por
        esta web.
      </p>
    </form>
  );
}

export default function PasoTarjeta({ clientSecret, publishableKey, importe, nombreServicio, onListo, onError }) {
  const stripePromise = useMemo(() => stripeDe(publishableKey), [publishableKey]);
  const opciones = useMemo(
    () => ({ clientSecret, appearance: aparienciaDelWidget(), locale: "es" }),
    [clientSecret]
  );

  if (!clientSecret || !publishableKey) return null;

  return (
    <Elements stripe={stripePromise} options={opciones}>
      <Formulario
        importe={importe}
        nombreServicio={nombreServicio}
        onListo={onListo}
        onError={onError}
      />
    </Elements>
  );
}
