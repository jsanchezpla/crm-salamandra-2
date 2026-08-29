/**
 * lib/calendar/googleSync.js — mantener el Google de cada asistente igual que
 * el Calendario del CRM (29/08/2026, Rodrigo). Regla #2: lo llaman los tres
 * endpoints de tareas y el callback de conexión.
 *
 * LA REGLA DE ORO: la sincronización NUNCA tumba el guardado. El evento en el
 * CRM es la verdad; la copia en Google es un espejo que se intenta y, si Google
 * no responde, se reintenta solo en el siguiente guardado (el `googleEventId`
 * a null delata la copia que falta). Perder un evento porque Google estaba
 * caído no lo arregla nadie — mismo criterio que el correo de la convocatoria.
 * Por eso todo aquí devuelve en vez de lanzar, y los fallos van a la consola.
 *
 * QUÉ SE SINCRONIZA: los eventos donde la persona APARECE («Afecta a»,
 * calendar_task_attendees). El responsable que no esté en esa lista no se
 * sincroniza: la lista es la que dice a quién afecta, y duplicar la regla con
 * un «y además el responsable» haría imposible explicar por qué algo salió en
 * un calendario. Un evento CANCELADO se quita del Google de todos: una reunión
 * anulada que sigue pintada en la agenda es una mentira con hora.
 */

import { encryptSecret, decryptSecret } from "../crypto/secretBox.js";
import {
  actualizarEvento,
  borrarEvento,
  eventoDesdeTarea,
  getTenantGoogleCalendarConfig,
  googleCalendarDisponible,
  insertarEvento,
  refrescarToken,
} from "./googleCalendar.js";

function avisa(msg, extra) {
  console.error(`[google-calendar] ${msg}`, extra ?? "");
}

/**
 * Un access token vivo para esta conexión, refrescándolo si le queda menos de
 * un minuto. Si Google contesta `invalid_grant` (la persona revocó el permiso
 * desde su cuenta), la conexión se BORRA: un «conectado» que no sincroniza
 * nunca más es peor que verse desconectado y volver a darle al botón.
 */
async function tokenVivo(conexion, config) {
  const caduca = conexion.tokenExpiresAt ? new Date(conexion.tokenExpiresAt).getTime() : 0;
  if (caduca - Date.now() > 60_000) {
    try {
      return decryptSecret(conexion.accessToken);
    } catch {
      return null; // clave de cifrado rotada: sin token no hay sincronización
    }
  }

  let refresh;
  try {
    refresh = decryptSecret(conexion.refreshToken);
  } catch {
    return null;
  }
  const r = await refrescarToken({ refreshToken: refresh, clientId: config.clientId, clientSecret: config.clientSecret });
  if (!r.ok) {
    if (r.invalidGrant) await conexion.destroy().catch(() => {});
    else avisa(`no se pudo refrescar el token de ${conexion.teamMemberId}`, r.error);
    return null;
  }
  await conexion
    .update({
      accessToken: encryptSecret(r.accessToken),
      tokenExpiresAt: new Date(Date.now() + r.expiresIn * 1000),
    })
    .catch(() => {});
  return r.accessToken;
}

/** Crea o actualiza la copia de UNA tarea en el calendario de UN asistente. */
async function empujarCopia({ link, conexion, config, task }) {
  const token = await tokenVivo(conexion, config);
  if (!token) return;

  const evento = eventoDesdeTarea(task);

  if (link.googleEventId) {
    const r = await actualizarEvento(token, conexion.calendarId, link.googleEventId, evento);
    if (r.ok) return;
    // 404/410: la copia ya no existe (la borró a mano desde Google). Se crea de
    // nuevo — el CRM manda sobre su espejo. Otro fallo: se apunta y ya volverá.
    if (r.status !== 404 && r.status !== 410) {
      avisa(`no se pudo actualizar el evento ${link.googleEventId}`, r.json?.error?.message ?? r.status);
      return;
    }
  }

  const r = await insertarEvento(token, conexion.calendarId, evento);
  if (r.ok && r.json?.id) await link.update({ googleEventId: r.json.id }).catch(() => {});
  else avisa("no se pudo crear el evento en Google", r.json?.error?.message ?? r.status);
}

