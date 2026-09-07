// @prueba ligera
// Fija la VISTA PREVIA de la factura (`buildInvoicePreviewPdfBuffer` de
// lib/billing/invoicePdf.js, 07/09/2026, Rodrigo: «quiero que haya una vista
// previa de las facturas antes de emitirlas con un botón»).
//
// Lo que tiene que cumplir, y por eso se prueba aquí:
//
//   · Dice EXACTAMENTE lo mismo que la factura. Una vista previa que no fuera
//     el documento de verdad no serviría para decidir si se emite: la prueba
//     compara letra a letra el texto de los dos PDF quitando la marca.
//   · Va marcada en TODAS las páginas. Con la marca solo en la primera, la
//     segunda hoja de una factura larga se imprime y pasa por documento.
//
// Lector compacto, el mismo de _smoke-pdf-paciente-sello.mjs (aquí devuelve el
// texto PÁGINA A PÁGINA, que es lo que hay que contar).
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { buildInvoicePdfBuffer, buildInvoicePreviewPdfBuffer, invoicePdfFilename } from "../lib/billing/invoicePdf.js";

/* ── lector compacto (véase _smoke-pdf-presupuesto.mjs) ── */
const WIN1252 = { 0x80: "€" };
function objetosDe(bruto) {
  const re = /(?:^|\n)(\d+) 0 obj/g;
  const marcas = [];
  let m;
  while ((m = re.exec(bruto))) marcas.push({ num: Number(m[1]), desde: m.index + (m[0][0] === "\n" ? 1 : 0) });
  const objetos = new Map();
  for (let i = 0; i < marcas.length; i++) {
    objetos.set(marcas[i].num, bruto.slice(marcas[i].desde, i + 1 < marcas.length ? marcas[i + 1].desde : bruto.length));
  }
  return objetos;
}
function flujoDe(objeto) {
  const i = objeto.indexOf("stream");
  if (i < 0) return "";
  const datos = Buffer.from(objeto.slice(objeto.indexOf("\n", i) + 1, objeto.lastIndexOf("endstream")), "latin1");
  if (!/\/FlateDecode/.test(objeto.slice(0, i))) return datos.toString("latin1");
  try { return zlib.inflateSync(datos).toString("latin1"); } catch { return ""; }
}
const bytesDeHex = (hex) => Buffer.from(hex.replace(/\s+/g, ""), "hex");
function descodifica(hex) {
  let s = "";
  for (const byte of bytesDeHex(hex)) s += WIN1252[byte] ?? String.fromCharCode(byte);
  return s;
}
/** El texto de cada página, en su orden. La factura escribe con las Helvetica
 *  de serie: un byte por letra, sin `/ToUnicode` que traducir. */
function paginasDe(buffer) {
  const bruto = buffer.toString("latin1");
  const objetos = objetosDe(bruto);
  const paginas = [];
  for (const [, objeto] of objetos) {
    if (!/\/Type\s*\/Page[^s]/.test(objeto)) continue;
    const contRef = objeto.match(/\/Contents\s+(\d+) 0 R/);
    const contenido = flujoDe(objetos.get(contRef ? Number(contRef[1]) : -1) || "");
    let texto = "";
    for (const m of contenido.matchAll(/\[([\s\S]*?)\]\s*TJ|<([0-9A-Fa-f\s]*)>\s*Tj/g)) {
      const trozo = m[1] ?? m[2] ?? "";
      for (const hex of trozo.matchAll(/<([0-9A-Fa-f\s]+)>/g)) texto += descodifica(hex[1]);
      if (m[2] != null) texto += descodifica(m[2]);
      texto += "\n";
    }
    paginas.push(texto);
  }
  return paginas;
}
const textoDe = (buffer) => paginasDe(buffer).join("");

/** Un borrador de tres páginas: la marca tiene que salir en las tres. */
const BORRADOR = {
  id: "3f9c1b22-4d51-4a0e-9c7a-77c0f1d2ab34",
  series: "F",
  number: null,
  status: "draft",
  issueDate: "2026-09-07",
  dueDate: "2026-10-07",
  taxBase: "6000.00",
  vatAmount: "1260.00",
  total: "7260.00",
  paidAmount: "0.00",
  lines: Array.from({ length: 60 }, (_, i) => ({
    description: `Sesión de logopedia ${i + 1}`,
    quantity: 1,
    unitPrice: 100,
    discountPct: 0,
    vatRate: 21,
    lineBase: 100,
    lineVat: 21,
  })),
  customFields: {},
};
const CLIENT = { name: "Familia Castro Díaz", fiscalName: "Familia Castro Díaz", fiscalTaxId: "12345678Z" };
const SETTINGS = { fiscalName: "AUMENTA C.B.", taxId: "E87050720" };

test("la vista previa va marcada en TODAS las páginas; la factura, en ninguna", async () => {
  const previa = paginasDe(await buildInvoicePreviewPdfBuffer({ invoice: BORRADOR, client: CLIENT, settings: SETTINGS }));
  assert.ok(previa.length >= 2, `esta factura tenía que ocupar varias páginas (salieron ${previa.length})`);
  for (const [i, pagina] of previa.entries()) {
    assert.match(pagina, /VISTA PREVIA/, `la página ${i + 1} salió sin marcar`);
  }
  const emitida = paginasDe(await buildInvoicePdfBuffer({ invoice: BORRADOR, client: CLIENT, settings: SETTINGS }));
  assert.equal(emitida.length, previa.length, "la marca cambió el número de páginas");
  for (const [i, pagina] of emitida.entries()) {
    assert.ok(!/VISTA PREVIA/.test(pagina), `la factura de verdad salió marcada en la página ${i + 1}`);
  }
});

test("la vista previa dice lo mismo que la factura: quitando la marca, el texto es idéntico", async () => {
  const previa = textoDe(await buildInvoicePreviewPdfBuffer({ invoice: BORRADOR, client: CLIENT, settings: SETTINGS }));
  const factura = textoDe(await buildInvoicePdfBuffer({ invoice: BORRADOR, client: CLIENT, settings: SETTINGS }));
  assert.equal(previa.replace(/VISTA PREVIA\n/g, ""), factura);
});

test("el borrador se ve como borrador: sin número de serie y con su estado", async () => {
  const previa = textoDe(await buildInvoicePreviewPdfBuffer({ invoice: BORRADOR, client: CLIENT, settings: SETTINGS }));
  assert.match(previa, /BORRADOR/);
  assert.match(previa, /Estado: Borrador/);
  assert.match(previa, /Familia Castro Díaz/);
  assert.match(previa, /7\.260,00 €/);
});

test("el nombre del fichero distingue la vista previa del documento", () => {
  assert.equal(invoicePdfFilename(BORRADOR, { previa: true }), "vista-previa-borrador-3f9c1b22.pdf");
  assert.equal(invoicePdfFilename(BORRADOR), "factura-borrador-3f9c1b22.pdf");
  // Y una emitida sigue llamándose como se llamaba (lo fija también
  // _smoke-pdf-factura-informe.mjs: el parámetro nuevo no cambia el nombre).
  assert.equal(invoicePdfFilename({ ...BORRADOR, status: "issued", number: "F-2026-0042" }), "factura-F-2026-0042.pdf");
});
