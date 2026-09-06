// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-partir-factura.mjs — partir una factura del lote en varias, sin
 * renumerar nada (06/09/2026, Rodrigo).
 *
 *   node scripts/_smoke-partir-factura.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * «Facturar el mes» hace una factura por familia; a posteriori quieren
 * partirla por hijo o por terapia. Y pedían elegir entre «las extras
 * respetando la numeración» y «mover el número de todas las siguientes». Lo
 * segundo no es legal (una factura emitida no cambia de número), así que solo
 * hay un camino: anular la original con una R y reemitir N nuevas con los
 * mismos cobros y los números siguientes. Aquí se fija la mitad que se decide
 * sin base de datos (`lib/billing/partirFactura.js`):
 *
 *  - QUÉ se puede partir: solo una factura viva, del lote (con cobros
 *    enganchados y cobrados), que no sea ni esté rectificada — y solo si el
 *    criterio la parte de verdad en dos o más.
 *  - EL CUADRE: las partes suman la original al céntimo, o no se emite nada.
 *  - LA ANULACIÓN: cada línea de la original en negativo con su mismo IVA —
 *    exactamente lo que hace «Rectificar» con base 0—.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planDePartir, lineasDeAnulacion, mesDeLosCobros, criterioValido, CRITERIOS_PARTIR } from "../lib/billing/partirFactura.js";
import { agruparLoteCuotas, agrupacionValida, AGRUPACIONES } from "../lib/billing/lotesCuotas.js";

const FICHA = { id: "fam1", name: "Familia García", taxId: "11111111H", fiscalName: null, fiscalTaxId: null };
const cobro = (id, extra = {}) => ({
  id, clientId: "fam1", amount: 100, method: "transfer", status: "completed",
  paidAt: "2026-09-03T10:00:00.000Z", periodMonth: "2026-09-01", notes: "Cuota septiembre 2026", ...extra,
});
const factura = (extra = {}) => ({
  id: "f1", number: "F-2026-0128", status: "paid", total: 200, taxBase: 200, irpfRate: 0,
  rectifiesInvoiceId: null, rectifiedByInvoiceId: null,
  customFields: { loteCuotas: "2026-09" },
  lines: [
    { description: "Cuota septiembre 2026 — A", lineBase: 100, vatRate: 0 },
    { description: "Cuota septiembre 2026 — B", lineBase: 100, vatRate: 0 },
  ],
  ...extra,
});
const PACIENTES = [{ id: "p1", name: "Lucía" }, { id: "p2", name: "Mateo" }];
const CONCEPTOS = [{ id: "c1", name: "Logopedia" }, { id: "c2", name: "Psicología" }];

describe("planDePartir — qué se puede partir", () => {
  it("dos hijos → dos facturas, que suman la original", () => {
    const plan = planDePartir({
      factura: factura(),
      cobros: [cobro("k1", { patientId: "p1" }), cobro("k2", { patientId: "p2" })],
      ficha: FICHA, por: "paciente", pacientes: PACIENTES,
    });
    assert.equal(plan.ok, true, plan.motivo);
    assert.equal(plan.grupos.length, 2);
    assert.deepEqual(plan.grupos.map((g) => g.paciente).sort(), ["Lucía", "Mateo"]);
    assert.equal(plan.grupos.reduce((s, g) => s + g.importe, 0), 200);
    assert.equal(plan.mes, "2026-09");
  });

  it("por terapia, con los cobros sin concepto en su grupo «resto»", () => {
    const plan = planDePartir({
      factura: factura(),
      cobros: [cobro("k1", { conceptId: "c1" }), cobro("k2")],
      ficha: FICHA, por: "terapia", conceptos: CONCEPTOS,
    });
    assert.equal(plan.ok, true, plan.motivo);
    assert.deepEqual(plan.grupos.map((g) => g.terapia).sort(), ["(sin terapia asignada)", "Logopedia"]);
  });

  it("un solo paciente no hay nada que partir", () => {
    const plan = planDePartir({
      factura: factura(),
      cobros: [cobro("k1", { patientId: "p1" }), cobro("k2", { patientId: "p1" })],
      ficha: FICHA, por: "paciente", pacientes: PACIENTES,
    });
    assert.equal(plan.ok, false);
    assert.match(plan.motivo, /mismo paciente/);
  });

  it("si las partes no suman la original, no se emite nada", () => {
    const plan = planDePartir({
      factura: factura({ total: 250 }),
      cobros: [cobro("k1", { patientId: "p1" }), cobro("k2", { patientId: "p2" })],
      ficha: FICHA, por: "paciente", pacientes: PACIENTES,
    });
    assert.equal(plan.ok, false);
    assert.match(plan.motivo, /no cuadra/);
  });

  it("no se parte lo que no es una factura viva del lote", () => {
    const dos = [cobro("k1", { patientId: "p1" }), cobro("k2", { patientId: "p2" })];
    const base = { cobros: dos, ficha: FICHA, por: "paciente", pacientes: PACIENTES };
    assert.match(planDePartir({ ...base, factura: factura({ status: "draft" }) }).motivo, /estado 'draft'/);
    assert.match(planDePartir({ ...base, factura: factura({ status: "rectified" }) }).motivo, /estado 'rectified'/);
    assert.match(planDePartir({ ...base, factura: factura({ rectifiedByInvoiceId: "r9" }) }).motivo, /ya está rectificada/);
    assert.match(planDePartir({ ...base, factura: factura({ rectifiesInvoiceId: "f0" }) }).motivo, /rectificativa no se parte/);
    assert.match(planDePartir({ ...base, factura: factura(), cobros: [] }).motivo, /no salió del lote/);
    assert.match(planDePartir({ ...base, factura: factura(), cobros: [dos[0], { ...dos[1], status: "pending" }] }).motivo, /no están cobrados/);
    assert.match(planDePartir({ ...base, factura: factura(), ficha: null }).motivo, /ficha/);
  });

  it("sin NIF no se puede reemitir", () => {
    const plan = planDePartir({
      factura: factura(),
      cobros: [cobro("k1", { patientId: "p1" }), cobro("k2", { patientId: "p2" })],
      ficha: { ...FICHA, taxId: null }, por: "paciente", pacientes: PACIENTES,
    });
    assert.equal(plan.ok, false);
    assert.match(plan.motivo, /NIF/);
  });

  it("el criterio raro cae a paciente; pagador no es un criterio para partir", () => {
    assert.equal(criterioValido("lo que sea"), "paciente");
    assert.equal(criterioValido("terapia"), "terapia");
    assert.ok(!CRITERIOS_PARTIR.includes("pagador"));
  });
});

