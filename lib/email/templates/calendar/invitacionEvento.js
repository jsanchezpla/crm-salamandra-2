/**
 * invitacionEvento — se convoca a alguien a un evento del Calendario, con su
 * enlace de videollamada si lo tiene.
 *
 * El Calendario es de reuniones ENTRE PROFESIONALES (coordinación, supervisión,
 * equipo), así que el tono no es el de una cita con un paciente: aquí no hay
 * «tu cita» ni botón de cancelar. Quien recibe esto es un colega, y muchas veces
 * de FUERA del centro —por eso se le dice de parte de quién va—.
 *
 * Sale con las credenciales del tenant (es su reunión, no nuestra); el porqué,
 * en `lib/calendar/invitacion.js`.
 */

import { renderLayout, escapeHtml } from "../layout.js";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * La fecha se compone A MANO desde `YYYY-MM-DD`, sin pasar por `new Date()`.
 *
 * `startDate` es un DATEONLY: `new Date("2026-08-27")` lo interpreta como
 * medianoche UTC y, al pintarlo en una zona por detrás, sale el día ANTERIOR.
 * Es el fallo de la agenda importada del 26/08/2026, y aquí no puede repetirse
 * porque la fecha de una reunión es justo lo que no se puede equivocar.
 */
function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return String(iso ?? "");
  const [, a, mes, d] = m;
  // Solo para saber qué día de la semana cae; se construye en UTC y se lee en
  // UTC, así que no hay desplazamiento posible.
  const diaSemana = DIAS[new Date(Date.UTC(+a, +mes - 1, +d)).getUTCDay()];
  return `${diaSemana} ${+d} de ${MESES[+mes - 1]} de ${a}`;
}

/** "14:30:00" → "14:30". Lo que guarda un TIME de Postgres lleva segundos. */
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

function cuando({ startDate, startTime, endDate, endTime, allDay }) {
  const dia = fechaLarga(startDate);
  if (allDay) {
    return endDate && endDate !== startDate ? `Del ${dia} al ${fechaLarga(endDate)}` : `Todo el día · ${dia}`;
  }
  const desde = hhmm(startTime);
  const hasta = hhmm(endTime);
  const mismoDia = !endDate || endDate === startDate;
  if (mismoDia) {
    if (desde && hasta) return `${dia}, de ${desde} a ${hasta}`;
    if (desde) return `${dia}, a las ${desde}`;
    return dia;
  }
  return `Del ${dia}${desde ? ` a las ${desde}` : ""} al ${fechaLarga(endDate)}${hasta ? ` a las ${hasta}` : ""}`;
}

/**
 * @param {{
 *   tenantName: string,
 *   brand?: object,
 *   titulo: string,
 *   notas?: string|null,
 *   startDate: string,
 *   startTime?: string|null,
 *   endDate?: string|null,
 *   endTime?: string|null,
 *   allDay?: boolean,
 *   meetUrl?: string|null,
 *   quienConvoca?: string|null,
 * }} ctx
 */
export function invitacionEventoTemplate(ctx) {
  const fecha = cuando(ctx);
  const subject = `${ctx.titulo} · ${fecha}`;

  const deParte = ctx.quienConvoca
    ? `<p style="margin:0 0 12px;">${escapeHtml(ctx.quienConvoca)}, de ${escapeHtml(ctx.tenantName)}, te convoca a esta reunión:</p>`
    : `<p style="margin:0 0 12px;">${escapeHtml(ctx.tenantName)} te convoca a esta reunión:</p>`;

  const blocks = [
    { label: "Reunión", value: ctx.titulo },
    { label: "Cuándo", value: fecha },
  ];

  const partes = [];
  if (ctx.meetUrl) {
    partes.push(
      `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px auto 8px;">` +
        `<tr><td style="border-radius:10px;background:#1F3B34;">` +
        `<a href="${escapeHtml(ctx.meetUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Entrar a la videollamada</a>` +
        `</td></tr></table>` +
        `<p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#3E5C57;text-align:center;">${escapeHtml(ctx.meetUrl)}</p>`
    );
  }
  if (ctx.notas) {
    // El cuerpo del evento puede traer saltos de línea; se respetan sin dejar
    // pasar HTML de nadie.
    partes.push(
      `<p style="margin:0 0 6px;font-size:13px;color:#3E5C57;text-transform:uppercase;letter-spacing:.04em;">Notas</p>` +
        `<p style="margin:0 0 16px;white-space:pre-wrap;">${escapeHtml(ctx.notas)}</p>`
    );
  }
  if (!ctx.meetUrl) {
    partes.push(
      `<p style="margin:0;font-size:13px;color:#3E5C57;">Esta reunión no lleva enlace de videollamada. ` +
        `Si esperabas uno, contesta a este correo.</p>`
    );
  }

  const text = [
    `${ctx.quienConvoca ? `${ctx.quienConvoca}, de ${ctx.tenantName},` : ctx.tenantName} te convoca a esta reunión.`,
    "",
    `${ctx.titulo}`,
    `${fecha}`,
    ctx.meetUrl ? `\nVideollamada: ${ctx.meetUrl}` : "",
    ctx.notas ? `\nNotas:\n${ctx.notas}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    subject,
    html: renderLayout({
      tenantName: ctx.tenantName,
      brand: ctx.brand,
      preheader: fecha,
      title: ctx.titulo,
      intro: deParte,
      blocks,
      bodyHtml: partes.join(""),
      footer: `Enviado desde el calendario de ${ctx.tenantName}.`,
    }),
    text,
  };
}
