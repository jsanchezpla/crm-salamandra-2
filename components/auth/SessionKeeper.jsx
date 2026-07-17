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
 */
const REFRESH_INTERVAL_MS = 12 * 60 * 1000;
const MIN_GAP_MS = 10 * 60 * 1000;

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

    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
