import { enviarSes, getTenantSesConfig } from "./ses.js";
import { urlBase, urlDeConfirmacion, urlDeBaja } from "./enlaces.js";
import { renderCorreo } from "./render.js";
import { centroDe } from "./envio.js";
import { randomUUID } from "node:crypto";

/**
 * lib/mailing/confirmacion.js — el correo de doble opt-in de un correo suelto.
 *
 * (Fichero nuevo en /lib, regla #2: lo mandan el alta a mano, la importación
 * de CSV y el botón «volver a pedir confirmación» de la lista.)
 *
 * Plan, «lo que puede morder» → tasa de quejas: «doble opt-in en los añadidos
 * a mano». Quien llegó a la lista sin una prueba escrita de que dijo que sí
 * recibe UN correo que le pregunta, y no recibe nada más hasta que pincha. El
 * enlace lleva el token HMAC de `bajaToken.js` (propósito «confirmar»), así
 * que no hay tabla de tokens ni caducidad que gestionar.
 *
 * Sale por SES, como todo el módulo: es marketing, no transaccional.
 */
export async function enviarConfirmacion(ctx, contacto, { request = null } = {}) {
  const cfg = getTenantSesConfig(ctx);
  if (!cfg.configurado) return { ok: false, error: "Amazon SES no está configurado" };
  const base = urlBase(request);
  const centro = centroDe(ctx);
  const confirmar = urlDeConfirmacion(base, ctx.slug, contacto.email);
  const correo = renderCorreo({
    asunto: `¿Quieres recibir las novedades de ${centro.nombre}?`,
    preheader: "Un clic y listo. Si no has sido tú, ignora este correo.",
    bloques: [
      { id: randomUUID(), tipo: "titulo", texto: "Confirma tu suscripción", nivel: 1, alineacion: "izquierda" },
      {
        id: randomUUID(),
        tipo: "texto",
        html: `<p>Alguien ha apuntado esta dirección para recibir las novedades y actividades de <strong>${centro.nombre.replace(/[<>&]/g, "")}</strong>. Si has sido tú, confírmalo con el botón. Si no, no tienes que hacer nada: no te escribiremos.</p>`,
      },
      { id: randomUUID(), tipo: "boton", texto: "Sí, quiero recibirlas", url: confirmar, alineacion: "centro" },
    ],
    centro,
    destinatario: { nombre: contacto.nombre, email: contacto.email },
    enlaces: { baja: urlDeBaja(base, ctx.slug, contacto.email), ver: null, pixel: null },
    motivo: "Recibes este único correo porque alguien apuntó tu dirección. Sin tu confirmación no habrá más.",
  });
  const res = await enviarSes(cfg, {
    to: contacto.email,
    subject: correo.asunto,
    html: correo.html,
    text: correo.text,
    tags: [{ name: "crm_confirmacion", value: "1" }],
  });
  if (res.ok) await contacto.update({ confirmacionEnviadaAt: new Date() });
  return res.ok ? { ok: true } : { ok: false, error: `${res.tipo}: ${res.error}` };
}
