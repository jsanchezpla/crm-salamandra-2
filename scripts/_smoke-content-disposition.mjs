// @prueba ligera
/**
 * _smoke-content-disposition.mjs — la cabecera de descarga no tumba la
 * respuesta (10/09/2026, error K8QBN30F).
 *
 * `new Response(..., { headers })` valida cada cabecera como ByteString y
 * LANZA con cualquier code point > 255. Un fichero subido desde un Mac trae la
 * «ñ» descompuesta (n + U+0303 = 771) y eso era un 500 en la descarga. La
 * prueba no mira cómo está escrito el helper: le da al propio constructor de
 * Response la cabecera que sale, que es exactamente lo que hace cada ruta.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { contentDisposition } from "../lib/utils/contentDisposition.js";

/** Lo que hace cada ruta: montar la Response con esa cabecera. */
function respuestaCon(valor) {
  return new Response(null, { headers: { "Content-Disposition": valor } });
}

/** La parte `filename*=UTF-8''...` decodificada, que es lo que lee el navegador. */
function nombreFiel(valor) {
  const m = /filename\*=UTF-8''([^;]+)/.exec(valor);
  assert.ok(m, `sin filename*: ${valor}`);
  return decodeURIComponent(m[1]);
}

/** La parte `filename="..."` de respaldo. */
function nombreRespaldo(valor) {
  const m = /filename="([^"]*)"/.exec(valor);
  assert.ok(m, `sin filename=: ${valor}`);
  return m[1];
}

test("una ñ en NFD (como la sube macOS) no lanza y llega como ñ normal", () => {
  const nfd = "Informe Mun\u0303oz - sesio\u0301n 3.pdf"; // n + tilde combinante, o + acento combinante
  assert.notEqual(nfd, nfd.normalize("NFC"));
  assert.equal(nfd.normalize("NFC"), "Informe Muñoz - sesión 3.pdf");
  // Control: así es como reventaba (el 500 K8QBN30F), con el nombre a pelo.
  assert.throws(() => respuestaCon(`attachment; filename="${nfd}"`), /ByteString/);

  const valor = contentDisposition("attachment", nfd);
  assert.doesNotThrow(() => respuestaCon(valor));

  assert.equal(nombreFiel(valor), "Informe Muñoz - sesión 3.pdf");
  assert.equal(nombreRespaldo(valor), "Informe Munoz - sesion 3.pdf");
  assert.ok(valor.startsWith("attachment; "));
});

test("comillas y barras no rompen la cabecera ni el respaldo", () => {
  const conComillas = 'Plan "definitivo" \\ final.docx';
  const valor = contentDisposition("inline", conComillas);
  assert.doesNotThrow(() => respuestaCon(valor));

  assert.ok(valor.startsWith("inline; "));
  assert.equal(nombreRespaldo(valor), "Plan _definitivo_ _ final.docx");
  assert.equal(nombreFiel(valor), conComillas);
  // Las comillas del nombre no cierran el `filename="..."` antes de tiempo.
  assert.equal((valor.match(/"/g) || []).length, 2);
});

test("un nombre ASCII sale tal cual, en las dos partes", () => {
  const valor = contentDisposition("attachment", "clientes_2026-09-10.xlsx");
  assert.doesNotThrow(() => respuestaCon(valor));
  assert.equal(valor, `attachment; filename="clientes_2026-09-10.xlsx"; filename*=UTF-8''clientes_2026-09-10.xlsx`);
});

test("lo que no cabe en ASCII (€, guion tipográfico, emoji) tampoco lanza", () => {
  const valor = contentDisposition("attachment", "Factura — 120 € 📎.pdf");
  assert.doesNotThrow(() => respuestaCon(valor));
  assert.equal(nombreRespaldo(valor), "Factura _ 120 _ _.pdf");
  assert.equal(nombreFiel(valor), "Factura — 120 € 📎.pdf");
});

test("saltos de línea, nombre vacío y tipo raro: cabecera de una línea y con nombre", () => {
  const conSalto = contentDisposition("attachment", "malo\r\nX-Inyectada: si.pdf");
  assert.doesNotThrow(() => respuestaCon(conSalto));
  assert.ok(!/[\r\n]/.test(conSalto));
  assert.equal(nombreFiel(conSalto), "maloX-Inyectada: si.pdf");

  const vacio = contentDisposition("attachment", "");
  assert.equal(nombreRespaldo(vacio), "archivo");
  assert.equal(nombreRespaldo(contentDisposition("attachment", null)), "archivo");
  assert.equal(nombreRespaldo(contentDisposition("attachment", "\u0303")), "archivo");

  // Cualquier cosa que no sea `inline` es descarga.
  assert.ok(contentDisposition("lo-que-sea", "a.pdf").startsWith("attachment; "));
});

test("los caracteres que RFC 5987 no admite en filename* van codificados", () => {
  const valor = contentDisposition("attachment", "foto (1)*'.jpg");
  assert.doesNotThrow(() => respuestaCon(valor));
  const fiel = /filename\*=UTF-8''([^;]+)/.exec(valor)[1];
  assert.ok(!/[()*']/.test(fiel), fiel);
  assert.equal(decodeURIComponent(fiel), "foto (1)*'.jpg");
});
