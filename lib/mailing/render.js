/**
 * lib/mailing/render.js — de los bloques de una campaña al correo: HTML de
 * tablas con CSS en línea (lo que Outlook entiende) y su versión en texto.
 *
 * (Fichero nuevo en /lib, regla #2: lo usan el envío, el envío de prueba, la
 * vista previa del editor y «ver en el navegador». Cuatro sitios, un HTML: si
 * la vista previa y lo que sale por SES se pintaran con código distinto, el
 * cliente aprobaría un correo y recibiría otro.)
 *
 * ── LO QUE HACE Y POR QUÉ ───────────────────────────────────────────────────
 *
 * · Tablas de 600 px, todo el CSS en línea, sin `<style>` que dependa del
 *   cliente de correo. Botón con VML para Outlook. Es el HTML de correo de
 *   toda la vida y por eso se ve igual en todas partes.
 * · La versión en TEXTO no es opcional (plan 2.2): sube la entregabilidad y es
 *   lo que lee quien tiene las imágenes bloqueadas o un lector de pantalla.
 * · Los enlaces salen por `enlaces.rastrear(url, indice)`: el envío los
 *   envuelve en la redirección medida y la vista previa los deja tal cual.
 *   El pie lleva SIEMPRE la baja de un clic (`enlaces.baja`) y «ver en el
 *   navegador» (`enlaces.ver`). Sin baja no se renderiza: es ley y política
 *   de AWS, y la única forma de garantizarlo es que este fichero no sepa
 *   pintar un correo sin ella.
 * · Los colores de marca del cliente se validan como en
 *   `lib/email/templates/layout.js` (`safeColor`): van crudos dentro de
 *   `style="…"` y un color mal guardado no puede convertirse en HTML.
 */

import { escaparTodo, htmlATexto, personalizar } from "./bloques.js";

const MARCA_POR_DEFECTO = {
  primaryColor: "#1B3A2D",
  fondo: "#F3F4F6",
  tarjeta: "#FFFFFF",
  texto: "#1F2937",
  apagado: "#6B7280",
};

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const RGB_RE = /^rgba?\(\s*[\d.,\s%]+\)$/i;
const NAME_RE = /^[a-zA-Z]{3,20}$/;
function safeColor(v, fallback) {
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  return HEX_RE.test(t) || RGB_RE.test(t) || NAME_RE.test(t) ? t : fallback;
}

const FUENTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function alinear(a) {
  return a === "centro" ? "center" : a === "derecha" ? "right" : "left";
}

/**
 * Envuelve cada `href` del HTML saneado con el rastreador. El índice de enlace
 * es global al correo (lo comparte con botones e imágenes) para que la
 * métrica pueda decir «el segundo enlace es el que más clics tuvo».
 */
function rastrearEnlaces(html, contador, rastrear) {
  return html.replace(/<a href="([^"]*)">/g, (todo, href) => {
    const crudo = href.replace(/&amp;/g, "&");
    const destino = rastrear(crudo, contador.n++);
    return `<a href="${escaparTodo(destino)}" style="color:inherit;text-decoration:underline;">`;
  });
}

