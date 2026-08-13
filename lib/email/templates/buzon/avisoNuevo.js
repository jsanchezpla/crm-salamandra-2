/**
 * La plantilla del buzón. UNA, y va en un solo sentido: hacia nosotros.
 *
 * Hubo una segunda —«te hemos contestado», hacia el cliente— y se quitó el
 * 13/08/2026 a petición de Jorge: al cliente se le avisa DENTRO de su CRM, con
 * la campana y el bloque de la portada. Es gente que entra todos los días, así
 * que un correo por cada respuesta era ruido en una bandeja que ya va llena.
 * Este otro sí hace falta: sin él no nos enteraríamos de que ha entrado un
 * aviso hasta que alguien se acordara de abrir el panel.
 *
 * ⚠️ NO ADJUNTA LAS CAPTURAS ni copia el hilo. El correo es la NOTIFICACIÓN; la
 * conversación vive en el CRM. Mandar las capturas por Resend sacaría de nuestro
 * sistema un dato que puede ser una pantalla con nombres de pacientes, y lo
 * dejaría en la bandeja de alguien, en su copia de seguridad y en el antivirus
 * de su proveedor — el mismo motivo por el que el recibo de configuración no
 * lleva credenciales.
 */

import { renderLayout, escapeHtml } from "../layout.js";
import { referencia } from "../../../buzon/buzon.js";

function recorte(texto, tope = 400) {
  const t = String(texto ?? "").trim();
  return t.length > tope ? `${t.slice(0, tope)}…` : t;
}

/**
 * La referencia se CALCULA de `numero`, no se lee de `aviso.ref`.
 *
 * Por qué: a estas plantillas les llega a veces la fila de Sequelize y a veces
 * el objeto ya serializado, y `ref` solo existe en el segundo. Leerlo a secas
 * compilaba, no daba ningún error y mandaba un correo con el asunto «Te hemos
 * contestado · undefined» — visto en producción el 13/08/2026, en la primera
 * respuesta que se mandó.
 */
function refDe(aviso) {
  return aviso.ref ?? referencia(aviso.numero);
}

/** Para nosotros: ha entrado un aviso. */
export function avisoParaNosotros({ aviso, url }) {
  const quien = aviso.usuarioNombre || aviso.usuarioEmail || "alguien";
  const subject = `${refDe(aviso)} · ${aviso.tenantNombre || aviso.tenantSlug}: ${recorte(aviso.asunto, 60)}`;

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
    preheader: `${refDe(aviso)} · ${aviso.tenantNombre || aviso.tenantSlug}`,
    intro: `<p style="margin:0 0 12px;">${escapeHtml(recorte(aviso.cuerpo))}</p>
            <p style="margin:0;"><a href="${escapeHtml(url)}">Abrirlo en el buzón</a></p>`,
    blocks: bloques,
    footer: "Buzón de Salamandra Solutions.",
  });

  const text = [
    `${refDe(aviso)} — ${aviso.tenantNombre || aviso.tenantSlug}`,
    `${quien}${aviso.usuarioRol ? ` (${aviso.usuarioRol})` : ""} · ${aviso.tipo}${aviso.bloquea ? " · LE BLOQUEA" : ""}`,
    `Pantalla: ${aviso.pantalla || "no la dijo"}`,
    "",
    recorte(aviso.cuerpo),
    "",
    url,
  ].join("\n");

  return { subject, html, text };
}
