/**
 * lib/calendar/invitacion.js — la convocatoria de un evento del Calendario:
 * su enlace de videollamada y a quién se le manda.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el alta y la edición de un
 * evento —`app/api/calendar/tasks/route.js` y `.../[id]/route.js`—, y las dos
 * tienen que validar y enviar EXACTAMENTE igual. Dos copias de esto acaban con
 * una pantalla diciendo «enviado» y la otra no.)
 *
 * ── EL ENLACE SE PEGA, NO SE GENERA (27/08/2026, Rodrigo) ──────────────────
 * Igual que en Citas, y por el mismo motivo escrito en
 * `lib/citas/videollamada.js`: el CRM no tiene integración con Google ni con
 * Zoom, así que no puede crear salas de verdad. Quien convoca la reunión la
 * abre donde quiera y pega el enlace aquí. Nadie promete un enlace que luego no
 * funciona.
 *
 * ── EL CORREO SALE CON LAS CREDENCIALES DEL TENANT ─────────────────────────
 * Es una reunión SUYA con otro profesional, así que sale de su dirección, no de
 * la nuestra (al revés que el buzón o la recuperación de contraseña, que son
 * cosas de Salamandra). Si el cliente no tiene Resend configurado, el envío se
 * queda en simulacro: eso NO se cuenta como enviado — es el incidente del
 * 03/08/2026 de `resendClient.js`, y por eso se usa `envioRealizado`.
 */

import { sendEmail, envioRealizado } from "../email/resendClient.js";
import { getTenantResendConfig } from "../outreach/resendConfig.js";
import { invitacionEventoTemplate } from "../email/templates/calendar/invitacionEvento.js";

/** El tope de la columna: `calendar_tasks.meet_url` es VARCHAR(500). */
export const MAX_URL = 500;

/**
 * ¿Vale como enlace de videollamada?
 *
 * Se pide `http(s)://` y poco más, a propósito. La tentación es exigir que el
 * dominio sea de Meet, Zoom o Teams, y sería un error: los centros usan también
 * Jitsi, Whereby, la sala del colegio profesional o el enlace de su propia
 * plataforma. Una lista blanca nuestra les rechazaría un enlace bueno, que es
 * peor que el problema que evita (mismo razonamiento que los prefijos de
 * `credencialesCliente.js`).
 *
 * @returns {string|null} el motivo del rechazo, o `null` si vale
 */
export function revisarEnlace(url) {
  const v = String(url ?? "").trim();
  if (!v) return null; // vacío = no hay videollamada, que es válido
  if (v.length > MAX_URL) return `El enlace es demasiado largo (máximo ${MAX_URL} caracteres)`;
  let u;
  try {
    u = new URL(v);
  } catch {
    return "El enlace no es una dirección web válida. Pégalo entero, empezando por https://";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return "El enlace tiene que empezar por https://";
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** @returns {string|null} el motivo del rechazo, o `null` si vale */
export function revisarCorreoInvitado(correo) {
  const v = String(correo ?? "").trim();
  if (!v) return null; // vacío = no se convoca a nadie por correo
  if (v.length > 255) return "El correo es demasiado largo";
  if (!EMAIL_RE.test(v)) return "Ese correo no tiene forma de correo";
  return null;
}

/** Normaliza lo que llega del cuerpo: cadena vacía → null. */
export const limpio = (v) => {
  const s = String(v ?? "").trim();
  return s || null;
};

/**
 * Cuándo se manda el correo.
 *
 * Solo si lo PIDE quien guarda (`enviarInvitacion: true`, que es la casilla de
 * la pantalla) y hay a quién mandárselo. No se manda solo al detectar que
 * apareció un enlace: en el Calendario un evento se toca muchas veces
 * —arrastrándolo, cambiándole la hora— y un correo por cada roce sería ruido
 * para alguien que no lo ha pedido. En Citas sí se dispara solo, pero allí el
 * destinatario es la familia que espera ese enlace; aquí es un colega al que se
 * convoca a propósito.
 */
export function toca(body, evento) {
  return body?.enviarInvitacion === true && Boolean(evento?.inviteEmail);
}

/**
 * Manda la convocatoria. Best-effort de arriba abajo: un fallo de correo NUNCA
 * tumba el guardado del evento — el evento guardado sin correo se ve igual en
 * el calendario, y perder el evento porque falló un email no lo arregla nadie.
 *
 * @returns {{enviado: boolean, motivo: string|null}} `motivo` es
 *   "sin_configurar" | "error" | null, para que la pantalla pueda decir QUÉ
 *   pasó en vez de inventarse una causa.
 */
export async function enviarInvitacion({ evento, tenant, quienConvoca }) {
  try {
    const tpl = invitacionEventoTemplate({
      tenantName: tenant?.name ?? "el centro",
      brand: tenant?.settings?.brand,
      titulo: evento.title,
      notas: evento.notes,
      startDate: evento.startDate,
      startTime: evento.startTime,
      endDate: evento.endDate,
      endTime: evento.endTime,
      allDay: evento.allDay,
      meetUrl: evento.meetUrl,
      quienConvoca,
    });

    const cfg = getTenantResendConfig({ tenant });
    const res = await sendEmail({
      to: evento.inviteEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      from: cfg.fromEmail || undefined,
      replyTo: cfg.replyTo || undefined,
      apiKey: cfg.apiKey || undefined,
    });

    const { salio, motivo } = envioRealizado(res, `calendario:invitacion ${evento.id}`);
    return { enviado: salio, motivo: salio ? null : motivo };
  } catch (err) {
    process.stderr.write(`[calendario:invitacion] ${evento?.id}: ${err.message}\n`);
    return { enviado: false, motivo: "error" };
  }
}