function pintarBloque(b, ctx) {
  const { marca, contador, rastrear, destinatario } = ctx;
  switch (b.tipo) {
    case "titulo": {
      const tam = b.nivel === 2 ? "20px" : "26px";
      return `<tr><td style="padding:8px 32px;text-align:${alinear(b.alineacion)};font-family:${FUENTE};font-size:${tam};line-height:1.25;font-weight:600;color:${marca.texto};">${escaparTodo(personalizar(b.texto, destinatario))}</td></tr>`;
    }
    case "texto": {
      const html = rastrearEnlaces(personalizar(b.html, destinatario), contador, rastrear)
        .replace(/<p>/g, `<p style="margin:0 0 12px;">`)
        .replace(/<(ul|ol)>/g, `<$1 style="margin:0 0 12px;padding-left:22px;">`);
      return `<tr><td style="padding:6px 32px;font-family:${FUENTE};font-size:16px;line-height:1.55;color:${marca.texto};">${html}</td></tr>`;
    }
    case "imagen": {
      if (!b.url) return "";
      const ancho = b.ancho === "media" ? 268 : 536;
      const img = `<img src="${escaparTodo(b.url)}" alt="${escaparTodo(b.alt)}" width="${ancho}" style="display:block;width:100%;max-width:${ancho}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:6px;">`;
      const cuerpo = b.enlace
        ? `<a href="${escaparTodo(rastrear(b.enlace, contador.n++))}" style="text-decoration:none;">${img}</a>`
        : img;
      return `<tr><td style="padding:10px 32px;" align="center">${cuerpo}</td></tr>`;
    }
    case "boton": {
      if (!b.url || !b.texto) return "";
      const url = escaparTodo(rastrear(b.url, contador.n++));
      const textoBoton = escaparTodo(personalizar(b.texto, destinatario));
      const color = marca.primaryColor;
      // VML para Outlook de escritorio + el <a> de siempre para el resto.
      return `<tr><td style="padding:14px 32px;" align="${alinear(b.alineacion)}">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="14%" strokecolor="${color}" fillcolor="${color}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:600;">${textoBoton}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${url}" style="display:inline-block;background:${color};color:#ffffff;font-family:${FUENTE};font-size:16px;font-weight:600;line-height:44px;text-align:center;text-decoration:none;padding:0 28px;border-radius:6px;mso-hide:all;">${textoBoton}</a><!--<![endif]-->
</td></tr>`;
    }
    case "separador":
      return `<tr><td style="padding:12px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-top:1px solid #E5E7EB;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`;
    case "firma": {
      const lineas = [];
      if (b.nombre) lineas.push(`<div style="font-weight:600;color:${marca.texto};">${escaparTodo(b.nombre)}</div>`);
      const cargoEmpresa = [b.cargo, b.empresa].filter(Boolean).join(" · ");
      if (cargoEmpresa) lineas.push(`<div style="color:${marca.apagado};">${escaparTodo(cargoEmpresa)}</div>`);
      const contacto = [];
      if (b.telefono) contacto.push(escaparTodo(b.telefono));
      if (b.email) contacto.push(`<a href="mailto:${escaparTodo(b.email)}" style="color:${marca.primaryColor};text-decoration:none;">${escaparTodo(b.email)}</a>`);
      if (b.web) {
        const url = escaparTodo(rastrear(b.web, contador.n++));
        contacto.push(`<a href="${url}" style="color:${marca.primaryColor};text-decoration:none;">${escaparTodo(b.web.replace(/^https?:\/\//, ""))}</a>`);
      }
      if (contacto.length) lineas.push(`<div style="color:${marca.apagado};">${contacto.join(" · ")}</div>`);
      if (!lineas.length) return "";
      const foto = b.imagenUrl
        ? `<td width="64" valign="top" style="padding-right:14px;"><img src="${escaparTodo(b.imagenUrl)}" alt="" width="56" height="56" style="display:block;border-radius:28px;border:0;"></td>`
        : "";
      return `<tr><td style="padding:14px 32px;font-family:${FUENTE};font-size:14px;line-height:1.5;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>${foto}<td valign="top">${lineas.join("")}</td></tr></table></td></tr>`;
    }
    default:
      return "";
  }
}

function textoDeBloque(b, destinatario, rastrear, contador) {
  switch (b.tipo) {
    case "titulo":
      return b.texto ? personalizar(b.texto, destinatario).toUpperCase() : "";
    case "texto": {
      // En texto plano los enlaces también salen medidos: el índice tiene que
      // avanzar igual que en el HTML para que apunten al mismo destino.
      const html = personalizar(b.html, destinatario).replace(/<a href="([^"]*)">/g, (todo, href) => {
        const destino = rastrear(href.replace(/&amp;/g, "&"), contador.n++);
        return `<a href="${escaparTodo(destino)}">`;
      });
      return htmlATexto(html);
    }
    case "imagen": {
      if (!b.url) return "";
      const enlace = b.enlace ? rastrear(b.enlace, contador.n++) : "";
      return [b.alt ? `[${b.alt}]` : "[imagen]", enlace].filter(Boolean).join(" ");
    }
    case "boton":
      return b.url && b.texto ? `${personalizar(b.texto, destinatario)}: ${rastrear(b.url, contador.n++)}` : "";
    case "separador":
      return "— — —";
    case "firma": {
      const l = [b.nombre, [b.cargo, b.empresa].filter(Boolean).join(" · "), b.telefono, b.email];
      if (b.web) l.push(rastrear(b.web, contador.n++));
      return l.filter(Boolean).join("\n");
    }
    default:
      return "";
  }
}

