/**
 * lib/calendar/googleCalendar.js — la integración del Calendario con Google
 * Calendar (29/08/2026, Rodrigo). Regla #2: va en /lib porque lo comparten los
 * endpoints de conexión, los de tareas y la sincronización.
 *
 * QUÉ ES: si el tenant tiene el módulo Calendario (y Equipo, que es quien pone
 * a las personas), cada miembro conecta SU cuenta de Google y el CRM le crea un
 * calendario llamado «CRM Salamandra». Los eventos donde esa persona aparece
 * («Afecta a», ver CalendarTaskAttendee) se escriben ahí. El nombre lo puede
 * cambiar en Google cuando quiera: nosotros guardamos el id, que no cambia.
 *
 * CREDENCIALES BYOK, como GoCardless o Stripe: la app de OAuth es DEL TENANT
 * (su proyecto de Google Cloud), pegada en Configuración → Conexiones
 * (`googleCalendarClientId` a la vista, `googleCalendarClientSecret` cifrado).
 * Sin fallback al `.env`: sin credenciales del tenant, no hay Google.
 *
 * EL PERMISO ES EL MÍNIMO QUE EXISTE: el scope `calendar.app.created` solo deja
 * tocar calendarios que ESTA app haya creado. El CRM no puede leer ni escribir
 * el calendario personal de nadie — ni queriendo. Se eligió a propósito frente
 * al scope `calendar` completo, que abre la agenda entera de la persona.
 *
 * Sin SDK de Google a propósito (pesa ~100 MB y esto son cuatro llamadas REST):
 * `fetch` contra la API v3, igual que lib/banco/gocardless.js habla con la suya.
 */

import { decryptSecret } from "../crypto/secretBox.js";

export const NOMBRE_CALENDARIO = "CRM Salamandra";

export const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/calendar.app.created";

/*
 * El CRM guarda horas «de pared» (DATEONLY + TIME, sin zona) y sus clientes son
 * negocios españoles. Google exige zona en los eventos con hora: esta es la
 * traducción honesta de lo que hay guardado, no una preferencia.
 */
export const ZONA_HORARIA = "Europe/Madrid";

// ── Configuración del tenant (mismo patrón que lib/banco/gocardlessConfig.js) ─

export function getTenantGoogleCalendarConfig(ctx) {
  const integ = ctx?.tenant?.settings?.integrations ?? {};
  const clientId =
    typeof integ.googleCalendarClientId === "string" ? integ.googleCalendarClientId.trim() || null : null;

  let clientSecret = null;
  if (typeof integ.googleCalendarClientSecret === "string" && integ.googleCalendarClientSecret.trim()) {
    try {
      clientSecret = decryptSecret(integ.googleCalendarClientSecret).trim() || null;
    } catch {
      // Si no se puede DESCIFRAR (clave de cifrado rotada), a efectos prácticos
      // no está configurado: mejor que decir «listo» mientras todo falla.
      clientSecret = null;
    }
  }

  return { clientId, clientSecret, configured: !!clientId && !!clientSecret };
}

/**
 * La puerta de la función: Calendario (el módulo que se compra) + Equipo (el
 * módulo que pone a las personas que se convocan y se conectan). Es el «a
 * Equipo básico se le desbloquea» de Rodrigo: basta `team`, nunca `team_avanzado`.
 */
export function googleCalendarDisponible(ctx) {
  return typeof ctx?.hasModule === "function" && ctx.hasModule("calendar") && ctx.hasModule("team");
}

// ── El origen de la petición, para construir la URL de retorno de OAuth ──────

/**
 * `https://host` reconstruido de las cabeceras. nginx pasa `Host` y
 * `X-Forwarded-Proto` (ver nginx/nginx.conf); en local no hay proxy y se cae a
 * http para localhost. La URI de retorno tiene que coincidir LETRA A LETRA con
 * la registrada en Google Cloud, así que aquí no se inventa nada: se refleja
 * por dónde entró la petición.
 */
export function origenPeticion(request) {
  const host = request.headers.get("host") || "localhost:3000";
  const esLocal = host.startsWith("localhost") || host.startsWith("127.");
  const proto = request.headers.get("x-forwarded-proto") || (esLocal ? "http" : "https");
  return `${proto}://${host}`;
}

export function redirectUriDe(origen) {
  return `${origen}/api/calendar/google/callback`;
}

// ── OAuth ────────────────────────────────────────────────────────────────────

export function urlAutorizacion({ clientId, redirectUri, state }) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_SCOPES);
  // `offline` + `consent`: sin los dos, Google solo da el refresh_token la
  // PRIMERA vez, y quien se desconecte y vuelva se quedaría con una conexión
  // que caduca en una hora sin que nada lo delate.
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

