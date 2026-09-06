// @prueba ligera
/**
 * _smoke-mailing-bloques-render.mjs — los bloques del mailing y su render
 * (06/09/2026): `lib/mailing/bloques.js` y `lib/mailing/render.js`.
 *
 * Fija lo que DEVUELVEN: que el HTML del bloque de texto se queda en la lista
 * blanca (un <script> pegado se VE como texto, no se ejecuta ni desaparece),
 * que un enlace `javascript:` no sobrevive, que el correo no se puede pintar
 * sin baja, que los enlaces pasan por el rastreador con índices distintos y
 * que el texto plano dice lo mismo que el HTML.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const bloques = await import(pathToFileURL(resolve("lib/mailing/bloques.js")).href);
const { renderCorreo } = await import(pathToFileURL(resolve("lib/mailing/render.js")).href);

test("sanearHtml: lista blanca, alias y cierre de lo abierto", () => {
  assert.equal(bloques.sanearHtml("<p>Hola <b>mundo</b> <i>x</i></p>"), "<p>Hola <strong>mundo</strong> <em>x</em></p>");
  assert.equal(bloques.sanearHtml("<p><strong>sin cerrar"), "<p><strong>sin cerrar</strong></p>");
  assert.equal(bloques.sanearHtml("<div class=\"x\">hola</div>"), "&lt;div class=&quot;x&quot;&gt;hola&lt;/div&gt;");
  assert.equal(bloques.sanearHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(bloques.sanearHtml("a<br/>b<br>c"), "a<br>b<br>c");
  assert.equal(bloques.sanearHtml("</strong>huérfano"), "huérfano");
  assert.equal(bloques.sanearHtml("<!-- nota -->texto"), "texto");
});

test("sanearHtml: enlaces solo http(s)/mailto/tel y sin atributos extra", () => {
  assert.equal(
    bloques.sanearHtml('<a href="https://x.com/?a=1&amp;b=2" onclick="evil()" target="_blank">ir</a>'),
    '<a href="https://x.com/?a=1&amp;b=2">ir</a>'
  );
  assert.equal(bloques.sanearHtml('<a href="javascript:alert(1)">ir</a>'), "ir");
  assert.equal(bloques.sanearHtml("<a href='mailto:a@b.com'>a</a>"), '<a href="mailto:a@b.com">a</a>');
  assert.equal(bloques.sanearHtml("<a>sin href</a>"), "sin href");
});

test("escaparTexto respeta entidades ya escritas y escapa el resto", () => {
  assert.equal(bloques.escaparTexto("a &amp; b & c &nbsp; <x>"), "a &amp; b &amp; c &nbsp; &lt;x&gt;");
});

test("htmlATexto: párrafos, listas y enlaces legibles", () => {
  const t = bloques.htmlATexto('<p>Hola <strong>tú</strong></p><ul><li>uno</li><li>dos</li></ul><p><a href="https://x.com">Web</a> &amp; más</p>');
  assert.equal(t, "Hola tú\n\n· uno\n· dos\n\nWeb (https://x.com) & más");
});

test("normalizarBloques: descarta lo desconocido, recorta y rellena", () => {
  const r = bloques.normalizarBloques([
    { tipo: "titulo", texto: "  Hola  ", nivel: 7, alineacion: "raro" },
    { tipo: "texto", html: "<p>x</p><script>1</script>" },
    { tipo: "imagen", url: "ftp://no", enlace: "https://si.com", ancho: "gigante" },
    { tipo: "boton", texto: "Ir", url: "javascript:1" },
    { tipo: "video", url: "https://x" },
    { tipo: "separador" },
    { tipo: "firma", nombre: "Ana", web: "www.sin-protocolo.com" },
    null,
    "cadena",
  ]);
  assert.deepEqual(
    r.map((b) => b.tipo),
    ["titulo", "texto", "imagen", "boton", "separador", "firma"]
  );
  assert.equal(r[0].texto, "Hola");
  assert.equal(r[0].nivel, 1);
  assert.equal(r[0].alineacion, "izquierda");
  assert.equal(r[1].html, "<p>x</p>&lt;script&gt;1&lt;/script&gt;");
  assert.equal(r[2].url, "");
  assert.equal(r[2].ancho, "completa");
  assert.equal(r[3].url, "");
  assert.equal(r[5].web, "");
  assert.ok(r.every((b) => typeof b.id === "string" && b.id.length > 0));
});

test("bloquesConContenido: un correo vacío no tiene nada que enviar", () => {
  assert.equal(bloques.bloquesConContenido([{ tipo: "separador" }, { tipo: "texto", html: "<p></p>" }]), false);
  assert.equal(bloques.bloquesConContenido([{ tipo: "titulo", texto: "Hola" }]), true);
});

test("personalizar sustituye {{nombre}} y no deja el marcador", () => {
  assert.equal(bloques.personalizar("Hola {{nombre}} / {{ Nombre }}", { nombre: "Ana" }), "Hola Ana / Ana");
  assert.equal(bloques.personalizar("Hola {{nombre}},", {}), "Hola ,");
});

function correoDePrueba(extra = {}) {
  return renderCorreo({
    asunto: "Taller de {{nombre}}",
    preheader: "Plazas limitadas",
    bloques: [
      { tipo: "titulo", texto: "Hola {{nombre}}", nivel: 1, alineacion: "izquierda" },
      { tipo: "texto", html: '<p>Mira <a href="https://centro.com/taller?a=1&amp;b=2">el taller</a></p>' },
      { tipo: "imagen", url: "https://centro.com/img.png", alt: "Cartel", enlace: "https://centro.com/i", ancho: "completa" },
      { tipo: "boton", texto: "Apúntate", url: "https://centro.com/apuntate", alineacion: "centro" },
      { tipo: "separador" },
      { tipo: "firma", nombre: "Ana <López>", cargo: "Directora", empresa: "Centro", telefono: "600", email: "ana@centro.com", web: "https://centro.com" },
    ],
    centro: { nombre: "Centro Ejemplo", direccion: "Calle Mayor 1", brand: { primaryColor: "#123456" } },
    destinatario: { nombre: "Ana", email: "ana@x.com" },
    enlaces: { baja: "https://crm/baja/T", ver: "https://crm/ver/T", pixel: "https://crm/px.gif" },
    ...extra,
  });
}

test("renderCorreo: sin enlace de baja no se pinta", () => {
  assert.throws(() => renderCorreo({ asunto: "x", bloques: [], centro: { nombre: "C" }, enlaces: {} }), /baja/);
});

test("renderCorreo: HTML de tablas con marca, personalización, pie y píxel", () => {
  const r = correoDePrueba();
  assert.equal(r.asunto, "Taller de Ana");
  assert.match(r.html, /<!doctype html>/);
  assert.match(r.html, /background:#123456/);
  assert.match(r.html, />Hola Ana</);
  assert.match(r.html, /Plazas limitadas/);
  assert.match(r.html, /href="https:\/\/crm\/baja\/T"/);
  assert.match(r.html, /Ver en el navegador/);
  assert.match(r.html, /src="https:\/\/crm\/px\.gif"/);
  assert.match(r.html, /Calle Mayor 1/);
  assert.match(r.html, /Ana &lt;López&gt;/);
  assert.doesNotMatch(r.html, /<López>/);
  assert.match(r.html, /v:roundrect/); // botón con VML para Outlook
});

test("renderCorreo: un color de marca inválido cae al de Salamandra", () => {
  const r = correoDePrueba({ centro: { nombre: "C", brand: { primaryColor: '"><script>' } } });
  assert.match(r.html, /background:#1B3A2D/);
  assert.doesNotMatch(r.html, /<script>/);
});

test("renderCorreo: los enlaces pasan por el rastreador con índices seguidos, en HTML y en texto", () => {
  const vistos = [];
  const r = correoDePrueba({
    enlaces: {
      baja: "https://crm/baja/T",
      rastrear: (url, i) => {
        vistos.push([i, url]);
        return `https://crm/clic/${i}`;
      },
    },
  });
  // Cuatro enlaces medidos: texto, imagen, botón y web de la firma.
  assert.equal(r.enlacesMedidos, 4);
  const html = vistos.slice(0, 4);
  assert.deepEqual(
    html.map(([i]) => i),
    [0, 1, 2, 3]
  );
  assert.equal(html[0][1], "https://centro.com/taller?a=1&b=2"); // &amp; deshecho antes de medir
  assert.equal(html[2][1], "https://centro.com/apuntate");
  // El texto plano recorre los mismos enlaces con los mismos índices.
  assert.deepEqual(vistos.slice(4).map(([i, u]) => [i, u]), html);
  assert.match(r.html, /href="https:\/\/crm\/clic\/2"/);
  assert.match(r.text, /Apúntate: https:\/\/crm\/clic\/2/);
  assert.doesNotMatch(r.html, /centro\.com\/apuntate/);
});

test("renderCorreo: la versión en texto dice lo mismo y termina con la baja", () => {
  const r = correoDePrueba();
  assert.match(r.text, /^HOLA ANA\n/);
  assert.match(r.text, /el taller \(https:\/\/centro\.com\/taller\?a=1&b=2\)/);
  assert.match(r.text, /\[Cartel\] https:\/\/centro\.com\/i/);
  assert.match(r.text, /Ana <López>\nDirectora · Centro\n600\nana@centro\.com/);
  assert.match(r.text, /Darme de baja: https:\/\/crm\/baja\/T/);
  assert.match(r.text, /Ver en el navegador: https:\/\/crm\/ver\/T/);
  assert.doesNotMatch(r.text, /<\/?(p|a|td|tr|table|strong|em|img)/); // sin etiquetas HTML
});

test("renderCorreo: sin destinatario el marcador desaparece y sin logo sale el nombre del centro", () => {
  const r = correoDePrueba({ destinatario: undefined });
  assert.match(r.html, />Hola </);
  assert.match(r.html, /CENTRO EJEMPLO|Centro Ejemplo/);
});