/**
 * @param {{
 *   asunto: string, preheader?: string, bloques: Array<object>,
 *   centro: { nombre: string, direccion?: string, brand?: object },
 *   destinatario?: { nombre?: string, email?: string },
 *   enlaces: { baja: string, ver?: string|null, pixel?: string|null, rastrear?: (url:string, i:number)=>string },
 *   motivo?: string,   // «Recibes este correo porque…»
 * }} p
 * @returns {{ html: string, text: string, asunto: string, enlacesMedidos: number }}
 */
export function renderCorreo(p) {
  if (!p?.enlaces?.baja) throw new Error("renderCorreo: falta el enlace de baja");
  const brand = p.centro?.brand ?? {};
  const marca = {
    primaryColor: safeColor(brand.primaryColor, MARCA_POR_DEFECTO.primaryColor),
    fondo: MARCA_POR_DEFECTO.fondo,
    tarjeta: MARCA_POR_DEFECTO.tarjeta,
    texto: MARCA_POR_DEFECTO.texto,
    apagado: MARCA_POR_DEFECTO.apagado,
  };
  const rastrear = typeof p.enlaces.rastrear === "function" ? p.enlaces.rastrear : (u) => u;
  const destinatario = p.destinatario ?? {};
  const contadorHtml = { n: 0 };
  const contadorTexto = { n: 0 };
  const nombreCentro = String(p.centro?.nombre ?? "").trim() || "Nuestro centro";
  const asunto = personalizar(p.asunto, destinatario);
  const preheader = personalizar(p.preheader ?? "", destinatario);
  const motivo =
    p.motivo ||
    `Recibes este correo porque aceptaste recibir novedades de ${nombreCentro}.`;

  const logo = typeof brand.logoUrl === "string" && /^https?:\/\//i.test(brand.logoUrl) ? brand.logoUrl : null;
  const cabecera = logo
    ? `<img src="${escaparTodo(logo)}" alt="${escaparTodo(nombreCentro)}" height="40" style="display:block;height:40px;width:auto;border:0;">`
    : `<div style="font-family:${FUENTE};font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:${marca.apagado};">${escaparTodo(nombreCentro)}</div>`;

  const cuerpo = (p.bloques ?? [])
    .map((b) => pintarBloque(b, { marca, contador: contadorHtml, rastrear, destinatario }))
    .join("\n");

  const verEnNavegador = p.enlaces.ver
    ? ` · <a href="${escaparTodo(p.enlaces.ver)}" style="color:${marca.apagado};text-decoration:underline;">Ver en el navegador</a>`
    : "";
  const pixel = p.enlaces.pixel
    ? `<img src="${escaparTodo(p.enlaces.pixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`
    : "";

  const html = `<!doctype html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<title>${escaparTodo(asunto)}</title>
</head>
<body style="margin:0;padding:0;background:${marca.fondo};">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escaparTodo(preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${marca.fondo};">
<tr><td align="center" style="padding:28px 12px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:${marca.tarjeta};border-radius:10px;">
<tr><td style="height:5px;background:${marca.primaryColor};border-radius:10px 10px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:22px 32px 10px;">${cabecera}</td></tr>
${cuerpo}
<tr><td style="padding:22px 32px 26px;border-top:1px solid #E5E7EB;font-family:${FUENTE};font-size:12px;line-height:1.6;color:${marca.apagado};">
${escaparTodo(motivo)}${p.centro?.direccion ? `<br>${escaparTodo(nombreCentro)} · ${escaparTodo(p.centro.direccion)}` : ""}<br>
<a href="${escaparTodo(p.enlaces.baja)}" style="color:${marca.apagado};text-decoration:underline;">Darme de baja</a>${verEnNavegador}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
${pixel}
</td></tr>
</table>
</body>
</html>`;

  const lineas = (p.bloques ?? [])
    .map((b) => textoDeBloque(b, destinatario, rastrear, contadorTexto))
    .filter(Boolean);
  const text = [
    ...lineas,
    "",
    "—",
    motivo,
    p.centro?.direccion ? `${nombreCentro} · ${p.centro.direccion}` : nombreCentro,
    `Darme de baja: ${p.enlaces.baja}`,
    ...(p.enlaces.ver ? [`Ver en el navegador: ${p.enlaces.ver}`] : []),
  ].join("\n");

  return { html, text, asunto, enlacesMedidos: contadorHtml.n };
}
