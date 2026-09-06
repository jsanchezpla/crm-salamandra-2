import { normalizarBloques } from "./bloques.js";
import { renderCorreo } from "./render.js";

/**
 * lib/mailing/eventos.js — apuntar clics y aperturas, y saber a dónde iba un
 * clic.
 *
 * (Fichero nuevo en /lib, regla #2: lo usan los dos endpoints públicos de
 * medición y «ver en el navegador»; la resolución índice → URL tiene que ser
 * EXACTAMENTE la del render, o el clic llevaría a otro enlace.)
 *
 * El correo no guarda las URL medidas: el token de clic lleva el índice del
 * enlace dentro del correo, y aquí se vuelve a recorrer el correo con el mismo
 * render para saber cuál era. Es determinista (la personalización no cambia
 * las URL), así que un correo enviado hace un año sigue resolviendo.
 */

/** Las URL medidas del correo, en el orden en que las numera el render. */
export function urlsMedidas(campana) {
  const urls = [];
  renderCorreo({
    asunto: campana.asunto || "",
    preheader: campana.preheader,
    bloques: normalizarBloques(campana.bloques),
    centro: { nombre: "x" },
    enlaces: {
      baja: "https://x.invalid/baja",
      rastrear: (url, i) => {
        urls[i] = url;
        return url;
      },
    },
  });
  return urls;
}

/** Apunta un clic y devuelve la URL de destino (o null si el índice no existe). */
export async function registrarClic(ctx, { send, campana, indice, userAgent = null }) {
  const urls = urlsMedidas(campana);
  const url = urls[indice] ?? null;
  const { MailingEvent, MailingSend } = ctx.tenantModels;
  try {
    await MailingEvent.create({ sendId: send.id, campaignId: campana.id, tipo: "clic", url, indice, userAgent: userAgent ? String(userAgent).slice(0, 255) : null });
    await MailingSend.update(
      { clics: (send.clics ?? 0) + 1, primerClicAt: send.primerClicAt ?? new Date(), ...(send.abiertoAt ? {} : { abiertoAt: new Date(), aperturas: (send.aperturas ?? 0) + 1 }) },
      { where: { id: send.id } }
    );
  } catch {
    /* medir nunca rompe la redirección */
  }
  return url;
}

/** Apunta una apertura (el píxel). */
export async function registrarApertura(ctx, { send, campana, userAgent = null }) {
  const { MailingEvent, MailingSend } = ctx.tenantModels;
  try {
    await MailingEvent.create({ sendId: send.id, campaignId: campana.id, tipo: "apertura", userAgent: userAgent ? String(userAgent).slice(0, 255) : null });
    await MailingSend.update({ aperturas: (send.aperturas ?? 0) + 1, abiertoAt: send.abiertoAt ?? new Date() }, { where: { id: send.id } });
  } catch {
    /* idem */
  }
}

/** 1×1 GIF transparente. */
export const GIF_1X1 = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
