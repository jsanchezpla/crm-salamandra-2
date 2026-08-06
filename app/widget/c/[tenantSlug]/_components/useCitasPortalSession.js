"use client";

/**
 * Sesión del portal público de citas (SSO WordPress).
 *
 * Compartido por dos pantallas:
 *   - "Mis citas" (`/mis-citas`): lista/cancela las citas del cliente.
 *   - Widget de reserva (`/`, `/book`): pre-rellena el email del cliente logueado.
 *
 * Al montar: si la URL trae `?wpsso=…` (token firmado por WordPress con el email
 * del usuario logueado), lo canjea en `POST /citas-portal/session` por un
 * sessionToken propio del CRM y lo guarda en sessionStorage; después limpia el
 * `wpsso` de la URL. Si no hay `wpsso`, intenta recuperar el sessionToken guardado.
 *
 * `status`: loading | ready | no-token | invalid | expired | error
 * `email`: email verificado del cliente (decodificado del sessionToken), o null.
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

// Decodifica el email del payload del sessionToken (JWT base64url). El email es
// de confianza porque el token está firmado por el CRM y se verifica en el server.
function decodeTokenEmail(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
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
          // La red se cayó al canjear: si hay sesión guardada, se sigue con
          // ella (mismo motivo que el bloque de abajo).
          if (!cancelled) {
            const guardado = readStored(slug);
            if (guardado) { setSessionToken(guardado); setStatus("ready"); }
            else setStatus("error");
          }
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
        }

        /*
         * El wpsso no valió. ANTES DE DAR LA SESIÓN POR PERDIDA, se mira si ya
         * hay una del CRM guardada (06/08/2026, Rodrigo).
         *
         * El wpsso lo firma WordPress y dura 5 minutos. Si la página se sirve
         * de la caché, o se vuelve atrás con el botón del navegador, o
         * sencillamente se tarda un rato en pulsar, el iframe se monta con un
         * token ya caducado. Hasta hoy eso TIRABA una sesión del portal
         * perfectamente válida (dura 60 minutos) y le plantaba a la paciente el
         * cartel de «Inicia sesión para reservar» estando dentro de su cuenta.
         *
         * El token guardado lo verifica igual el servidor en cada llamada: si
         * también hubiera caducado, la primera petición devolverá 401 y el hook
         * pasará a "expired". Aquí no se está confiando en nada nuevo.
         */
        const guardado = readStored(slug);
        if (guardado) {
          setSessionToken(guardado);
          setStatus("ready");
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

  const email = sessionToken ? decodeTokenEmail(sessionToken) : null;

  return { status, sessionToken, email, authFetch, reset };
}
