"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * "Conectar mi WhatsApp" — Embedded Signup de Meta, en un botón.
 *
 * Es la diferencia entre vender un CRM donde el cliente conecta su WhatsApp
 * solo y uno donde hay que hacerle de informático: sin esto, cada cliente
 * tendría que crearse una app en developers.facebook.com, sacar un token de un
 * usuario del sistema y pegarlo aquí a mano. Una nutricionista no va a hacer
 * eso.
 *
 * Y sobre todo: **es la única vía que conserva sus conversaciones.** Dar de alta
 * el número por el panel de Meta obliga a borrar su cuenta de WhatsApp y le saca
 * el número del móvil. Por eso este flujo pide `whatsapp_business_app_onboarding`
 * (la coexistencia): su número sigue vivo en su app, con sus chats, y a la vez
 * el CRM puede mandar recordatorios.
 *
 * ── CÓMO VA ─────────────────────────────────────────────────────────────────
 * 1. Se carga el SDK de Meta (solo al pulsar: no se le mete a nadie un script de
 *    Facebook en la página por si acaso).
 * 2. Se abre la ventana de Meta. El cliente entra con su Facebook, elige
 *    "conectar mi cuenta existente de WhatsApp Business" y mete un código.
 * 3. Meta manda por `postMessage` los identificadores de su cuenta y su número.
 * 4. El callback del login devuelve un **código canjeable**, y se manda al
 *    servidor, que lo cambia por el token permanente y suscribe el webhook.
 *
 * ⚠️ **El código caduca a los 30 segundos**, así que en cuanto llega se manda.
 * Nada de guardarlo en estado y esperar a que el usuario confirme.
 *
 * ⚠️ El dominio desde el que se abre esto tiene que estar dado de alta en la app
 * de Meta ("Allowed domains" y "Valid OAuth redirect URIs") o el `postMessage`
 * no llega nunca — y el síntoma es este componente diciendo que faltan datos.
 */

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID;
const FB_VERSION = "v25.0";

/** Carga el SDK de Meta una sola vez y devuelve `window.FB`. */
function cargarSdk() {
  if (typeof window === "undefined") return Promise.reject(new Error("Sin navegador"));
  if (window.FB) return Promise.resolve(window.FB);
  if (window.__fbSdkPromesa) return window.__fbSdkPromesa;

  window.__fbSdkPromesa = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: true, version: FB_VERSION });
      resolve(window.FB);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => {
      window.__fbSdkPromesa = null;
      reject(new Error("No se ha podido cargar el conector de Meta. ¿Hay algún bloqueador de anuncios activo?"));
    };
    document.body.appendChild(s);
  });
  return window.__fbSdkPromesa;
}

export default function ConectarWhatsapp({ isAdmin, conectado, numero, conectadoAt, onConectado }) {
  const [estado, setEstado] = useState("listo"); // listo | abriendo | guardando
  const [error, setError] = useState(null);
  const sesion = useRef(null);

  const configurado = !!(APP_ID && CONFIG_ID);

  // El listener se registra al montar, no al pulsar: Meta puede mandar el
  // postMessage antes de que vuelva el callback del login, y si no hay nadie
  // escuchando en ese momento el dato se pierde.
  useEffect(() => {
    const alRecibir = (event) => {
      if (!String(event.origin || "").endsWith("facebook.com")) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "CANCEL") {
          sesion.current = null;
          setError("Has cerrado la ventana de Meta antes de terminar.");
          setEstado("listo");
          return;
        }
        if (data.data?.waba_id && data.data?.phone_number_id) {
          sesion.current = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id };
        }
      } catch {
        // Facebook manda por ahí otros mensajes que no son JSON. No es nuestro.
      }
    };
    window.addEventListener("message", alRecibir);
    return () => window.removeEventListener("message", alRecibir);
  }, []);

  const enviarAlServidor = useCallback(
    async (code) => {
      const datos = sesion.current;
      if (!datos) {
        setError(
          "Meta no ha devuelto los datos de la cuenta. Vuelve a intentarlo; si sigue pasando, hay que revisar los dominios permitidos en la app de Meta."
        );
        setEstado("listo");
        return;
      }
      setEstado("guardando");
      try {
        const res = await fetch("/api/whatsapp/conectar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, ...datos }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || json?.message || "No se ha podido conectar");
        sesion.current = null;
        setError(null);
        onConectado?.(json?.data ?? json);
      } catch (err) {
        setError(err.message);
      } finally {
        setEstado("listo");
      }
    },
    [onConectado]
  );

  const conectar = useCallback(async () => {
    setError(null);
    setEstado("abriendo");
    sesion.current = null;
    try {
      const FB = await cargarSdk();
      FB.login(
        (respuesta) => {
          const code = respuesta?.authResponse?.code;
          if (!code) {
            setError("No has completado la conexión.");
            setEstado("listo");
            return;
          }
          // Sin await ni confirmaciones: el código vive 30 segundos.
          enviarAlServidor(code);
        },
        {
          config_id: CONFIG_ID,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: {},
            // ESTO es la coexistencia. Sin esta línea, Meta ofrece dar de alta
            // un número nuevo y el cliente perdería sus conversaciones.
            featureType: "whatsapp_business_app_onboarding",
            sessionInfoVersion: "3",
          },
        }
      );
    } catch (err) {
      setError(err.message);
      setEstado("listo");
    }
  }, [enviarAlServidor]);

  if (!configurado) {
    return (
      <div className="mt-4 pt-4 border-t border-neutral-100">
        <p className="text-[11px] text-neutral-400">
          La conexión automática con Meta todavía no está disponible. Mientras tanto, el token y el identificador del
          número se pueden pegar a mano aquí arriba.
        </p>
      </div>
    );
  }

  const ocupado = estado !== "listo";

  return (
    <div className="mt-4 pt-4 border-t border-neutral-100">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
        Conexión con Meta
      </label>

      {conectado ? (
        <p className="text-[11px] text-neutral-500 mt-0.5 mb-2">
          Conectado{numero ? ` · ${numero}` : ""}
          {conectadoAt ? ` · desde el ${new Date(conectadoAt).toLocaleDateString("es-ES")}` : ""}. Tu WhatsApp sigue
          funcionando con normalidad en el móvil.
        </p>
      ) : (
        <p className="text-[11px] text-neutral-400 mt-0.5 mb-2">
          Conecta tu cuenta de WhatsApp Business sin perder tus conversaciones: el número sigue en tu móvil y el CRM
          podrá enviar los avisos de cita. Necesitas la app de WhatsApp Business actualizada.
        </p>
      )}

      {isAdmin && (
        <button
          onClick={conectar}
          disabled={ocupado}
          className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {estado === "abriendo" ? "Abriendo Meta…" : estado === "guardando" ? "Conectando…" : conectado ? "Volver a conectar" : "Conectar mi WhatsApp"}
        </button>
      )}

      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
