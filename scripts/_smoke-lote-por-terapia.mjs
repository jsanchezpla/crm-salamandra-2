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

// ── Revisión del 06/09/2026: la razón social por defecto de la ficha ────────
import { test as prueba } from "node:test";
import { strict as afirma } from "node:assert";
import { agruparLoteCuotas as agrupar } from "../lib/billing/lotesCuotas.js";

const TUTORA = { id: "a1b2c3d4-0000-4000-8000-000000000001", name: "Marta Pérez", relationship: "madre", dni: "22222222J" };
const fichaCon = (extra = {}) => ({ id: "famT", name: "Familia Tutora", taxId: "11111111H", guardians: [TUTORA], fiscalGuardianId: TUTORA.id, ...extra });
const cobroT = { id: "ct", clientId: "famT", amount: 80, status: "completed", paidAt: "2026-09-03", periodMonth: "2026-09-01" };

prueba("con tutora por defecto y DNI, el grupo sale a su nombre y con su foto", () => {
  const { facturables, sinNif } = agrupar({ cobros: [cobroT], clientes: [fichaCon()] });
  afirma.equal(sinNif.length, 0);
  afirma.equal(facturables[0].guardianId, TUTORA.id);
  afirma.equal(facturables[0].aNombreDe, "Marta Pérez");
  afirma.equal(facturables[0].fotoFiscal.nif, "22222222J");
});

prueba("sin DNI en la tutora, el grupo se aparta con el motivo en vez de salir a nombre de la ficha", () => {
  const { facturables, sinNif } = agrupar({ cobros: [cobroT], clientes: [fichaCon({ guardians: [{ ...TUTORA, dni: "" }] })] });
  afirma.equal(facturables.length, 0);
  afirma.match(sinNif[0].motivo, /no tiene DNI/);
});

prueba("sin razón social por defecto, todo como siempre: a nombre de la ficha", () => {
  const { facturables } = agrupar({ cobros: [cobroT], clientes: [fichaCon({ fiscalGuardianId: null })] });
  afirma.equal(facturables[0].guardianId, undefined);
  afirma.equal(facturables[0].fotoFiscal, undefined);
});

prueba("una ficha SIN NIF cuya razón social por defecto es un tutor con DNI sí se factura, a nombre del tutor", () => {
  const { facturables, sinNif } = agrupar({ cobros: [cobroT], clientes: [fichaCon({ taxId: null, fiscalTaxId: null })] });
  afirma.equal(sinNif.length, 0);
  afirma.equal(facturables[0].guardianId, TUTORA.id);
  afirma.equal(facturables[0].nif, "22222222J");
});

prueba("sin NIF y sin tutor por defecto, sigue apartada como «sin NIF»", () => {
  const { facturables, sinNif } = agrupar({ cobros: [cobroT], clientes: [fichaCon({ taxId: null, fiscalTaxId: null, fiscalGuardianId: null })] });
  afirma.equal(facturables.length, 0);
  afirma.equal(sinNif[0].motivo, "sin NIF");
});
