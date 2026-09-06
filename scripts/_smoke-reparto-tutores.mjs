// @prueba ligera
/**
 * El reparto de las facturas entre tutores (06/09/2026, Rodrigo: «padres
 * juntos pero cada uno con su factura»): las reglas de `razonSocial.js` y cómo
 * las aplica el lote (`lotesCuotas.js`). Sin base de datos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { limpiarRepartoEntreTutores, repartoEntreTutores, partirImporteEntreTutores } from "../lib/billing/razonSocial.js";
import { agruparLoteCuotas } from "../lib/billing/lotesCuotas.js";

const MADRE = "a1b2c3d4-0000-4000-8000-000000000001";
const PADRE = "a1b2c3d4-0000-4000-8000-000000000002";
const tutores = [
  { id: MADRE, name: "Marta Ruiz", relationship: "madre", dni: "11111111H" },
  { id: PADRE, name: "Javier García", relationship: "padre", dni: "22222222J" },
];
const ficha = (extra = {}) => ({
  id: "fam1", name: "Familia García Ruiz", taxId: "33333333P", guardians: tutores,
  fiscalSplit: [{ guardianId: MADRE, pct: 50 }, { guardianId: PADRE, pct: 50 }],
  ...extra,
});
const cobro = (id, amount, extra = {}) => ({
  id, clientId: "fam1", amount, status: "completed", paidAt: "2026-09-05", periodMonth: "2026-09-01",
  notes: "Cuota septiembre 2026 — Logopedia", ...extra,
});

describe("limpiarRepartoEntreTutores — lo que la ficha acepta", () => {
  it("dos tutores de la ficha que suman 100", () => {
    assert.deepEqual(limpiarRepartoEntreTutores([{ guardianId: MADRE, pct: "60" }, { guardianId: PADRE, pct: 40 }], tutores), [
      { guardianId: MADRE, pct: 60 },
      { guardianId: PADRE, pct: 40 },
    ]);
  });
  it("rechaza uno solo, un tutor ajeno, un repetido, un cero y una suma que no es 100", () => {
    assert.equal(limpiarRepartoEntreTutores([{ guardianId: MADRE, pct: 100 }], tutores), null);
    assert.equal(limpiarRepartoEntreTutores([{ guardianId: MADRE, pct: 50 }, { guardianId: "a1b2c3d4-0000-4000-8000-000000000009", pct: 50 }], tutores), null);
    assert.equal(limpiarRepartoEntreTutores([{ guardianId: MADRE, pct: 50 }, { guardianId: MADRE, pct: 50 }], tutores), null);
    assert.equal(limpiarRepartoEntreTutores([{ guardianId: MADRE, pct: 0 }, { guardianId: PADRE, pct: 100 }], tutores), null);
    assert.equal(limpiarRepartoEntreTutores([{ guardianId: MADRE, pct: 50 }, { guardianId: PADRE, pct: 40 }], tutores), null);
    assert.equal(limpiarRepartoEntreTutores(null, tutores), null);
  });
  it("repartoEntreTutores lee la ficha y cae a null si un tutor ya no está", () => {
    assert.equal(repartoEntreTutores(ficha()).length, 2);
    assert.equal(repartoEntreTutores(ficha({ guardians: [tutores[0]] })), null);
  });
});

describe("partirImporteEntreTutores — céntimos exactos", () => {
  it("37,50 al 50/50 son 18,75 y 18,75; 0,03 son 0,01 y 0,02; 100 a tercios cuadra", () => {
    const r = repartoEntreTutores(ficha());
    assert.deepEqual(partirImporteEntreTutores(37.5, r).map((p) => p.importe), [18.75, 18.75]);
    assert.deepEqual(partirImporteEntreTutores(0.03, r).map((p) => p.importe), [0.01, 0.02]);
    const tres = [{ guardianId: MADRE, pct: 33.33 }, { guardianId: PADRE, pct: 33.33 }, { guardianId: "x", pct: 33.34 }];
    const partes = partirImporteEntreTutores(100, tres).map((p) => p.importe);
    assert.equal(Math.round(partes.reduce((s, x) => s + x, 0) * 100) / 100, 100);
  });
});

describe("agruparLoteCuotas — una factura por tutor con su parte", () => {
  it("la familia con reparto sale en dos grupos, a nombre de cada tutor, con los cobros partidos", () => {
    const { facturables, sinNif } = agruparLoteCuotas({ cobros: [cobro("c1", 160), cobro("c2", 37.5)], clientes: [ficha()] });
    assert.equal(sinNif.length, 0);
    assert.equal(facturables.length, 2);
    const [m, p] = facturables;
    assert.equal(m.guardianId, MADRE);
    assert.equal(p.guardianId, PADRE);
    assert.equal(m.aNombreDe, "Marta Ruiz");
    assert.deepEqual(m.cobros.map((c) => c.amount), [80, 18.75]);
    assert.deepEqual(p.cobros.map((c) => c.amount), [80, 18.75]);
    assert.equal(m.importe + p.importe, 197.5);
    assert.equal(m.cobros[0].parteDe, "c1");
    assert.equal(m.cobros[0].importeEntero, 160);
    assert.equal(m.repartoDe, p.repartoDe);
    assert.notEqual(m.grupoId, p.grupoId);
    assert.equal(m.nif, "11111111H");
  });
  it("si a un tutor del reparto le falta el DNI, la familia entera se aparta con el motivo", () => {
    const sinDni = ficha({ guardians: [tutores[0], { ...tutores[1], dni: "" }] });
    const { facturables, sinNif } = agruparLoteCuotas({ cobros: [cobro("c1", 160)], clientes: [sinDni] });
    assert.equal(facturables.length, 0);
    assert.match(sinNif[0].motivo, /no tiene DNI/);
  });
  it("con repartoTutores: false (Partir) no se parte por tutor", () => {
    const { facturables } = agruparLoteCuotas({ cobros: [cobro("c1", 160)], clientes: [ficha()], repartoTutores: false });
    assert.equal(facturables.length, 1);
    assert.equal(facturables[0].parteDe, undefined);
  });
});
