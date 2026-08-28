/**
 * bookingConfirmed — Laura ha confirmado la cita desde la lista de espera
 * (PATCH /api/citas/bookings/[id]/confirm). El email lleva fecha, hora,
 * modalidad y, si online, el enlace Meet placeholder (Sprint Fase 2
 * sustituye por Meet real vía Google Calendar).
 */

import { renderLayout, escapeHtml } from "../layout.js";
import { googleCalendarUrl } from "../../../citas/googleCalendar.js";

function formatDate(scheduledAt) {
  try {
    return new Date(scheduledAt).toLocaleDateString("es-ES", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Madrid",
    });
  } catch {
    return String(scheduledAt);
  }
}

function formatTime(scheduledAt) {
  try {
    return new Date(scheduledAt).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Madrid",
    });
  } catch {
    return "";
  }
}

const MODALITY_LABELS = {
  presencial: "Presencial",
  phone: "Llamada telefónica",
  online: "Online (videollamada)",
};

/**
 * @param {{
 *   tenantName: string,
 *   brand?: object,
 *   clientName: string,
 *   eventTypeName: string,
 *   scheduledAt: string|Date,
 *   duration?: number,
 *   modality: "presencial"|"phone"|"online",
 *   meetUrl?: string|null,
 *   cancelUrl?: string|null,    // /widget/c/{slug}/cancel/{token}
 *   location?: string|null,     // si presencial
 * }} ctx
 */
