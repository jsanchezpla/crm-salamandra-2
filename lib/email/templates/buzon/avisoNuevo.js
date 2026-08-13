/**
 * Plantillas del buzón. Dos correos, y ninguno lleva dentro lo que se escribió
 * entero.
 *
 *   · `avisoParaNosotros` — nos avisa de que ha entrado uno.
 *   · `respuestaParaElCliente` — le avisa de que le hemos contestado.
 *
 * ⚠️ NINGUNO DE LOS DOS ADJUNTA LAS CAPTURAS ni copia el hilo completo. El
 * correo es la NOTIFICACIÓN; la conversación vive en el CRM. Mandar las
 * capturas por Resend sacaría de nuestro sistema un dato que puede ser una
 * pantalla con nombres de pacientes, y lo dejaría en la bandeja de alguien, en
 * su copia de seguridad y en el antivirus de su proveedor — el mismo motivo por
 * el que el recibo de configuración no lleva credenciales.
 */

import { renderLayout, escapeHtml } from "../layout.js";

function recorte(texto, tope = 400) {
  const t = String(texto ?? "").trim();
  return t.length > tope ? `${t.slice(0, tope)}…` : t;
}

/** Para nosotros: ha entrado un aviso. */
export function avisoParaNosotros({ aviso, url }) {
  const quien = aviso.usuarioNombre || aviso.usuarioEmail || "alguien";
  const subject = `${aviso.ref} · ${aviso.tenantNombre || aviso.tenantSlug}: ${recorte(aviso.asunto, 60)}`;

  const bloques = [
    { label: "Cliente", value: aviso.tenantNombre || aviso.tenantSlug },
    { label: "Quién", value: `${quien}${aviso.usuarioRol ? ` (${aviso.usuarioRol})` : ""}` },
    { label: "Tipo", value: aviso.tipo },
    { label: "Pantalla", value: aviso.pantalla || "no la dijo" },
    { label: "Le bloquea", value: aviso.bloquea ? "Sí" : "No" },
  ];

  const html = renderLayout({
    tenantName: "Salamandra Solutions",
    title: aviso.asunto,
    preheader: `${aviso.ref} · ${aviso.tenantNombre || aviso.tenantSlug}`,
    intro: `<p style="margin:0 0 12px;">${escapeHtml(recorte(aviso.cuerpo))}</p>
            <p style="margin:0;"><a href="${escapeHtml(url)}">Abrirlo en el buzón</a></p>`,
    blocks: bloques,
    footer: "Buzón de Salamandra Solutions.",
  });

  const text = [
    `${aviso.ref} — ${aviso.tenantNombre || aviso.tenantSlug}`,
    `${quien}${aviso.usuarioRol ? ` (${aviso.usuarioRol})` : ""} · ${aviso.tipo}${aviso.bloquea ? " · LE BLOQUEA" : ""}`,
    `Pantalla: ${aviso.pantalla || "no la dijo"}`,
    "",
    recorte(aviso.cuerpo),
    "",
    url,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Para el cliente: le hemos contestado.
 *
 * ⚠️ SIN ENLACE, y a propósito. Este correo sale del back-office, que no sabe
 * por qué dominio entra cada cliente: unos van por subdominio nuestro y otros
 * por el suyo propio (`tunutrilaura.com`). Un enlace construido a ojo llevaría
 * a un sitio equivocado, y un enlace roto en un correo de soporte es peor que
 * no ponerlo. Se le dice dónde mirar, que es donde ya está entrando cada día.
 */
export function respuestaParaElCliente({ aviso, mensaje, brand, tenantName }) {
  const subject = `Te hemos contestado · ${aviso.ref}`;

  const html = renderLayout({
    tenantName: tenantName || "Salamandra Solutions",
    brand,
    title: "Te hemos contestado",
    preheader: `${aviso.ref} · ${recorte(aviso.asunto, 60)}`,
    intro: `<p style="margin:0 0 12px;">Sobre <strong>${escapeHtml(aviso.asunto)}</strong>:</p>
            <p style="margin:0 0 16px;">${escapeHtml(recorte(mensaje.cuerpo, 600))}</p>
            <p style="margin:0;color:#6E665B;font-size:14px;">Puedes seguir la conversación en tu CRM, en <strong>Ayuda</strong> — el interrogante de abajo del menú.</p>`,
    footer: "También puedes responder a este correo.",
  });

  const text = [
    `Te hemos contestado sobre "${aviso.asunto}" (${aviso.ref}):`,
    "",
    recorte(mensaje.cuerpo, 600),
    "",
    "Puedes seguir la conversación en tu CRM, en Ayuda (el interrogante de abajo del menú), o responder a este correo.",
  ].join("\n");

  return { subject, html, text };
}
