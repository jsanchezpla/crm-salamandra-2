// @prueba ligera
// Fija la agrupación por terapia de lib/billing/lotesCuotas.js: «Facturar el
// mes» puede emitir una factura POR CONCEPTO del catálogo, y los cobros sin
// concepto van juntos en un grupo «resto» del mismo pagador.
import test from "node:test";
import assert from "node:assert/strict";
import { agruparLoteCuotas } from "../lib/billing/lotesCuotas.js";

const CLIENTES = [
  { id: "c1", name: "Familia García", taxId: "12345678Z" },
  { id: "c2", name: "Familia Ruiz", taxId: "87654321X" },
];
const CONCEPTOS = [
  { id: "logo", name: "Cuota Logopedia" },
  { id: "psico", name: "Cuota Psicología" },
];

test("por terapia: cada concepto del mismo pagador es su propio grupo", () => {
  const { facturables } = agruparLoteCuotas({
    agrupacion: "terapia",
    conceptos: CONCEPTOS,
    clientes: CLIENTES,
    cobros: [
      { id: "p1", clientId: "c1", amount: 190, conceptId: "logo", paidAt: "2026-09-01" },
      { id: "p2", clientId: "c1", amount: 145, conceptId: "psico", paidAt: "2026-09-02" },
      { id: "p3", clientId: "c1", amount: 30, conceptId: null, paidAt: "2026-09-03" },
    ],
  });
  assert.equal(facturables.length, 3);
  const porGrupo = new Map(facturables.map((g) => [g.grupoId, g]));
  assert.equal(porGrupo.get("c1:logo").importe, 190);
  assert.equal(porGrupo.get("c1:logo").terapia, "Cuota Logopedia");
  assert.equal(porGrupo.get("c1:psico").importe, 145);
  assert.equal(porGrupo.get("c1:resto").importe, 30);
  assert.equal(porGrupo.get("c1:resto").terapia, "(sin terapia asignada)");
});

test("por pagador (lo de siempre): todo junto y grupoId = clientId", () => {
  const { facturables } = agruparLoteCuotas({
    clientes: CLIENTES,
    cobros: [
      { id: "p1", clientId: "c1", amount: 190, conceptId: "logo", paidAt: "2026-09-01" },
      { id: "p2", clientId: "c1", amount: 145, conceptId: "psico", paidAt: "2026-09-02" },
    ],
  });
  assert.equal(facturables.length, 1);
  assert.equal(facturables[0].grupoId, "c1");
  assert.equal(facturables[0].importe, 335);
  assert.equal(facturables[0].terapia, undefined);
});

test("sin NIF se aparta por grupo, y un concepto borrado no revienta el rótulo", () => {
  const { facturables, sinNif } = agruparLoteCuotas({
    agrupacion: "terapia",
    conceptos: CONCEPTOS,
    clientes: [{ id: "c3", name: "Sin Papeles" }, ...CLIENTES],
    cobros: [
      { id: "p1", clientId: "c3", amount: 100, conceptId: "logo", paidAt: "2026-09-01" },
      { id: "p2", clientId: "c2", amount: 55, conceptId: "borrado", paidAt: "2026-09-01" },
    ],
  });
  assert.equal(sinNif.length, 1);
  assert.equal(sinNif[0].grupoId, "c3:logo");
  assert.equal(facturables.length, 1);
  assert.equal(facturables[0].terapia, "(concepto borrado)");
});
