/**
 * avisosWhatsapp — los avisos de cita también por WhatsApp (01/08/2026).
 *
 * (Fichero nuevo en /lib, regla #2: `lib/whatsapp/whatsappConfig.js` sabe
 * MANDAR un mensaje —credenciales, HTTP, errores— pero no sabe nada de citas,
 * de consentimientos ni de cuándo procede avisar. Eso es lo que vive aquí, y lo
 * comparten el botón «Guardar y enviar», la confirmación de la cita y el
 * recordatorio de la víspera.)
 *
 * TRES CONDICIONES, y las tres tienen que cumplirse:
 *
 *   1. El cliente tiene WhatsApp configurado (su propia cuenta de Meta: BYOK,
 *      el gasto es suyo y los mensajes salen de SU número).
 *   2. El cliente ha encendido los avisos por WhatsApp
 *      (`settings.citas.avisosWhatsapp`, APAGADO por defecto).
 *   3. La familia no ha dicho que NO. En el módulo clínico cada paciente tiene
 *      su consentimiento de comunicaciones por WhatsApp; mandarle un mensaje a
 *      quien lo denegó no es un fallo de usabilidad, es un problema con el
 *      RGPD delante.
 *
 * Nunca lanza: un aviso que falla no puede tumbar la cita que lo originó. El
 * email sigue siendo el canal principal; esto es un extra.
 */

import { enviarWhatsapp, tenantTieneWhatsapp } from "../whatsapp/whatsappConfig.js";

/** ¿Ha encendido este cliente los avisos por WhatsApp? */
export function avisosWhatsappActivos(tenant) {
  return tenant?.settings?.citas?.avisosWhatsapp === true;
}

/**
 * ¿Puede este paciente recibir WhatsApp? Solo un NO explícito bloquea.
 *
 * Sin ficha de paciente (una reserva pública, un cliente sin módulo clínico) el
 * teléfono lo ha dado la propia persona al reservar y el mensaje es puramente
 * transaccional —su cita—, así que se envía. Lo que no se hace nunca es
 * escribir a quien marcó que no quiere WhatsApp.
 */
export function consienteWhatsapp(patient) {
  const c = patient?.consents;
  if (!c || typeof c !== "object") return true;
  const w = c.whatsapp;
  if (w == null) return true;
  if (typeof w === "boolean") return w;
  return w.granted !== false;
}

const fmtCuando = (iso) =>
  new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Los tres textos. Cortos: un WhatsApp no es un correo. */
export const textosCita = {
  confirmada: ({ tenantName, booking, eventTypeName }) =>
    `Hola${booking.clientName ? ` ${booking.clientName.split(" ")[0]}` : ""}, tu cita de ${eventTypeName || "consulta"} en ${tenantName} ` +
    `queda confirmada para el ${fmtCuando(booking.scheduledAt)}.` +
    (booking.meetUrl ? `\n\nEnlace de la videollamada: ${booking.meetUrl}` : ""),

  enlace: ({ tenantName, booking, eventTypeName }) =>
    `Hola${booking.clientName ? ` ${booking.clientName.split(" ")[0]}` : ""}, aquí tienes el enlace para tu cita de ` +
    `${eventTypeName || "consulta"} en ${tenantName} del ${fmtCuando(booking.scheduledAt)}:\n\n${booking.meetUrl}`,

  recordatorio: ({ tenantName, booking, eventTypeName }) =>
    `Recordatorio: mañana tienes tu cita de ${eventTypeName || "consulta"} en ${tenantName}, ` +
    `el ${fmtCuando(booking.scheduledAt)}.` +
    (booking.meetUrl ? `\n\nEnlace: ${booking.meetUrl}` : ""),
};

/**
 * Manda el aviso si procede. Devuelve por qué NO se mandó, que es lo que hace
 * falta para explicarlo en pantalla en vez de dejar un silencio.
 *
 * @param ctx      { tenant, tenantModels } — vale el contexto de una request o
 *                 uno montado a mano desde un script (el recordatorio).
 * @param booking  fila de Booking (con clientPhone, scheduledAt, patientId…)
 * @param tipo     "confirmada" | "enlace" | "recordatorio"
 */
export async function avisarCitaPorWhatsapp(ctx, { booking, tipo, eventTypeName }) {
  try {
    const tenant = ctx?.tenant;
    if (!avisosWhatsappActivos(tenant)) return { ok: false, motivo: "apagado" };
    if (!tenantTieneWhatsapp(ctx)) return { ok: false, motivo: "sin_credenciales" };

    const telefono = booking?.clientPhone;
    if (!telefono) return { ok: false, motivo: "sin_telefono" };

    // Consentimiento del paciente, si la cita está enlazada a uno.
    if (booking.patientId && ctx?.tenantModels?.Patient) {
      try {
        const p = await ctx.tenantModels.Patient.findByPk(booking.patientId, { attributes: ["id", "consents"] });
        if (p && !consienteWhatsapp(p)) return { ok: false, motivo: "sin_consentimiento" };
      } catch {
        // Si no se puede comprobar el consentimiento, NO se manda: ante la duda,
        // callar sale más barato que escribir a quien dijo que no.
        return { ok: false, motivo: "consentimiento_desconocido" };
      }
    }

    const plantilla = textosCita[tipo];
    if (!plantilla) return { ok: false, motivo: "tipo_desconocido" };

    const res = await enviarWhatsapp(ctx, {
      telefono,
      texto: plantilla({ tenantName: tenant?.name ?? "el centro", booking, eventTypeName }),
    });
    return res.ok ? { ok: true, id: res.id } : { ok: false, motivo: "error_meta", error: res.error };
  } catch (err) {
    process.stderr.write(`[citas:whatsapp] ${err.message}\n`);
    return { ok: false, motivo: "excepcion", error: err.message };
  }
}
