// @prueba ligera
// Fija lib/billing/conceptosCatalogo.js: qué acepta el catálogo y qué línea
// de factura sale de elegir un concepto.
import test from "node:test";
import assert from "node:assert/strict";
import { limpiarConcepto, lineaDesdeConcepto, ordenarPorNombre } from "../lib/billing/conceptosCatalogo.js";

test("un alta buena entra saneada", () => {
  const { valores, problema } = limpiarConcepto({
    name: "  Cuota Logopedia 60x2 ",
    description: "Sesiones Logopedia 1 hora, 2 veces por semana",
    unitPrice: "370",
    vatRate: 0,
    category: "Cuotas mensuales",
    periodicity: "mensual",
  });
  assert.equal(problema, null);
  assert.equal(valores.name, "Cuota Logopedia 60x2");
  assert.equal(valores.unitPrice, 370);
  assert.equal(valores.vatRate, 0);
});

test("sin nombre no hay concepto; importes e IVA raros se rechazan con frase", () => {
  assert.match(limpiarConcepto({ name: "  " }).problema, /nombre/);
  assert.match(limpiarConcepto({ name: "X", unitPrice: "no sé" }).problema, /importe/);
  assert.match(limpiarConcepto({ name: "X", unitPrice: 10, vatRate: 130 }).problema, /IVA/);
});

test("un importe NEGATIVO vale: es un concepto de descuento fijo (reserva ya abonada)", () => {
  const { valores, problema } = limpiarConcepto({ name: "Descuento reserva ya abonada", unitPrice: -30, vatRate: 0 });
  assert.equal(problema, null);
  assert.equal(valores.unitPrice, -30);
  const linea = lineaDesdeConcepto({ name: "Descuento reserva ya abonada", unitPrice: "-30.00", vatRate: 0 });
  assert.equal(linea.unitPrice, -30);
});

test("la edición parcial solo toca lo que viaja", () => {
  const { valores, problema } = limpiarConcepto({ unitPrice: 380 }, { parcial: true });
  assert.equal(problema, null);
  assert.deepEqual(Object.keys(valores), ["unitPrice"]);
});

test("elegir un concepto rellena la línea: texto, cantidad 1, precio e IVA", () => {
  const linea = lineaDesdeConcepto({ name: "Entrevista Inicial", description: "", unitPrice: "50.00", vatRate: "0.00" });
  assert.deepEqual(linea, { description: "Entrevista Inicial", quantity: 1, unitPrice: 50, discountPct: 0, vatRate: 0 });
  const conTexto = lineaDesdeConcepto({ name: "Cuota", description: "Sesión semanal de 1 h", unitPrice: 190, vatRate: 0 });
  assert.equal(conTexto.description, "Sesión semanal de 1 h");
  assert.equal(lineaDesdeConcepto(null), null);
});

test("el catálogo sale en orden alfabético: tildes donde toca y números como números", () => {
  const nombres = (cs) => ordenarPorNombre(cs).map((c) => c.name);
  // «Álava» va donde va la A, no detrás de «Zamora».
  assert.deepEqual(
    nombres([{ name: "Zamora" }, { name: "Álava" }, { name: "Bilbao" }]),
    ["Álava", "Bilbao", "Zamora"]
  );
  // «60x2» antes que «60x10»: contando los números, no letra a letra.
  assert.deepEqual(
    nombres([{ name: "Logopedia 60x10" }, { name: "Logopedia 60x2" }]),
    ["Logopedia 60x2", "Logopedia 60x10"]
  );
  // El orden en que llegaron (sort_order) ya no manda.
  assert.deepEqual(nombres([{ name: "Terapia", sortOrder: 1 }, { name: "Bono", sortOrder: 2 }]), ["Bono", "Terapia"]);
  // No toca la lista que le dan, y aguanta lo que venga vacío.
  const original = [{ name: "B" }, { name: "A" }];
  ordenarPorNombre(original);
  assert.equal(original[0].name, "B");
  assert.deepEqual(ordenarPorNombre(null), []);
});