describe("lineasDeAnulacion — lo mismo que Rectificar con base 0", () => {
  it("cada línea en negativo, con su IVA, y suma −original", () => {
    const lineas = lineasDeAnulacion(factura({ lines: [
      { description: "A", lineBase: 100, vatRate: 21 },
      { description: "B", lineBase: 50.5, vatRate: 0 },
    ] }));
    assert.deepEqual(lineas.map((l) => [l.unitPrice, l.vatRate]), [[-100, 21], [-50.5, 0]]);
    assert.ok(lineas.every((l) => l.description.startsWith("Anulación: ")));
    assert.ok(lineas.every((l) => l.quantity === 1 && l.discountPct === 0));
  });
  it("sin líneas, nada", () => {
    assert.deepEqual(lineasDeAnulacion({}), []);
  });
});

describe("mesDeLosCobros", () => {
  it("el mes de cuota de los cobros, venga como fecha o como texto", () => {
    assert.equal(mesDeLosCobros([cobro("k1")]), "2026-09");
    assert.equal(mesDeLosCobros([cobro("k1", { periodMonth: new Date("2026-10-01T00:00:00.000Z") })]), "2026-10");
    assert.equal(mesDeLosCobros([]), null);
  });
});

describe("agruparLoteCuotas por paciente (la otra mitad del encargo)", () => {
  it("una familia con dos hijos sale con dos facturas desde el lote", () => {
    const { facturables } = agruparLoteCuotas({
      cobros: [cobro("k1", { patientId: "p1" }), cobro("k2", { patientId: "p2" }), cobro("k3")],
      clientes: [FICHA], agrupacion: "paciente", pacientes: PACIENTES,
    });
    assert.equal(facturables.length, 3);
    assert.deepEqual(facturables.map((g) => g.paciente).sort(), ["(sin paciente asignado)", "Lucía", "Mateo"]);
    assert.ok(facturables.every((g) => g.grupoId.startsWith("fam1:p:")));
  });
  it("agrupacionValida conoce las tres y cae a pagador", () => {
    assert.deepEqual(AGRUPACIONES, ["pagador", "terapia", "paciente"]);
    assert.equal(agrupacionValida("paciente"), "paciente");
    assert.equal(agrupacionValida("nada"), "pagador");
  });
});

// ── Revisión del 06/09/2026 ─────────────────────────────────────────────────
it("solo se parte lo que salió del lote de cuotas (o de un partir anterior)", () => {
  const base = { cobros: [cobro("a", { patientId: "p1" }), cobro("b", { patientId: "p2" })], ficha: FICHA, por: "paciente", pacientes: PACIENTES };
  assert.match(planDePartir({ ...base, factura: factura({ customFields: null }) }).motivo, /lote de cuotas/);
  assert.match(planDePartir({ ...base, factura: factura({ customFields: {} }) }).motivo, /lote de cuotas/);
  assert.equal(planDePartir({ ...base, factura: factura({ customFields: { loteCuotas: "2026-09", partidaDe: "F-2026-0001" } }) }).ok, true);
});
