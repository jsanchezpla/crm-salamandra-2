"use client";

import { useEffect, useRef } from "react";

/**
 * SessionKeeper — mantiene viva la sesión refrescando el access token antes de
 * que caduque.
 *
 * En producción el access token vive 15 min (lib/auth/jwt.js) y el refresh token
 * 7 días, pero NADA llamaba a `/api/auth/refresh` desde el front: a los 15 min el
 * middleware redirigía a /login. Este componente, montado una vez en el layout
 * del dashboard (persiste entre navegaciones SPA), llama al refresh:
 *   - cada 12 min (margen sobre los 15 de vida del access token), y
 *   - al volver a la pestaña si hace ≥10 min del último refresco.
 *
 * El endpoint rota el refresh token en cada llamada; por eso se throttlea el
 * refresco por foco para no rotar en exceso. Si el refresh token está caducado
 * (7 días) o revocado, el endpoint responde 401 y mandamos a /login.
 *
 * ── Rescate de sesión caducada (2026-07-22) ──────────────────────────────────
 * Además instala un interceptor global de `fetch`. Motivo: para las rutas
 * /api/* el middleware NO redirige, devuelve un 401 JSON; y como en el CRM hay
 * ~188 llamadas repartidas por 39 ficheros, cada una gestionaba (o ignoraba)
 * ese 401 por su cuenta. Resultado: al caducar la sesión te quedabas en la
 * pantalla y cada botón soltaba un "No autorizado" críptico — parecía un fallo
 * de permisos. Ahora el primer 401 de cualquier llamada del CRM te lleva al
 * login, que ya sabe explicar "Tu sesión ha expirado" con ?expired=1.
 *
 * Antes de rendirse INTENTA UN REFRESH: un 401 suele ser solo el access token
 * (15 min) caducado mientras el refresh token (7 días) sigue vivo. Si el
 * refresh funciona, se reintenta la petición original y el usuario no se entera
 * de nada. Solo si el refresh también falla se manda al login.
 */
const REFRESH_INTERVAL_MS = 12 * 60 * 1000;
const MIN_GAP_MS = 10 * 60 * 1000;

// Rutas que el interceptor NO debe tocar: las de auth gestionan sus propios
// 401 (el login responde 401 con "credenciales inválidas" — redirigir ahí
// sería un bucle), y las públicas no dependen de sesión.
const AUTH_EXEMPT = ["/api/auth/", "/api/public/", "/api/external/", "/api/webhooks/"];

function sameOriginApiPath(input) {
  try {
    const url = new URL(typeof input === "string" ? input : input?.url ?? "", window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return url.pathname.startsWith("/api/") ? url.pathname : null;
  } catch {
    return null;
  }
}

function goToLogin() {
  // `next` para volver donde estabas tras entrar de nuevo.
  const here = window.location.pathname + window.location.search;
  const url = new URL("/login", window.location.origin);
  url.searchParams.set("expired", "1");
  if (here && here !== "/" && !here.startsWith("/login")) url.searchParams.set("next", here);
  window.location.href = url.toString();
}

export default function SessionKeeper() {
  const lastRef = useRef(Date.now());
  const inFlightRef = useRef(false);

  useEffect(() => {
    let stopped = false;

    const refresh = async (force) => {
      if (inFlightRef.current) return;
      const now = Date.now();
      if (!force && now - lastRef.current < MIN_GAP_MS) return;
      inFlightRef.current = true;
      lastRef.current = now;
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST", cache: "no-store" });
        if (res.status === 401 && !stopped) {
          window.location.href = "/login?expired=1";
        }
      } catch {
        // Fallo de red puntual: se reintenta en el próximo tick/foco.
      } finally {
        inFlightRef.current = false;
      }
    };

    const interval = setInterval(() => refresh(true), REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh(false);
    };
    document.addEventListener("visibilitychange", onVisible);

    // ── Interceptor global de 401 ──────────────────────────────────────────
    // Se guarda el fetch original y se restaura al desmontar, para no dejar el
    // parche puesto si el layout se remonta (evita envolver dos veces).
    const originalFetch = window.fetch;
    let redirecting = false;

    const patchedFetch = async function patchedFetch(input, init) {
      const res = await originalFetch(input, init);
      if (res.status !== 401 || stopped || redirecting) return res;

      const path = sameOriginApiPath(input);
      if (!path || AUTH_EXEMPT.some((p) => path.startsWith(p))) return res;

      // ¿Rescatable? Un access token caducado se arregla con un refresh.
      try {
        const r = await originalFetch("/api/auth/refresh", { method: "POST", cache: "no-store" });
        if (r.ok) {
          lastRef.current = Date.now();
          // Reintento único de la petición original, ya con la cookie nueva.
          // `init` puede traer un body de un solo uso (stream): si el reintento
          // fallara por eso, se devuelve el 401 original y manda al login.
          try {
            const retry = await originalFetch(input, init);
            if (retry.status !== 401) return retry;
          } catch {
            /* body no reutilizable: seguimos al login */
          }
        }
      } catch {
        /* sin red: tratamos el 401 como sesión perdida */
      }

      redirecting = true;
      goToLogin();
      return res;
    };
    window.fetch = patchedFetch;

    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      // Solo se restaura si nadie más ha parcheado encima (evita dejar el
      // fetch de otro colgado).
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  return null;
}
