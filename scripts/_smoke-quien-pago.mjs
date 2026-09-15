// @prueba ligera
/**
 * _smoke-quien-pago.mjs — quién pagó cada día por forma de pago, y su CSV
 * (15/09/2026, AV-0137 de Aumenta).
 *
 *   node scripts/_smoke-quien-pago.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { diasPorForma, filtrarPorNombre, totalPorForma, csvQuienPago } from "../lib/billing/quienPago.js";

const dias = [
  {
    fecha: "2026-09-14",
    lista: [
      { id: "1", method: "cash", amount: 40, patientName: "Lucía Ruiz", clientName: "Ana Pérez", paidAt: "2026-09-14T08:30:00Z" },
      { id: "2", method: "card", amount: 55.5, patientName: null, clientName: "Juan; López", paidAt: "2026-09-14T09:00:00Z" },
      { id: "3", method: "transfer", amount: 120, clientName: "Familia Gil", paidAt: "2026-09-14T10:00:00Z" },
    ],
  },
  { fecha: "2026-09-15", lista: [
    { id: "4", method: "direct_debit", amount: 80, clientName: "Familia Sanz", paidAt: "2026-09-15T07:00:00Z" },
    { id: "3", method: "transfer", amount: -120, clientName: "Familia Gil", devolucion: true, paidAt: "2026-09-14T10:00:00Z", refundedAt: "2026-09-15T11:00:00Z" },
  ] },
  { fecha: "2026-09-16", lista: [] },
];

test("cada forma se queda solo con lo suyo y cae los días vacíos", () => {
  assert.deepEqual(diasPorForma(dias, "efectivo").map((d) => d.fecha), ["2026-09-14"]);
  assert.deepEqual(diasPorForma(dias, "tarjeta").map((d) => [d.fecha, d.total]), [["2026-09-14", 55.5]]);
  // Banco = transferencia + domiciliación, como la cesta de caja.js.
  assert.deepEqual(diasPorForma(dias, "banco").map((d) => [d.fecha, d.total]), [["2026-09-14", 120], ["2026-09-15", -40]]);
});

test("el buscador por nombre casa paciente o quien paga, sin tildes, y rehace días y totales", () => {
  const banco = diasPorForma(dias, "banco");
  assert.deepEqual(filtrarPorNombre(banco, "sanz").map((d) => [d.fecha, d.total]), [["2026-09-15", 80]]);
  assert.deepEqual(filtrarPorNombre(banco, "GIL").map((d) => [d.fecha, d.total]), [["2026-09-14", 120], ["2026-09-15", -120]]);
  const efectivo = diasPorForma(dias, "efectivo");
  assert.equal(filtrarPorNombre(efectivo, "lucia").length, 1);
  assert.equal(filtrarPorNombre(efectivo, "ana perez").length, 1);
  assert.equal(filtrarPorNombre(efectivo, "lucia gil").length, 0);
  assert.equal(filtrarPorNombre(efectivo, "  "), efectivo);
});

test("el total resta la devolución y no la cuenta como cobro", () => {
  assert.deepEqual(totalPorForma(diasPorForma(dias, "banco")), { importe: 80, cobros: 2 });
});

test("el CSV abre en el Excel español: BOM, punto y coma, coma decimal y comillas", () => {
  const csv = csvQuienPago(diasPorForma(dias, "tarjeta"));
  assert.ok(csv.startsWith("﻿Fecha;Hora;Paciente;Paga;Forma de pago;Importe"));
  assert.match(csv, /14\/09\/2026;11:00;;"Juan; López";Tarjeta;55,50;/);
});

test("la devolución sale con su hora y marcada", () => {
  const csv = csvQuienPago(diasPorForma(dias, "banco"));
  assert.match(csv, /15\/09\/2026;13:00;;Familia Gil;Transferencia;-120,00;;;Sí;/);
});
