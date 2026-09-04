// @prueba ligera
/**
 * _smoke-ticket-cobro.mjs — el justificante de cobro (04/09/2026).
 *
 * Fija `lib/billing/ticketPdf.js`. Lo discutible del ticket es QUÉ dice que se
 * ha cobrado —ahí es donde se puede mentir sin que nadie lo note— y que el
 * documento salga siempre: es un papel de mostrador, con la familia delante, y
 * un fallo de generación deja a alguien esperando.
 *
 * El TEXTO de dentro no se lee aquí: el ticket embebe Poppins y leerlo pide la
 * maquinaria de `_smoke-pdf-factura-informe.mjs`. Lo que sí se comprueba es que
 * el documento es un PDF de una sola página y que ninguna combinación de datos
 * que llega de producción lo tumba.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  conceptoDelTicket,
  mesLegibleTicket,
  ticketPdfFilename,
  buildTicketPdfBuffer,
  METODO_TICKET,
} from "../lib/billing/ticketPdf.js";

test("con factura detrás, el concepto ES la factura", () => {
  assert.equal(conceptoDelTicket({ invoiceNumber: "F-2026-0042" }), "Factura F-2026-0042");
  // La factura manda sobre el mes: es lo más concreto que se puede decir.
  assert.equal(
    conceptoDelTicket({ invoiceNumber: "F-2026-0042", periodMonth: "2026-09" }),
    "Factura F-2026-0042",
  );
});

test("sin factura, el concepto es el mes de la cuota", () => {
  // Es el caso que trae el ticket: en Aumenta se cobra durante el mes y se
  // factura al cierre, así que el cobro normal NO tiene factura.
  assert.equal(conceptoDelTicket({ periodMonth: "2026-09" }), "Cuota de septiembre de 2026");
  assert.equal(conceptoDelTicket({ periodMonth: "2026-09-01" }), "Cuota de septiembre de 2026");
});

test("sin factura ni mes, «Cobro» y no un hueco", () => {
  assert.equal(conceptoDelTicket({}), "Cobro");
  assert.equal(conceptoDelTicket(), "Cobro");
  assert.equal(conceptoDelTicket({ periodMonth: "no es un mes" }), "Cobro");
});

test("el mes se escribe en cristiano", () => {
  assert.equal(mesLegibleTicket("2026-01"), "enero de 2026");
  assert.equal(mesLegibleTicket("2026-12"), "diciembre de 2026");
  assert.equal(mesLegibleTicket(""), null);
  assert.equal(mesLegibleTicket(null), null);
});

test("el nombre del fichero lleva la fecha y no caracteres prohibidos", () => {
  const nombre = ticketPdfFilename({ id: "abcdef12-3456-4789-8abc-def012345678", paidAt: "2026-09-04T10:00:00Z" });
  assert.equal(nombre, "ticket-2026-09-04-abcdef12.pdf");
  assert.equal(/[\\/:*?"<>|]/.test(nombre), false);
  // Un cobro sin fecha tampoco se queda sin nombre.
  assert.match(ticketPdfFilename({ id: "x" }), /^ticket-sin-fecha-/);
});

test("los cuatro métodos del enum tienen rótulo", () => {
  for (const m of ["cash", "card", "transfer", "direct_debit"]) {
    assert.equal(typeof METODO_TICKET[m], "string");
  }
});

test("el ticket sale, y es un PDF de una página", async () => {
  const buffer = await buildTicketPdfBuffer({
    payment: {
      id: "abcdef12-3456-4789-8abc-def012345678",
      amount: 120.5,
      method: "cash",
      paidAt: "2026-09-04T10:30:00Z",
      periodMonth: "2026-09",
      notes: "Pago parcial, trae el resto la semana que viene",
    },
    clientName: "Ana Pérez Ruiz",
    patientName: "Hugo Gómez Pérez",
    settings: { fiscalName: "Centro Aumenta S.L.", taxId: "B12345678", address: "C/ Mayor 1, Madrid", invoiceFooterText: "Gracias por su confianza" },
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  // Una sola página: un justificante que se parte en dos no se entrega.
  const paginas = (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(paginas, 1);
});

test("un cobro pelado tampoco se queda sin ticket", async () => {
  // Lo que llega de producción: sin nombre, sin paciente, sin factura, sin
  // ajustes del centro. El papel se entrega igual.
  const buffer = await buildTicketPdfBuffer({ payment: { id: "x", amount: 30, method: "card" } });
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("por largo que sea, el ticket cabe en UNA página", async () => {
  // El fallo que trajo la medición en dos pasadas: con los ajustes reales de
  // un centro —dirección que dobla, pie de página largo— la estimación a ojo
  // se quedaba corta y el justificante salía en dos hojas.
  const buffer = await buildTicketPdfBuffer({
    payment: {
      id: "abcdef12-3456-4789-8abc-def012345678",
      amount: 1234.56,
      method: "direct_debit",
      paidAt: "2026-09-04T10:30:00Z",
      periodMonth: "2026-09",
      notes: "Nota muy larga. ".repeat(30),
    },
    clientName: "María del Carmen Fernández de la Torre y Álvarez",
    patientName: "Juan Antonio Rodríguez Fernández de la Torre",
    invoiceNumber: "F-2026-000123",
    settings: {
      fiscalName: "Centro de Psicología y Formación Aumenta Sociedad Limitada",
      taxId: "B12345678",
      address: "Calle de la Constitución número 123, portal 4, escalera B, 2º izquierda, 28944 Fuenlabrada (Madrid)",
      invoiceFooterText: "Datos protegidos conforme al RGPD. ".repeat(6),
    },
  });
  const paginas = (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(paginas, 1, "un justificante partido en dos hojas no se entrega");
});

test("un logo corrupto no tumba el ticket", async () => {
  // Misma regla que el PDF de factura: un problema estético no puede dejar a
  // una familia sin su justificante.
  const buffer = await buildTicketPdfBuffer({
    payment: { id: "x", amount: 30, method: "cash" },
    logo: Buffer.from("esto no es una imagen"),
  });
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
});
