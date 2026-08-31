// @prueba ligera
// Fija lib/billing/membrete.js (qué logo y pie viste cada documento) y que el
// PDF de presupuesto usa su pie con la caída al de la factura.
import test from "node:test";
import assert from "node:assert/strict";
import { membreteDe } from "../lib/billing/membrete.js";

test("la factura viste su membrete de siempre", () => {
  const s = { logoUrl: "https://x/logo.png", invoiceFooterText: "Pie factura" };
  assert.deepEqual(membreteDe(s, "factura"), { logoUrl: "https://x/logo.png", footerText: "Pie factura" });
});

test("el presupuesto usa el suyo cuando lo tiene", () => {
  const s = {
    logoUrl: "https://x/logo.png",
    invoiceFooterText: "Pie factura",
    quoteLogoUrl: "https://x/logo-rosa.png",
    quoteFooterText: "Pie presupuesto",
  };
  assert.deepEqual(membreteDe(s, "presupuesto"), { logoUrl: "https://x/logo-rosa.png", footerText: "Pie presupuesto" });
});

test("el presupuesto sin membrete propio cae al de la factura", () => {
  const s = { logoUrl: "https://x/logo.png", invoiceFooterText: "Pie factura", quoteLogoUrl: "", quoteFooterText: "   " };
  assert.deepEqual(membreteDe(s, "presupuesto"), { logoUrl: "https://x/logo.png", footerText: "Pie factura" });
});

test("sin configuración: nulos, no cadenas vacías", () => {
  assert.deepEqual(membreteDe(null, "factura"), { logoUrl: null, footerText: null });
  assert.deepEqual(membreteDe({}, "presupuesto"), { logoUrl: null, footerText: null });
});
