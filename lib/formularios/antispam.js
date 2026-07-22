/**
 * lib/formularios/antispam.js — defensas del endpoint público.
 *
 * Honestidad por delante: NADA de esto es un muro. El contador de peticiones
 * vive en la memoria del proceso y se fía de una cabecera que quien ataca
 * puede falsificar. Lo que hacen estas capas es quitar de en medio el ruido
 * real —bots genéricos que rellenan cualquier formulario que encuentran—, que
 * es el 99% del problema de un formulario de una consulta de nutrición.
 *
 * Si algún día entra spam de verdad, el siguiente paso es un captcha
 * (Turnstile de Cloudflare es gratis), y eso ya es infraestructura nueva.
 *
 * Cuatro capas:
 *   1. Campo trampa (honeypot): invisible para personas, irresistible para un bot.
 *   2. Trampa de tiempo: un formulario enviado en menos de 3 segundos no lo ha
 *      leído nadie.
 *   3. Topes de longitud: los aplica lib/formularios/fields.js por campo.
 *   4. Duplicados: mismo teléfono o email en los últimos minutos.
 *
 * Las capas 1 y 2 NO rechazan: puntúan. A un bot se le responde "gracias" y no
 * se guarda nada, porque un error le diría exactamente qué corregir.
 */

import { Op } from "sequelize";

/** Minutos dentro de los cuales dos envíos del mismo contacto son el mismo. */
const VENTANA_DUPLICADO_MIN = 10;

/**
 * Puntúa una petición. 0 = limpia; ≥2 = tratar como bot (responder bien pero
 * no guardar).
 */
export function puntuarSpam(cuerpo, { campoTrampa = "web" } = {}) {
  let puntos = 0;
  const motivos = [];

  // 1. Campo trampa relleno.
  const trampa = cuerpo?.[campoTrampa];
  if (typeof trampa === "string" && trampa.trim()) {
    puntos += 2;
    motivos.push("campo trampa relleno");
  }

  // 2. Enviado demasiado rápido para haberlo leído.
  const abiertoEn = Number(cuerpo?._t);
  if (Number.isFinite(abiertoEn) && abiertoEn > 0) {
    const segundos = (Date.now() - abiertoEn) / 1000;
    if (segundos >= 0 && segundos < 3) {
      puntos += 2;
      motivos.push(`enviado en ${segundos.toFixed(1)}s`);
    }
  }

  // 3. Enlaces en campos que no deberían llevarlos: firma clásica de spam.
  const textos = Object.entries(cuerpo || {})
    .filter(([k]) => !["_t", campoTrampa].includes(k))
    .map(([, v]) => (typeof v === "string" ? v : ""))
    .join(" ");
  const enlaces = (textos.match(/https?:\/\//gi) || []).length;
  if (enlaces >= 2) {
    puntos += 2;
    motivos.push(`${enlaces} enlaces en las respuestas`);
  }

  return { puntos, motivos };
}

/**
 * ¿Esta persona acaba de enviar lo mismo? Evita duplicados por doble clic o por
 * un reintento del navegador. Devuelve la solicitud previa o null.
 */
export async function buscarDuplicadoReciente(FormSubmission, { formId, phone, email }) {
  const desde = new Date(Date.now() - VENTANA_DUPLICADO_MIN * 60 * 1000);
  const contacto = [];
  if (phone) contacto.push({ phone });
  if (email) contacto.push({ email });
  if (contacto.length === 0) return null;

  return FormSubmission.findOne({
    where: {
      formId,
      createdAt: { [Op.gte]: desde },
      [Op.or]: contacto,
    },
    attributes: ["id", "createdAt"],
    order: [["createdAt", "DESC"]],
  });
}
