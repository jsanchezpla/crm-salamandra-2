"use client";

import { useEffect, useState } from "react";

/**
 * Estado de las claves de IA por tenant (BYOK) que consume Captación. Lee
 * `GET /api/tenant/settings` (auth, NO admin — cualquier usuario del tenant
 * puede consultarlo) y expone qué acciones están habilitadas:
 *   - googlePlaces → "Buscar nuevos" (Google Maps)
 *   - anthropic    → "Analizar" / "Re-analizar" con IA
 *   - resend       → "Enviar correo" de captación
 *
 * El endpoint nunca devuelve la clave en claro, solo `{ configured, hint }`.
 *
 * Es OPTIMISTA mientras carga: `has()` devuelve `true` hasta que sabemos el
 * estado real. Así no parpadean botones deshabilitados ni avisos en el caso
 * normal (todo configurado), y el backend sigue siendo la barrera real: si se
 * intentara una acción sin clave, el endpoint responde 400/503 igualmente.
 * Si el fetch falla, no bloqueamos la UI (fail-open en cliente, fail-closed en
 * servidor).
 */
export function useIntegrations() {
  const [status, setStatus] = useState(null); // null = aún no lo sabemos

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tenant/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.ok) return;
        const integ = j.data?.integrations ?? {};
        setStatus({
          anthropic: Boolean(integ.anthropic?.configured),
          googlePlaces: Boolean(integ.googlePlaces?.configured),
          resend: Boolean(integ.resend?.configured),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Optimista mientras `status` es null: no deshabilita ni avisa hasta saber.
  const has = (key) => (status ? Boolean(status[key]) : true);

  return { status, has };
}
