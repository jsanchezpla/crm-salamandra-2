// @prueba ligera
// Fija el nombre del paciente y el sello en el PDF de FACTURA
// (lib/billing/invoicePdf.js): salen cuando se piden, no salen cuando no, y
// un sello corrupto no tumba el documento. Lector compacto, como el de
// _smoke-pdf-presupuesto.mjs; el layout milimétrico de la factura lo sigue
// vigilando _smoke-pdf-factura-informe.mjs (que renderiza SIN estas piezas).
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { buildInvoicePdfBuffer } from "../lib/billing/invoicePdf.js";

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

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const INVOICE = {
  id: "f1",
  series: "F",
  number: "F-2026-0042",
  status: "issued",
  issueDate: "2026-08-31",
  dueDate: "2026-09-30",
  taxBase: "100.00",
  vatAmount: "0.00",
  total: "100.00",
  paidAmount: "0.00",
  lines: [{ description: "Cuota mensual", quantity: 1, unitPrice: 100, discountPct: 0, vatRate: 0, lineBase: 100, lineVat: 0 }],
  customFields: {},
};
const CLIENT = { name: "Fundación Ejemplo", fiscalName: "Fundación Ejemplo", fiscalTaxId: "G12345678" };
const SETTINGS = { fiscalName: "AUMENTA C.B.", taxId: "E87050720" };

test("con patientName, el PDF dice de qué paciente es; sin él, no", async () => {
  const con = textoDe(await buildInvoicePdfBuffer({ invoice: INVOICE, client: CLIENT, settings: SETTINGS, patientName: "Hugo Castro Díaz" }));
  assert.match(con, /Paciente: Hugo Castro Díaz/);
  const sin = textoDe(await buildInvoicePdfBuffer({ invoice: INVOICE, client: CLIENT, settings: SETTINGS }));
  assert.ok(!/Paciente:/.test(sin), "salió la línea de paciente sin pedirla");
});

test("el sello se incrusta cuando se pasa, y uno corrupto no tumba el PDF", async () => {
  const sinSello = await buildInvoicePdfBuffer({ invoice: INVOICE, client: CLIENT, settings: SETTINGS });
  const conSello = await buildInvoicePdfBuffer({ invoice: INVOICE, client: CLIENT, settings: SETTINGS, stamp: PNG_1x1 });
  assert.ok(conSello.length > sinSello.length, "el PDF con sello no creció");
  const corrupto = await buildInvoicePdfBuffer({ invoice: INVOICE, client: CLIENT, settings: SETTINGS, stamp: Buffer.from("no soy un png") });
  assert.equal(corrupto.subarray(0, 5).toString(), "%PDF-");
});