async function postFormulario(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export async function canjearCodigo({ code, clientId, clientSecret, redirectUri }) {
  const r = await postFormulario("https://oauth2.googleapis.com/token", {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (!r.ok) return { ok: false, error: r.json?.error || `HTTP ${r.status}` };
  return {
    ok: true,
    accessToken: r.json.access_token,
    refreshToken: r.json.refresh_token ?? null,
    expiresIn: Number(r.json.expires_in) || 3600,
    idToken: r.json.id_token ?? null,
  };
}

export async function refrescarToken({ refreshToken, clientId, clientSecret }) {
  const r = await postFormulario("https://oauth2.googleapis.com/token", {
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  if (!r.ok) {
    // `invalid_grant` = la persona revocó el acceso desde su cuenta de Google
    // (o Google caducó el permiso). No es un fallo transitorio: hay que tratar
    // la conexión como muerta, no reintentar para siempre.
    return { ok: false, invalidGrant: r.json?.error === "invalid_grant", error: r.json?.error || `HTTP ${r.status}` };
  }
  return { ok: true, accessToken: r.json.access_token, expiresIn: Number(r.json.expires_in) || 3600 };
}

/** Best-effort: decirle a Google que ya no queremos el token. Nunca lanza. */
export async function revocarToken(token) {
  try {
    await postFormulario("https://oauth2.googleapis.com/revoke", { token });
  } catch {
    /* si no llega, el token caduca solo */
  }
}

/**
 * El correo que viene dentro del id_token de OpenID. NO se verifica la firma a
 * propósito: el token acaba de llegar DIRECTO de Google por TLS en el canje del
 * código, no de un tercero. Y solo se usa para enseñar «conectado como …».
 */
export function emailDeIdToken(idToken) {
  try {
    const cuerpo = String(idToken).split(".")[1];
    const json = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
    return typeof json.email === "string" && json.email.includes("@") ? json.email : null;
  } catch {
    return null;
  }
}

// ── La tarea traducida a evento de Google (función pura, con prueba) ─────────

function sumarDias(iso, n) {
  // A mano y sin pasar por la zona horaria: `new Date("2026-08-27")` es
  // medianoche UTC y desplaza el día — el incidente de la agenda importada del
  // 26/08/2026, fijado también en la plantilla de la convocatoria.
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function hhmm(t) {
  return String(t).slice(0, 5);
}

function unaHoraDespues(fecha, hora) {
  const [h, m] = hhmm(hora).split(":").map(Number);
  const total = h * 60 + m + 60;
  const p = (x) => String(x).padStart(2, "0");
  return {
    fecha: total >= 24 * 60 ? sumarDias(fecha, 1) : fecha,
    hora: `${p(Math.floor((total % (24 * 60)) / 60))}:${p(total % 60)}`,
  };
}

/**
 * Qué se escribe en el Google de cada asistente. Reglas:
 *   · «todo el día» —o un evento sin hora de inicio— va como evento de día
 *     entero; el fin de Google es EXCLUSIVO, así que se suma un día.
 *   · con hora de inicio y sin hora de fin, dura una hora: el bloque mínimo
 *     que se ve en una agenda (y el mismo default que usa el propio Google).
 *   · un fin anterior al inicio no se manda tal cual (Google lo rechaza y el
 *     evento no aparecería): se cae al bloque de una hora.
 *   · las notas y el enlace de la videollamada van en la descripción.
 */
export function eventoDesdeTarea(task) {
  const partes = [];
  if (task.notes) partes.push(task.notes);
  if (task.meetUrl) partes.push(`Videollamada: ${task.meetUrl}`);
  const description = partes.join("\n\n") || undefined;

  if (task.allDay || !task.startTime) {
    return {
      summary: task.title,
      description,
      start: { date: task.startDate },
      end: { date: sumarDias(task.endDate || task.startDate, 1) },
    };
  }

  const inicio = `${task.startDate}T${hhmm(task.startTime)}:00`;
  let finFecha = task.endDate || task.startDate;
  let finHora = task.endTime ? hhmm(task.endTime) : null;
  if (!finHora || `${finFecha}T${finHora}` <= `${task.startDate}T${hhmm(task.startTime)}`) {
    const f = unaHoraDespues(task.startDate, task.startTime);
    finFecha = f.fecha;
    finHora = f.hora;
  }

  return {
    summary: task.title,
    description,
    start: { dateTime: inicio, timeZone: ZONA_HORARIA },
    end: { dateTime: `${finFecha}T${finHora}:00`, timeZone: ZONA_HORARIA },
  };
}

// ── Las cuatro llamadas a la API de Calendar ─────────────────────────────────

const API = "https://www.googleapis.com/calendar/v3";

async function llamada(metodo, url, token, body) {
  const res = await fetch(url, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = res.status === 204 ? null : await res.json();
  } catch {
    /* DELETE responde vacío */
  }
  return { ok: res.ok, status: res.status, json };
}

export async function crearCalendario(token, nombre = NOMBRE_CALENDARIO) {
  return llamada("POST", `${API}/calendars`, token, { summary: nombre, timeZone: ZONA_HORARIA });
}

export async function insertarEvento(token, calendarId, evento) {
  return llamada("POST", `${API}/calendars/${encodeURIComponent(calendarId)}/events`, token, evento);
}

export async function actualizarEvento(token, calendarId, eventId, evento) {
  return llamada(
    "PUT",
    `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    token,
    evento
  );
}

export async function borrarEvento(token, calendarId, eventId) {
  const r = await llamada(
    "DELETE",
    `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    token
  );
  // Que ya no exista (404/410, borrado a mano desde Google) es el estado que
  // queríamos: no es un fallo.
  if (r.status === 404 || r.status === 410) return { ...r, ok: true };
  return r;
}
