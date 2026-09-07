// @prueba ligera — genera PDF en memoria con PDFKit; sin base, sin servidor, sin .env.
/**
 * _smoke-factura-pie.mjs — el pie de la factura cabe y no se lleva una página
 * en blanco (07/09/2026, AV-0064 de Aumenta).
 *
 *   node scripts/_smoke-factura-pie.mjs
 *
 * Lo que se fija:
 *   · un pie CORTO no añade página (era la regresión: anclarlo a 40 pt del
 *     borde lo metía por debajo del margen de 50 y PDFKit abría página él
 *     solo);
 *   · un pie LARGO —el aviso RGPD de Aumenta, unas diez líneas— se escribe
 *     entero, en la misma página si cabe debajo del contenido y en una nueva
 *     si no;
 *   · sin pie, el PDF no cambia.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildInvoicePdfBuffer } from "../lib/billing/invoicePdf.js";

const PIE_LARGO = "En cumplimiento de lo establecido en el Reglamento (UE) 2016/679 y en la LOPD 3/2018 de protección de datos de carácter personal, le informamos que disponemos de sus datos como responsables del tratamiento, con la finalidad de prestarles el servicio solicitado y realizar la facturación del mismo, tratándolos de manera lícita, leal, transparente, adecuada, pertinente, limitada, exacta y actualizada. Usted se compromete a comunicarnos cualquier variación, de lo contrario, entenderemos que sus datos no han sido modificados. Sus datos serán conservados durante el plazo estrictamente necesario hasta cumplir el fin que motivó su tratamiento, excepto que nos lo soliciten con anterioridad, y no se cederán a terceros salvo en los casos en que exista una obligación legal.";

const FACTURA = {
  id: "f-1",
  number: "F-2026-0001",
  series: "F",
  status: "paid",
  issueDate: "2026-09-07",
  dueDate: "2026-10-07",
  lines: [{ description: "Cuota septiembre", quantity: 1, unitPrice: 190, vatRate: 0 }],
  subtotal: 190,
  taxBase: 190,
  vatAmount: 0,
  total: 190,
  notes: null,
  customFields: {},
};
const CLIENTE = { id: "c-1", name: "Familia de prueba", fiscalName: "Familia de prueba", fiscalTaxId: "12345678Z" };
const AJUSTES = { fiscalName: "Centro", taxId: "B00000000", fiscalAddress: "C/ Prueba 1", fiscalCity: "Madrid", fiscalZip: "28000" };

const paginas = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
const pdf = async (settings, invoice = FACTURA) =>
  buildInvoicePdfBuffer({ invoice, client: CLIENTE, settings });

describe("el pie de la factura", () => {
  it("un pie de una línea NO añade una página en blanco", async () => {
    const buf = await pdf({ ...AJUSTES, invoiceFooterText: "Gracias por su confianza." });
    assert.equal(paginas(buf), paginas(await pdf({ ...AJUSTES, invoiceFooterText: null })));
  });

  it("el aviso legal largo se escribe entero y el PDF sigue siendo válido", async () => {
    const buf = await pdf({ ...AJUSTES, invoiceFooterText: PIE_LARGO });
    assert.equal(buf.toString("latin1").slice(0, 5), "%PDF-");
    assert.ok(paginas(buf) >= 1 && paginas(buf) <= 2, `páginas: ${paginas(buf)}`);
    // Y pesa más que sin pie: el texto está dentro, no se ha perdido.
    const sinPie = await pdf({ ...AJUSTES, invoiceFooterText: null });
    assert.ok(buf.length > sinPie.length, "el pie largo no ha entrado en el PDF");
  });

  it("sin pie, una factura corta cabe en una página", async () => {
    assert.equal(paginas(await pdf({ ...AJUSTES, invoiceFooterText: null })), 1);
  });
});
