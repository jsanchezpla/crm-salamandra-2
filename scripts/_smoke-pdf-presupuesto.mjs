// @prueba ligera
// Fija el PDF de PRESUPUESTO (lib/billing/invoicePdf.js → buildQuotePdfBuffer):
// mismo lienzo que la factura con otro rótulo. El lector de PDF es la versión
// compacta del de _smoke-pdf-factura-informe.mjs (sin posiciones: aquí basta
// con saber QUÉ texto salió); la factura sigue vigilada por aquella prueba.
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { buildQuotePdfBuffer, quotePdfFilename } from "../lib/billing/invoicePdf.js";

/* ── lector compacto ── */
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
function letrasUtf16(hex) {
  const b = bytesDeHex(hex);
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return s;
}
function cmapDe(texto) {
  const mapa = new Map();
  for (const bloque of texto.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const par of bloque.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) mapa.set(parseInt(par[1], 16), letrasUtf16(par[2]));
  }
  for (const bloque of texto.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:\[([\s\S]*?)\]|<([0-9A-Fa-f]+)>)/g;
    let m;
    while ((m = re.exec(bloque))) {
      const primero = parseInt(m[1], 16), ultimo = parseInt(m[2], 16);
      if (m[3] != null) (m[3].match(/<[0-9A-Fa-f]*>/g) || []).forEach((d, i) => mapa.set(primero + i, letrasUtf16(d.slice(1, -1))));
      else for (let c = primero; c <= ultimo; c++) mapa.set(c, String.fromCharCode(parseInt(m[4], 16) + (c - primero)));
    }
  }
  return mapa;
}
function descodifica(hex, cmap) {
  const b = bytesDeHex(hex);
  if (!cmap) { let s = ""; for (const byte of b) s += WIN1252[byte] ?? String.fromCharCode(byte); return s; }
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) s += cmap.get((b[i] << 8) | b[i + 1]) ?? "";
  return s;
}
function textoDe(buffer) {
  const bruto = buffer.toString("latin1");
  const objetos = objetosDe(bruto);
  let texto = "";
  for (const [, objeto] of objetos) {
    if (!/\/Type\s*\/Page[^s]/.test(objeto)) continue;
    const contRef = objeto.match(/\/Contents\s+(\d+) 0 R/);
    const recRef = objeto.match(/\/Resources\s+(\d+) 0 R/);
    const fuentes = new Map();
    const bloque = /\/Font\s*<<([\s\S]*?)>>/.exec(objetos.get(recRef ? Number(recRef[1]) : -1) || "");
    for (const f of bloque ? bloque[1].matchAll(/\/(F\d+)\s+(\d+) 0 R/g) : []) {
      const aU = /\/ToUnicode\s+(\d+) 0 R/.exec(objetos.get(Number(f[2])) || "");
      fuentes.set(f[1], aU ? cmapDe(flujoDe(objetos.get(Number(aU[1])) || "")) : null);
    }
    const contenido = flujoDe(objetos.get(contRef ? Number(contRef[1]) : -1) || "");
    const OP = /\/(F\d+)\s+[\d.]+\s+Tf|\[([\s\S]*?)\]\s*TJ|<([0-9A-Fa-f\s]*)>\s*Tj/g;
    let cmap = null, m;
    while ((m = OP.exec(contenido))) {
      if (m[1] != null) { cmap = fuentes.get(m[1]) ?? null; continue; }
      const trozo = m[2] ?? m[3] ?? "";
      for (const hex of trozo.matchAll(/<([0-9A-Fa-f\s]+)>/g)) texto += descodifica(hex[1], cmap);
      if (m[3] != null) texto += descodifica(m[3], cmap);
      texto += "\n";
    }
  }
  return texto;
}

/* ── el presupuesto de la prueba ── */
const QUOTE = {
  id: "abc12345",
  series: "P",
  number: "P-2026-0042",
  status: "sent",
  issueDate: "2026-08-31",
  validUntil: "2026-09-30",
  taxBase: "370.00",
  vatAmount: "0.00",
  total: "370.00",
  notes: "Cuota de septiembre",
  lines: [{ description: "Sesiones Logopedia 1 hora, 2 veces por semana", quantity: 1, unitPrice: 370, discountPct: 0, vatRate: 0, lineBase: 370, lineVat: 0 }],
  customFields: {},
};
const CLIENT = { name: "Familia Ejemplo", fiscalName: "Javier Ejemplo Ruiz", fiscalTaxId: "12345678Z", email: "fam@example.com" };
const SETTINGS = { fiscalName: "AUMENTA C.B.", taxId: "E87050720", invoiceFooterText: "Gracias por su confianza" };

test("el PDF dice PRESUPUESTO, con su número, validez, destinatario y total", async () => {
  const buffer = await buildQuotePdfBuffer({ quote: QUOTE, client: CLIENT, settings: SETTINGS });
  assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
  const texto = textoDe(buffer);
  assert.match(texto, /PRESUPUESTO/);
  assert.match(texto, /P-2026-0042/);
  assert.match(texto, /Válido hasta/);
  assert.match(texto, /PRESUPUESTO PARA/);
  assert.match(texto, /Javier Ejemplo Ruiz/);
  assert.match(texto, /12345678Z/);
  assert.match(texto, /370,00/);
  assert.match(texto, /Estado: Enviado/);
  assert.match(texto, /Sesiones Logopedia/);
  assert.match(texto, /Gracias por su confianza/);
  // Lo que NO debe decir: cosas de factura
  assert.ok(!/FACTURAR A/.test(texto), "se coló la etiqueta de factura");
  assert.ok(!/Vencimiento/.test(texto), "se coló el vencimiento de factura");
});

test("el borrador de presupuesto SÍ lleva su número (no dice BORRADOR a secas)", async () => {
  const buffer = await buildQuotePdfBuffer({ quote: { ...QUOTE, status: "draft" }, client: CLIENT, settings: SETTINGS });
  const texto = textoDe(buffer);
  assert.match(texto, /P-2026-0042/);
  assert.match(texto, /Estado: Borrador/);
});

test("el nombre del fichero sale del número", () => {
  assert.equal(quotePdfFilename(QUOTE), "presupuesto-P-2026-0042.pdf");
  assert.equal(quotePdfFilename({ id: "deadbeef99" }), "presupuesto-deadbeef.pdf");
});
