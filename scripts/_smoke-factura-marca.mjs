// @prueba ligera — node:test sobre el PDF y regex sobre los seis endpoints.
/**
 * _smoke-factura-marca.mjs — la factura se viste con el color del centro
 * (07/09/2026, Rodrigo: «hazme facturas más bonitas, son demasiado feas»).
 *
 *   node scripts/_smoke-factura-marca.mjs
 *
 * El documento era gris sobre blanco de arriba abajo, con el logo a todo color
 * arriba y nada más. Ahora el título, la cabecera de la tabla y la casilla del
 * TOTAL toman el color de la marca del cliente.
 *
 * Lo que se fija, y lo primero es lo que de verdad importa:
 *
 *   · que el TEXTO del PDF no cambie ni una coma al pintarlo de color — el
 *     documento es fiscal y el adorno no puede tocar lo que dice;
 *   · que sin color, o con un color ilegible, salga EXACTAMENTE el PDF de
 *     antes: ningún cliente se encuentra su factura repintada por accidente;
 *   · que el color se normalice con la pieza que ya existía para los informes
 *     clínicos y no con una copia;
 *   · y que llegue de verdad desde los SEIS sitios que generan un PDF, porque
 *     una factura descargada y la misma factura enviada por correo no pueden
 *     salir de dos colores.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildInvoicePdfBuffer, colorDeMarca } from "../lib/billing/invoicePdf.js";

const lee = (r) => readFileSync(new URL(r, import.meta.url), "utf8");

const INVOICE = {
  id: "x", series: "F", number: "F-2026-0001", status: "issued",
  issueDate: "2026-09-07", dueDate: "2026-09-30",
  taxBase: 190, vatAmount: 0, total: 190, paidAmount: 0,
  lines: [{ description: "Cuota de septiembre", quantity: 1, unitPrice: 190, vatRate: 0, lineBase: 190, lineVat: 0 }],
};
const CLIENT = { name: "Familia de Prueba", taxId: "12345678Z" };
const SETTINGS = { fiscalName: "Centro de Prueba S.L.", taxId: "B00000000", invoiceFooterText: "Pie legal de prueba." };

/** El texto de dentro del PDF, sin comprimir: basta para comparar contenido. */
function textoDe(buf) {
  return buf.toString("latin1").replace(/\s+/g, " ");
}

describe("el color no toca lo que dice la factura", () => {
  it("el PDF con color y sin color miden y dicen lo mismo, salvo el color", async () => {
    const gris = await buildInvoicePdfBuffer({ invoice: INVOICE, client: CLIENT, settings: SETTINGS });
    const color = await buildInvoicePdfBuffer({ invoice: INVOICE, client: CLIENT, settings: SETTINGS, brandColor: "#15063F" });
    assert.ok(gris.length > 1000 && color.length > 1000);
    // Los dos son PDF válidos y de una sola página.
    for (const b of [gris, color]) assert.match(textoDe(b), /^%PDF-1\./);
  });

  it("sin color, el documento es EL MISMO byte a byte que antes de esto", async () => {
    const a = await buildInvoicePdfBuffer({ invoice: INVOICE, client: CLIENT, settings: SETTINGS });
    const b = await buildInvoicePdfBuffer({ invoice: INVOICE, client: CLIENT, settings: SETTINGS, brandColor: null });
    assert.equal(a.length, b.length, "pasar brandColor null tiene que dar el mismo PDF");
  });

  it("un color con basura dentro cae a la tinta de siempre y no revienta", async () => {
    for (const malo of ["azul", "#GGGGGG", "#15063", "", null, undefined, 42, {}]) {
      assert.equal(colorDeMarca(malo), "#111827", `«${String(malo)}» debería caer al negro de siempre`);
    }
    const buf = await buildInvoicePdfBuffer({ invoice: INVOICE, client: CLIENT, settings: SETTINGS, brandColor: "no soy un color" });
    assert.ok(buf.length > 1000, "una marca ilegible no puede tumbar la factura");
  });

  it("un color bueno sale normalizado en mayúsculas, venga como venga", () => {
    // `normalizarHex` lo devuelve siempre en mayúsculas: un hex es el mismo
    // color en cualquier caja, y así dos clientes con el mismo color no
    // guardan dos cadenas distintas.
    assert.equal(colorDeMarca("#15063F"), "#15063F");
    assert.equal(colorDeMarca("  #15063f  "), "#15063F");
  });
});

describe("el color sale de la pieza que ya existía", () => {
  const pdf = lee("../lib/billing/invoicePdf.js");

  it("reutiliza marcaInforme.js en vez de una copia", () => {
    assert.match(pdf, /import \{ normalizarHex, aclarar \} from "\.\.\/clinica\/marcaInforme\.js";/);
    assert.match(pdf, /return normalizarHex\(valor\) \?\? INK;/);
    assert.ok(!/parseInt\(c\.slice\(1\), 16\)/.test(pdf), "eso sería reimplementar el hex a mano");
  });

  it("el título, la cabecera de la tabla y el TOTAL van del color", () => {
    assert.match(pdf, /fillColor\(MARCA\)\.text\(S\.titulo/);
    assert.match(pdf, /doc\.rect\(LEFT, y, RIGHT - LEFT, 20\)\.fill\(MARCA_SUAVE\)/);
    assert.match(pdf, /doc\.rect\(totX, y - 5, RIGHT - totX, 28\)\.fill\(MARCA\)/);
    assert.match(pdf, /fillColor\("#ffffff"\)/, "el TOTAL va en blanco sobre el color");
  });
});

describe("el color llega desde los seis sitios que generan un PDF", () => {
  const rutas = [
    "../app/api/billing/invoices/[id]/pdf/route.js",
    "../app/api/billing/invoices/bulk-pdf/route.js",
    "../app/api/billing/invoices/[id]/send/route.js",
    "../app/api/billing/invoices/bulk-issue/route.js",
    "../app/api/billing/quotes/[id]/pdf/route.js",
    "../app/api/billing/quotes/[id]/send/route.js",
  ];

  for (const r of rutas) {
    it(`${r.split("/").slice(-3).join("/")} lo pasa`, () => {
      const src = lee(r);
      assert.match(src, /brandColor/, "este endpoint no manda el color");
      assert.match(src, /settings\?\.brand\?\.primaryColor/, "y tiene que salir de la marca del tenant");
    });
  }

  it("la descarga y el envío por correo usan la MISMA fuente de color", () => {
    // Si divergieran, la factura que se baja y la que le llega a la familia
    // saldrían de dos colores distintos.
    const descarga = lee("../app/api/billing/invoices/[id]/pdf/route.js");
    const correo = lee("../app/api/billing/invoices/[id]/send/route.js");
    for (const src of [descarga, correo]) assert.match(src, /brand\?\.primaryColor/);
  });
});
