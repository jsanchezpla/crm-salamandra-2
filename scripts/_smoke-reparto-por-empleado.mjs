// @prueba ligera
// Fija lib/billing/repartoPorEmpleado.js: a quién se atribuye la base de una
// factura con líneas de terapeutas distintos, y también que calculateInvoice
// CONSERVA el employeeId de la línea (sin eso el reparto muere al guardar).
import test from "node:test";
import assert from "node:assert/strict";
import { basePorEmpleado, llevaRepartoPorLineas } from "../lib/billing/repartoPorEmpleado.js";
import { calculateInvoice } from "../lib/billing/calculateInvoice.js";

test("dos líneas de dos terapeutas reparten cada una a su dueño", () => {
  const r = basePorEmpleado({
    employeeId: "ana",
    lines: [
      { description: "Logopedia", lineBase: 190, employeeId: "ana" },
      { description: "Psicología", lineBase: 145, employeeId: "bea" },
    ],
  });
  assert.equal(r.get("ana"), 190);
  assert.equal(r.get("bea"), 145);
});

test("una línea sin empleado cae al de la factura; sin ninguno, a nadie", () => {
  const r = basePorEmpleado({
    employeeId: "ana",
    lines: [{ lineBase: 100 }, { lineBase: 50, employeeId: "bea" }],
  });
  assert.equal(r.get("ana"), 100);
  assert.equal(r.get("bea"), 50);
  const sinNadie = basePorEmpleado({ employeeId: null, lines: [{ lineBase: 100 }] });
  assert.equal(sinNadie.size, 0);
});

test("un descuento negativo resta a su terapeuta y los títulos no cuentan", () => {
  const r = basePorEmpleado({
    employeeId: "ana",
    lines: [
      { kind: "titulo", description: "Septiembre", lineBase: 999, employeeId: "bea" },
      { lineBase: 190, employeeId: "ana" },
      { description: "Descuento reserva", lineBase: -30, employeeId: "ana" },
    ],
  });
  assert.equal(r.get("ana"), 160);
  assert.equal(r.has("bea"), false);
});

test("llevaRepartoPorLineas distingue las facturas de siempre de las repartidas", () => {
  assert.equal(llevaRepartoPorLineas([{ lineBase: 10 }]), false);
  assert.equal(llevaRepartoPorLineas([{ lineBase: 10 }, { lineBase: 5, employeeId: "x" }]), true);
  assert.equal(llevaRepartoPorLineas(null), false);
});

test("calculateInvoice conserva el employeeId de la línea", () => {
  const r = calculateInvoice({
    lines: [
      { description: "A", quantity: 1, unitPrice: 190, vatRate: 0, employeeId: "ana" },
      { description: "B", quantity: 1, unitPrice: 145, vatRate: 0 },
    ],
  });
  assert.equal(r.lines[0].employeeId, "ana");
  assert.equal("employeeId" in r.lines[1], false);
});
