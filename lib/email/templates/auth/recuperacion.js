/**
 * La plantilla del enlace de recuperación. UNA, y solo para ADMINS: los demás
 * no reciben correo — a ellos les restablece su admin desde Equipo, y el aviso
 * les llega a los admin por la campana (lib/auth/recuperacion.js).
 *
 * El enlace lleva el token en claro; es su único viaje. Caduca en minutos y es
 * de un solo uso, y por eso el correo lo dice: quien lo abra tarde tiene que
 * saber que no está roto, está caducado.
 */

import { renderLayout, escapeHtml } from "../layout.js";

export function correoDeRecuperacion({ nombre, tenantNombre, url, minutos }) {
  const subject = `Recupera tu contraseña del CRM de ${tenantNombre}`;

  const html = renderLayout({
    tenantName: "Salamandra Solutions",
    preheader: `Enlace para elegir una contraseña nueva. Caduca en ${minutos} minutos.`,
    title: "Recupera tu contraseña",
    intro:
      `<p style="margin:0 0 12px;">Hola${nombre ? ` ${escapeHtml(nombre)}` : ""}: alguien —seguramente tú— ha pedido ` +
      `recuperar la contraseña de tu cuenta de administrador en el CRM de ` +
      `<strong>${escapeHtml(tenantNombre)}</strong>.</p>` +
      `<p style="margin:0;">Este botón abre una página donde eliges la nueva. ` +
      `Vale <strong>${minutos} minutos</strong> y un solo uso.</p>`,
    bodyHtml:
      `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px auto;">` +
      `<tr><td style="border-radius:10px;background:#1F3B34;">` +
      `<a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Elegir contraseña nueva</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 8px;font-size:13px;color:#3E5C57;">Si el botón no funciona, copia este enlace:</p>` +
      `<p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#3E5C57;">${escapeHtml(url)}</p>` +
      `<p style="margin:0;font-size:13px;color:#3E5C57;">¿No lo has pedido tú? No toques nada: el enlace caducará solo ` +
      `y tu contraseña sigue como estaba. Si se repite, escríbenos a info@salamandrasolutions.com.</p>`,
    footer: "Enviado por Salamandra Solutions, que gestiona el CRM de tu centro.",
  });

  const text =
    `Hola${nombre ? ` ${nombre}` : ""}: has pedido recuperar la contraseña de tu cuenta de ` +
    `administrador en el CRM de ${tenantNombre}.\n\n` +
    `Abre este enlace para elegir una nueva (vale ${minutos} minutos, un solo uso):\n${url}\n\n` +
    `Si no lo has pedido tú, no hagas nada: caducará solo.`;

  return { subject, html, text };
}