/** Borra la copia de UNA fila de asistente y deja la fila sin id. */
async function quitarCopia({ link, conexion, config }) {
  if (!link.googleEventId || !conexion) return;
  const token = await tokenVivo(conexion, config);
  if (token) {
    const r = await borrarEvento(token, conexion.calendarId, link.googleEventId);
    if (!r.ok) avisa(`no se pudo borrar el evento ${link.googleEventId}`, r.json?.error?.message ?? r.status);
  }
  await link.update({ googleEventId: null }).catch(() => {});
}

function puertaCerrada(ctx) {
  if (!googleCalendarDisponible(ctx)) return true;
  return !getTenantGoogleCalendarConfig(ctx).configured;
}

async function conexionesDe(ctx, teamMemberIds) {
  if (!teamMemberIds.length) return new Map();
  const filas = await ctx.tenantModels.GoogleCalendarConnection.findAll({
    where: { teamMemberId: teamMemberIds },
  });
  return new Map(filas.map((c) => [c.teamMemberId, c]));
}

/**
 * Después de guardar una tarea (crear, editar, arrastrar): empuja la copia a
 * cada asistente conectado — o la quita de todos si el evento está cancelado.
 * En paralelo con `allSettled`: con «Todos» en un equipo de 15, en serie serían
 * quince viajes a Google uno detrás de otro con el guardado esperando.
 */
export async function sincronizarTareaConGoogle({ task, ctx }) {
  try {
    if (puertaCerrada(ctx)) return;
    const config = getTenantGoogleCalendarConfig(ctx);
    const links = await ctx.tenantModels.CalendarTaskAttendee.findAll({ where: { taskId: task.id } });
    if (!links.length) return;
    const conexiones = await conexionesDe(ctx, links.map((l) => l.teamMemberId));

    await Promise.allSettled(
      links.map((link) => {
        const conexion = conexiones.get(link.teamMemberId);
        if (task.status === "cancelled") return quitarCopia({ link, conexion, config });
        if (!conexion) return Promise.resolve();
        return empujarCopia({ link, conexion, config, task });
      })
    );
  } catch (err) {
    avisa("sincronización fallida", err?.message);
  }
}

/**
 * ANTES de borrar la tarea (o de quitar a alguien de «Afecta a»): quita las
 * copias de Google de esas filas. Va antes del destroy porque el CASCADE de la
 * base se lleva las filas — y con ellas, el único sitio donde está el id.
 */
export async function quitarCopiasDeGoogle({ links, ctx }) {
  try {
    if (puertaCerrada(ctx) || !links?.length) return;
    const config = getTenantGoogleCalendarConfig(ctx);
    const conexiones = await conexionesDe(ctx, links.map((l) => l.teamMemberId));
    await Promise.allSettled(
      links.map((link) => quitarCopia({ link, conexion: conexiones.get(link.teamMemberId), config }))
    );
  } catch (err) {
    avisa("no se pudieron quitar copias", err?.message);
  }
}

/**
 * Al CONECTAR: los eventos que ya le afectaban a esa persona, de hoy en
 * adelante, aparecen en su calendario nuevo de golpe. El pasado no se copia a
 * propósito — a nadie le sirve un histórico volcado en una agenda — y los
 * cancelados tampoco.
 */
export async function sincronizarMiembroConGoogle({ teamMemberId, ctx }) {
  try {
    if (puertaCerrada(ctx)) return;
    const config = getTenantGoogleCalendarConfig(ctx);
    const { CalendarTaskAttendee, CalendarTask, GoogleCalendarConnection } = ctx.tenantModels;
    const conexion = await GoogleCalendarConnection.findOne({ where: { teamMemberId } });
    if (!conexion) return;

    const hoy = new Date();
    const p = (x) => String(x).padStart(2, "0");
    const desde = `${hoy.getFullYear()}-${p(hoy.getMonth() + 1)}-${p(hoy.getDate())}`;

    const links = await CalendarTaskAttendee.findAll({
      where: { teamMemberId },
      include: [{ model: CalendarTask, as: "task", required: true }],
    });
    const pendientes = links.filter((l) => l.task.startDate >= desde && l.task.status !== "cancelled");
    await Promise.allSettled(pendientes.map((link) => empujarCopia({ link, conexion, config, task: link.task })));
  } catch (err) {
    avisa("no se pudo volcar la agenda al conectar", err?.message);
  }
}