export function bookingConfirmedTemplate(ctx) {
  const dateStr = formatDate(ctx.scheduledAt);
  const timeStr = formatTime(ctx.scheduledAt);
  const firstName = (ctx.clientName || "").split(" ")[0] || ctx.clientName || "Hola";
  const modalityLabel = MODALITY_LABELS[ctx.modality] || ctx.modality;

  const subject = "Tu cita está confirmada";
  const preheader = `${ctx.eventTypeName} · ${dateStr} a las ${timeStr}.`;

  const intro = `<p>Hola ${escapeHtml(firstName)},</p>
<p>Te confirmamos tu cita de <strong>${escapeHtml(ctx.eventTypeName)}</strong>. ¡Nos vemos pronto!</p>`;

  // ── Qué ha pasado con su dinero ──────────────────────────────────────────
  // Este correo decía exactamente lo mismo se hubiera cobrado o no. Quien
  // reservó dejando la tarjeta y acabó con la cita confirmada SIN cobro (porque
  // la reserva de su tarjeta caducó y la profesional la aceptó igualmente) leía
  // "tu cita está confirmada" y se presentaba dando por hecho que estaba pagada.
  // Enterarse en el mostrador es la peor forma de enterarse.
  const importe =
    Number.isInteger(ctx.importe) && ctx.importe > 0
      ? (ctx.importe / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })
      : null;
  const cobrada = ctx.cobro === "cobrada" && importe;
  const sinCobrar = ctx.cobro === "sin_cobrar" && importe;

  const blocks = [
    { label: "Servicio", value: ctx.eventTypeName },
    { label: "Día", value: dateStr },
    { label: "Hora", value: timeStr },
    { label: "Duración", value: ctx.duration ? `${ctx.duration} min` : null },
    { label: "Modalidad", value: modalityLabel },
    cobrada ? { label: "Pagado", value: importe } : null,
    sinCobrar ? { label: "Pendiente de pago", value: `${importe} · en consulta` } : null,
  ].filter((b) => b && b.value);

  const lines = [];

  if (cobrada) {
    lines.push(
      `<p style="margin:0 0 12px;">Hemos cobrado los <strong>${escapeHtml(importe)}</strong> que tenías reservados en tu tarjeta. No tienes que hacer nada más.</p>`
    );
  } else if (sinCobrar) {
    lines.push(
      `<p style="margin:0 0 12px;"><strong>El pago queda pendiente:</strong> abonarás los ${escapeHtml(importe)} en la consulta. No se te ha cobrado nada online.</p>`
    );
  }

  // Enlace y ubicación, escapados (10/08/2026). Los escribe el centro a mano en
  // Tipos de cita y en la ficha de la cita, y ninguno de los dos pasa por una
  // validación de URL antes de aterrizar aquí dentro de un href. El importe de
  // dos líneas más arriba ya iba escapado; estos se quedaron crudos. Se escapa
  // al pegarlo, no la variable: el enlace de Google Calendar de más abajo y el
  // texto plano del final siguen usando el valor tal cual.
  if (ctx.modality === "online" && ctx.meetUrl) {
    lines.push(
      `<p style="margin:0 0 12px;"><strong>Enlace de videollamada:</strong><br><a href="${escapeHtml(ctx.meetUrl)}" style="color:inherit;word-break:break-all;">${escapeHtml(ctx.meetUrl)}</a></p>`,
      `<p style="margin:0 0 12px;font-size:13px;color:#6B7280;">Te recomendamos conectarte unos minutos antes para comprobar audio y cámara.</p>`
    );
  } else if (ctx.modality === "presencial" && ctx.location) {
    lines.push(
      `<p style="margin:0 0 12px;"><strong>Ubicación:</strong> ${escapeHtml(ctx.location)}</p>`
    );
  } else if (ctx.modality === "presencial") {
    // Presencial SIN dirección. La cabecera de arriba ya ha anunciado
    // «Modalidad: Presencial», así que callarse aquí deja a la paciente con una
    // cita a la que no sabe adónde ir y sin nada que decirle que pregunte.
    //
    // No debería poder pasar —`validateModalityFields` exige la dirección al
    // guardar un tipo presencial— pero SÍ pasa: los seeds y los scripts
    // escriben directo al modelo, saltándose esa comprobación, y así nacieron
    // los ocho tipos de las demos (28/08/2026). Esto es la red por debajo.
    lines.push(
      `<p style="margin:0 0 12px;">La cita es presencial. Si no conoces la dirección, respóndenos a este correo y te la confirmamos.</p>`
    );
  } else if (ctx.modality === "phone") {
    lines.push(
      `<p style="margin:0 0 12px;">Te llamaremos al teléfono que nos facilitaste a la hora indicada.</p>`
    );
  }

  /*
   * «Añadir a Google Calendar» (06/08/2026, Rodrigo). Este correo es lo que le
   * llega a la paciente cuando la profesional le da el visto bueno, y hasta hoy
   * el único sitio del sistema con este enlace era la pantalla del momento de
   * reservar —que ni siquiera se ve cuando la cita nace pendiente—. Quien
   * reservaba y esperaba confirmación se quedaba sin ninguna forma de apuntarla.
   */
  const gcal = googleCalendarUrl({
    name: ctx.eventTypeName,
    description: `Cita con ${ctx.tenantName}`,
    start: ctx.scheduledAt,
    durationMinutes: ctx.duration,
    // El «dónde» del evento lo decide la MODALIDAD, no lo que haya suelto.
    //
    // Antes era `ctx.meetUrl || ctx.location || ""`, sin mirar la modalidad, y
    // eso se rompe en cuanto un centro tiene las dos cosas: una cita ONLINE de
    // un centro con dirección puesta se llevaba la dirección física al
    // calendario de la paciente, contradiciendo el «Modalidad: Online» de este
    // mismo correo. Al revés igual: una cita presencial con un enlace viejo
    // colgando se llevaba el enlace. Hoy no se nota porque casi nadie tiene los
    // dos campos a la vez; deja de no notarse en cuanto Aumenta ponga la suya.
    location:
      ctx.modality === "online"
        ? ctx.meetUrl || ""
        : ctx.modality === "presencial"
          ? ctx.location || ""
          : "", // telefónica: no hay sitio al que ir, la llamamos nosotros
  });
  // El de Google Calendar lleva dentro el nombre del servicio y la ubicación, o
  // sea el mismo texto de antes entrando por otra puerta. Lo monta
  // URLSearchParams, que ya percent-codifica comillas y apóstrofos, así que lo
  // único que toca escapeHtml ahí son los "&" que separan los parámetros —y un
  // "&" dentro de un atributo se escribe "&amp;", que es justo lo correcto—. El
  // de cancelar lo genera el CRM y es de fiar, pero se escapa igual: así nadie
  // tiene que pararse a recordar cuál de los dos enlaces era el bueno.
  if (gcal) {
    lines.push(
      `<p style="margin:18px 0 0;font-size:13px;color:#6B7280;"><a href="${escapeHtml(gcal)}" style="color:inherit;">Añadir a Google Calendar</a></p>`
    );
  }

  if (ctx.cancelUrl) {
    lines.push(
      `<p style="margin:18px 0 0;font-size:13px;color:#6B7280;">¿No puedes asistir? <a href="${escapeHtml(ctx.cancelUrl)}" style="color:inherit;">Cancela aquí</a> y reservamos otro hueco.</p>`
    );
  }

  const bodyHtml = lines.join("");

  const footer = `Si necesitas hacer cambios, responde a este email. — ${ctx.tenantName}`;

  const html = renderLayout({
    tenantName: ctx.tenantName,
    brand: ctx.brand,
    preheader,
    title: "Cita confirmada",
    intro,
    blocks,
    bodyHtml,
    footer,
  });

  const textLines = [
    `Hola ${firstName},`,
    ``,
    `Tu cita de ${ctx.eventTypeName} está confirmada.`,
    `Día: ${dateStr}`,
    `Hora: ${timeStr}`,
    ctx.duration ? `Duración: ${ctx.duration} min` : null,
    `Modalidad: ${modalityLabel}`,
    cobrada ? `` : null,
    cobrada ? `Hemos cobrado los ${importe} que tenías reservados en tu tarjeta.` : null,
    sinCobrar ? `` : null,
    sinCobrar ? `PAGO PENDIENTE: abonarás los ${importe} en la consulta. No se te ha cobrado nada online.` : null,
  ].filter((l) => l !== null);

  if (ctx.modality === "online" && ctx.meetUrl) {
    textLines.push(``, `Videollamada: ${ctx.meetUrl}`);
  } else if (ctx.modality === "presencial" && ctx.location) {
    textLines.push(``, `Ubicación: ${ctx.location}`);
  } else if (ctx.modality === "presencial") {
    textLines.push(``, `La cita es presencial. Si no conoces la dirección, respóndenos a este correo y te la confirmamos.`);
  } else if (ctx.modality === "phone") {
    textLines.push(``, `Te llamaremos al teléfono indicado.`);
  }
  if (gcal) {
    textLines.push(``, `Añadir a Google Calendar: ${gcal}`);
  }

  if (ctx.cancelUrl) {
    textLines.push(``, `Cancelar: ${ctx.cancelUrl}`);
  }

  textLines.push(``, `— ${ctx.tenantName}`);

  return { subject, html, text: textLines.join("\n") };
}
