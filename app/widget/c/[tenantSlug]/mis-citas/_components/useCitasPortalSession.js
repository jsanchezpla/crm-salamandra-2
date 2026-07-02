"use client";

/**
 * Sesión del portal público "Mis citas".
 *
 * Al montar: si la URL trae `?wpsso=…` (token firmado por WordPress con el email
 * del usuario logueado), lo canjea en `POST /citas-portal/session` por un
 * sessionToken propio del CRM y lo guarda en sessionStorage; después limpia el
 * `wpsso` de la URL para no dejar rastro. Si no hay `wpsso`, intenta recuperar el
 * sessionToken guardado (sobrevive a la navegación interna, como el AuthGate del
 * widget de reserva).
 *
 * `status`: loading | ready | no-token | invalid | expired | error
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "crm-citas-portal";

function readStored(slug) {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage.getItem(`${STORAGE_PREFIX}:${slug}`); } catch { return null; }
}
function writeStored(slug, token) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(`${STORAGE_PREFIX}:${slug}`, token); } catch { /* bloqueada */ }
}
function clearStored(slug) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(`${STORAGE_PREFIX}:${slug}`); } catch { /* bloqueada */ }
}

export function useCitasPortalSession(slug) {
  const [status, setStatus] = useState("loading");
  const [sessionToken, setSessionToken] = useState(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!slug || startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    async function boot() {
      const url = new URL(window.location.href);
      const wpsso = url.searchParams.get("wpsso");

      if (wpsso) {
        let res;
        try {
          res = await fetch(`/api/public/c/${slug}/citas-portal/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wpsso }),
          });
        } catch {
          if (!cancelled) setStatus("error");
          return;
        } finally {
          // Quitar el token de la URL siempre (no dejar rastro en historial/referrer).
          url.searchParams.delete("wpsso");
          window.history.replaceState({}, "", url.toString());
        }

        if (cancelled) return;
        if (res.ok) {
          const j = await res.json().catch(() => null);
          const token = j?.data?.sessionToken;
          if (token) {
            writeStored(slug, token);
            setSessionToken(token);
            setStatus("ready");
            return;
          }
          setStatus("error");
          return;
        }
        if (res.status === 401) { setStatus("invalid"); return; }
        setStatus("error"); // 403 / 404 / 429 / 500
        return;
      }

      // Sin wpsso: intentar sesión guardada.
      const stored = readStored(slug);
      if (cancelled) return;
      if (stored) { setSessionToken(stored); setStatus("ready"); }
      else setStatus("no-token");
    }

    boot();
    return () => { cancelled = true; };
  }, [slug]);

  const reset = useCallback(() => {
    clearStored(slug);
    setSessionToken(null);
  }, [slug]);

  const authFetch = useCallback(
    async (path, opts = {}) => {
      const token = sessionToken || readStored(slug);
      const res = await fetch(`/api/public/c/${slug}${path}`, {
        ...opts,
        headers: {
          ...(opts.headers || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.status === 401) {
        clearStored(slug);
        setSessionToken(null);
        setStatus("expired");
      }
      return res;
    },
    [slug, sessionToken]
  );

  return { status, sessionToken, authFetch, reset };
}
