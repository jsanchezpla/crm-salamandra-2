"use client";

/**
 * Gate de acceso al widget público de citas.
 *
 * Modelo: el widget se embebe como iframe en una web del tenant (p.ej.
 * tunutrilaura.com sobre WordPress). Cross-origin no se pueden leer las
 * cookies del padre, así que el padre debe pasar `?wpa=1` en el src del
 * iframe cuando el usuario está logueado. Detectado eso, lo guardamos en
 * sessionStorage para que sobreviva a la navegación interna del widget
 * (selección → /book).
 *
 * Si `info.auth.required` es false, el componente es transparente.
 */

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

const STORAGE_PREFIX = "crm-widget-auth";

function readSessionFlag(tenantSlug) {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(`${STORAGE_PREFIX}:${tenantSlug}`) === "1";
  } catch {
    return false;
  }
}

function writeSessionFlag(tenantSlug) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}:${tenantSlug}`, "1");
  } catch {
    /* sessionStorage puede estar bloqueada por el navegador */
  }
}

/**
 * Hook que resuelve si el usuario tiene acceso al widget.
 * Devuelve `{ ready, allowed }`:
 *   - ready=false → todavía no sabemos (primer render SSR/client)
 *   - allowed=true → puede ver el widget
 *   - allowed=false → mostrar el cartel de "inicia sesión"
 *
 * Hidratación: el primer render (SSR + primer client) devuelve ready=false
 * porque no podemos leer sessionStorage hasta tener `window`. Tras el mount,
 * el componente re-renderiza con el valor real.
 */
export function useWidgetAuth(authConfig) {
  const params = useParams();
  const search = useSearchParams();
  const tenantSlug = params?.tenantSlug;
  const wpaInUrl = search?.get("wpa") === "1";

  const [hydrated, setHydrated] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot client hydration
  useEffect(() => { setHydrated(true); }, []);

  // Persistimos el flag tras el primer mount cuando viene en la URL.
  useEffect(() => {
    if (authConfig?.required && wpaInUrl) writeSessionFlag(tenantSlug);
  }, [authConfig, wpaInUrl, tenantSlug]);

  if (!authConfig) return { ready: false, allowed: false };
  if (!authConfig.required) return { ready: true, allowed: true };
  if (!hydrated) return { ready: false, allowed: false };
  return { ready: true, allowed: wpaInUrl || readSessionFlag(tenantSlug) };
}

/**
 * Pantalla bloqueante que se muestra cuando el tenant exige login del padre
 * (WordPress, etc.) y todavía no se ha confirmado.
 */
export function AuthGateScreen({ info }) {
  const auth = info?.auth ?? {};
  const loginUrl = auth.loginUrl;
  const registerUrl = auth.registerUrl;

  const brandStyle = {};
  if (info?.brand?.primaryColor) brandStyle["--brand-primary"] = info.brand.primaryColor;
  if (info?.brand?.secondaryColor) brandStyle["--brand-secondary"] = info.brand.secondaryColor;

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

        <h1
          className="text-[24px] lg:text-[28px] leading-tight text-[var(--widget-text)] tracking-tight mb-2"
          style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}
        >
          Inicia sesión para reservar
        </h1>
        <p className="text-[14px] text-[var(--widget-text-muted)] leading-relaxed mb-6">
          Para pedir cita necesitas tener cuenta en la web de {info?.name ?? "la profesional"}.
          Inicia sesión o regístrate y vuelve a esta página.
        </p>

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

        {registerUrl && (
          <p className="mt-4 text-[13px] text-[var(--widget-text-muted)]">
            ¿Aún no tienes cuenta?{" "}
            <a
              href={registerUrl}
              target="_top"
              rel="noopener"
              className="font-semibold text-[var(--brand-primary,var(--widget-button))] hover:underline"
            >
              Regístrate
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
