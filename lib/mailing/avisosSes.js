import { Op } from "sequelize";
import { suprimirEmail } from "./supresion.js";
import { normalizarEmail } from "./bajaToken.js";

/**
 * lib/mailing/avisosSes.js — qué se hace con un rebote o una queja de SES.
 *
 * (Fichero nuevo en /lib, regla #2: es la lógica del webhook, separada de la
 * ruta para poder probarla con eventos de ejemplo sin servidor.)
 *
 * SES manda dos formatos según cómo esté configurada la cuenta: las
 * «notificaciones» de identidad (`notificationType`) y los «eventos» de un
 * configuration set (`eventType`). Aquí se aceptan los dos.
 *
 *   Bounce, bounceType Permanent  → supresión (motivo `rebote`) + envío `rebotado`
 *   Bounce, bounceType Transient  → envío `rebotado` con el motivo, SIN supresión
 *                                    (buzón lleno, servidor caído: se le puede
 *                                    volver a escribir)
 *   Complaint                     → supresión (motivo `queja`) + envío `queja`.
 *                                    Es lo que AWS mide: por encima del 0,1 % te
 *                                    revisan y en el 0,5 % te paran.
 *   Delivery, Send, Open, Click…  → se ignoran (los clics y aperturas los
 *                                    medimos nosotros)
 *
 * El envío se localiza por `mail.messageId` (que es el `sesMessageId` que
 * guardamos al enviar); si no aparece —correo de prueba, aviso muy viejo—, la
 * supresión se apunta igual: la dirección es lo que importa.
 */
export function clasificarAviso(evento) {
  const tipo = String(evento?.notificationType ?? evento?.eventType ?? "").toLowerCase();
  if (tipo === "bounce") {
    const permanente = String(evento?.bounce?.bounceType ?? "").toLowerCase() === "permanent";
    const destinatarios = (evento?.bounce?.bouncedRecipients ?? []).map((r) => normalizarEmail(r?.emailAddress)).filter(Boolean);
    const detalle = [evento?.bounce?.bounceType, evento?.bounce?.bounceSubType, evento?.bounce?.bouncedRecipients?.[0]?.diagnosticCode].filter(Boolean).join(" · ").slice(0, 500);
    return { tipo: "bounce", permanente, destinatarios, detalle };
  }
  if (tipo === "complaint") {
    const destinatarios = (evento?.complaint?.complainedRecipients ?? []).map((r) => normalizarEmail(r?.emailAddress)).filter(Boolean);
    const detalle = [evento?.complaint?.complaintFeedbackType, evento?.complaint?.userAgent].filter(Boolean).join(" · ").slice(0, 500);
    return { tipo: "complaint", destinatarios, detalle };
  }
  return { tipo: tipo || "desconocido", destinatarios: [] };
}

export async function procesarAvisoSes(ctx, evento) {
  const aviso = clasificarAviso(evento);
  if (aviso.tipo !== "bounce" && aviso.tipo !== "complaint") return { ignorado: aviso.tipo };

  const { MailingSend } = ctx.tenantModels;
  const messageId = evento?.mail?.messageId ?? null;
  const envio = messageId ? await MailingSend.findOne({ where: { sesMessageId: messageId } }) : null;
  const campaignId = envio?.campaignId ?? null;

  let suprimidos = 0;
  for (const email of aviso.destinatarios) {
    if (aviso.tipo === "complaint" || aviso.permanente) {
      const r = await suprimirEmail(ctx, { email, motivo: aviso.tipo === "complaint" ? "queja" : "rebote", detalle: aviso.detalle, campaignId });
      if (r.nueva) suprimidos++;
    }
    // El envío concreto, si se conoce; si no, cualquiera enviado a esa dirección en las últimas 72 h.
    const where = envio ? { id: envio.id } : { email, estado: "enviado", enviadoAt: { [Op.gte]: new Date(Date.now() - 72 * 3600000) } };
    await MailingSend.update(
      { estado: aviso.tipo === "complaint" ? "queja" : "rebotado", error: aviso.detalle || aviso.tipo },
      { where }
    );
  }
  return { tipo: aviso.tipo, destinatarios: aviso.destinatarios.length, suprimidos, envio: envio?.id ?? null };
}
