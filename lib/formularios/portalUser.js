/**
 * lib/formularios/portalUser.js — dar de alta a la paciente en el WordPress
 * del tenant cuando se acepta su solicitud.
 *
 * POR QUÉ: el portal de citas de tunutrilaura ya funciona con usuarios de
 * WordPress — quien inicia sesión allí puede reservar y ver sus citas, porque
 * el tema firma un token con su email y el CRM lo canjea por una sesión
 * (lib/citas/ssoToken.js). Lo único que faltaba era crear ese usuario. Con esto
 * el círculo se cierra: aceptar una solicitud le da acceso automáticamente.
 *
 * NUNCA VIAJA UNA CONTRASEÑA. WordPress crea el usuario y le manda un enlace
 * para que ELLA elija la suya, con caducidad. Enviar una contraseña por correo
 * la dejaría escrita para siempre en su bandeja de entrada: si algún día le
 * entran en el correo, le entran también en la cuenta.
 *
 * AUTENTICACIÓN: se reutiliza el secreto por tenant de WIDGET_SSO_SECRETS,
 * pero NO en crudo. Se deriva una subclave con HMAC sobre una etiqueta de
 * propósito, de modo que un token de este canal jamás pueda colar como token
 * del SSO ni al revés. WordPress deriva la misma subclave con el mismo secreto
 * y la misma etiqueta.
 *
 * Best-effort por diseño: si WordPress no responde, la solicitud YA está
 * aceptada y la ficha creada. Se informa del fallo, no se deshace nada.
 */

import crypto from "node:crypto";
import { getWidgetSsoSecret } from "../citas/ssoToken.js";

const ETIQUETA = "crm-portal-user-v1";
const TIMEOUT_MS = 8000;

/**
 * ¿Cuál es el WordPress de este cliente? (05/08/2026)
 *
 * Hasta hoy la URL solo hacía falta al aceptar una solicitud, y por eso vive en
 * los ajustes DEL FORMULARIO (`forms.settings.wordpressUrl`). Ahora también se
 * crea la cuenta desde la ficha de una paciente, donde no hay ningún formulario
 * de por medio, así que hay que resolverla por otro lado.
 *
 * Se busca en tres sitios, del más explícito al más circunstancial:
 *   1. `settings.wordpressUrl` del cliente — el sitio donde debería estar.
 *   2. El origen de la página del portal (`settings.citas.portalUrl`), que ya se
 *      configura en Configuración → Área privada y apunta a esa misma web.
 *   3. Cualquier formulario que la tenga puesta. Es lo que hace que esto
 *      funcione HOY sin tocar nada: tunutrilaura la tiene en su formulario de
 *      primer contacto.
 *
 * Devuelve null si no hay ninguna, y entonces quien llama avisa de que hay que
 * configurarla en vez de intentar hablar con una web que no sabe cuál es.
 */
export async function resolverUrlWordpress(tenant, tenantModels) {
  const directa = tenant?.settings?.wordpressUrl;
  if (typeof directa === "string" && directa.trim()) return directa.trim();

  const portal = tenant?.settings?.citas?.portalUrl;
  if (typeof portal === "string" && portal.trim()) {
    try {
      return new URL(portal.trim()).origin;
    } catch {
      // Mal escrita: se sigue buscando en vez de reventar.
    }
  }

  try {
    const { Form } = tenantModels ?? {};
    if (!Form) return null;
    const forms = await Form.findAll({ attributes: ["settings"] });
    for (const f of forms) {
      const url = f?.settings?.wordpressUrl;
      if (typeof url === "string" && url.trim()) return url.trim();
    }
  } catch {
    // Sin módulo de formularios o sin tabla: no es un error, es que no hay.
  }
  return null;
}

/** Subclave de propósito único a partir del secreto compartido del tenant. */
function derivarClave(secreto) {
  return crypto.createHmac("sha256", secreto).update(ETIQUETA).digest("hex");
}

function firmar(clave, cuerpoJson) {
  return crypto.createHmac("sha256", clave).update(cuerpoJson).digest("hex");
}

/**
 * Pide a WordPress que cree (o reutilice) el usuario y le envíe el enlace para
 * establecer contraseña.
 *
 * Devuelve siempre un objeto; nunca lanza.
 *   { ok:true,  creado:true|false, mensaje }
 *   { ok:false, motivo, mensaje }
 */
export async function crearUsuarioPortal({ tenantSlug, wordpressUrl, email, nombre }) {
  if (!wordpressUrl) {
    return { ok: false, motivo: "sin_url", mensaje: "El formulario no tiene configurada la URL de WordPress." };
  }
  if (!email) {
    return { ok: false, motivo: "sin_email", mensaje: "La solicitud no trae email: no se puede crear el acceso." };
  }

  const secreto = getWidgetSsoSecret(tenantSlug);
  if (!secreto) {
    return {
      ok: false,
      motivo: "sin_secreto",
      mensaje: `No hay secreto WIDGET_SSO_SECRETS para "${tenantSlug}": el alta en WordPress queda pendiente.`,
    };
  }

  const cuerpo = JSON.stringify({
    email: String(email).toLowerCase().trim(),
    nombre: String(nombre || "").trim().slice(0, 120),
    ts: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
  });
  const firma = firmar(derivarClave(secreto), cuerpo);

  const destino = `${String(wordpressUrl).replace(/\/+$/, "")}/wp-json/crm/v1/portal-user`;
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(destino, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CRM-Signature": firma },
      body: cuerpo,
      signal: controlador.signal,
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        motivo: `http_${res.status}`,
        mensaje: json?.message || `WordPress respondió ${res.status}.`,
      };
    }
    return {
      ok: true,
      creado: json?.creado !== false,
      mensaje: json?.creado === false
        ? "Ya tenía usuario en la web; no se ha creado otro."
        : "Usuario creado. Se le ha enviado un correo para que elija su contraseña.",
    };
  } catch (err) {
    const abortado = err?.name === "AbortError";
    return {
      ok: false,
      motivo: abortado ? "timeout" : "red",
      mensaje: abortado
        ? "WordPress no respondió a tiempo."
        : `No se ha podido contactar con WordPress: ${err?.message || "error de red"}`,
    };
  } finally {
    clearTimeout(reloj);
  }
}
