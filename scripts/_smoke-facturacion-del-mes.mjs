// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-facturacion-del-mes.mjs — el lote de emisión masiva de cuotas
 * (31/08/2026).
 *
 *   node scripts/_smoke-facturacion-del-mes.mjs
 *   node --test-name-pattern="cuadre" scripts/_smoke-facturacion-del-mes.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Aumenta cobra ~175 cuotas al mes y venía de Organízate, donde «Facturación
 * múltiple» convertía los cobros de un rango en facturas de una pasada. En el
 * CRM las facturas se creaban una a una, y un cobro de cuota (sin factura, con
 * `period_month`) no se enganchaba nunca a la factura emitida después: la
 * factura se quedaba «emitida» con el dinero ya en el banco.
 *
 * La mitad decidible sin base de datos vive en `lib/billing/lotesCuotas.js` y
 * esto la fija por lo que DEVUELVE:
 *
 *  - agruparLoteCuotas: una factura POR PAGADOR (el reparto entre dos
 *    pagadores ya viene resuelto: cada cobro lleva el suyo), y quien no tiene
 *    NIF se APARTA con su motivo en vez de tumbar el lote — en Aumenta son
 *    ~100 familias, y una no puede dejar sin factura a las otras 74.
 *  - lineasDeCuota: el INVARIANTE del lote — la factura nace COBRADA, así que
 *    su total tiene que ser EXACTAMENTE la suma de sus cobros. Con IVA
 *    repercutido la base se busca hacia atrás, y cuando el redondeo hace
 *    imposible el cuadre exacto (a 21 % el total salta 2 céntimos entre bases
 *    consecutivas), la diferencia va en una línea de «Ajuste de redondeo» a
 *    IVA 0. Aquí se barre céntimo a céntimo que el cuadre no falla nunca.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mesValido,
  mesLegible,
  finExclusivoDe,
  agruparLoteCuotas,
  lineasDeCuota,
} from "../lib/billing/lotesCuotas.js";
import { calculateInvoice } from "../lib/billing/calculateInvoice.js";

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const FAM_GARCIA = "aaaaaaaa-0000-4000-8000-000000000001";
const FAM_LOPEZ = "aaaaaaaa-0000-4000-8000-000000000002";
const FAM_SIN_NIF = "aaaaaaaa-0000-4000-8000-000000000003";
const FAM_FANTASMA = "aaaaaaaa-0000-4000-8000-000000000004";

const CLIENTES = [
  { id: FAM_GARCIA, name: "Familia García", fiscalName: null, taxId: "11111111H", fiscalTaxId: null },
  // El NIF de FACTURACIÓN manda sobre el de la ficha (regla de nifCliente.js).
  { id: FAM_LOPEZ, name: "Familia López", fiscalName: "Empresa López SL", taxId: "22222222J", fiscalTaxId: "B76543210" },
  { id: FAM_SIN_NIF, name: "Familia Sin Papeles", fiscalName: null, taxId: "  ", fiscalTaxId: null },
];

const cobro = (id, clientId, amount, extra = {}) => ({
  id, clientId, amount, method: "transfer", paidAt: "2026-09-05T10:00:00.000Z", notes: null, ...extra,
});

describe("mesValido / mesLegible / finExclusivoDe", () => {
  it("acepta 'AAAA-MM' de verdad y rechaza el resto", () => {
    assert.equal(mesValido("2026-09"), true);
    assert.equal(mesValido("2026-13"), false);
    assert.equal(mesValido("26-09"), false);
    assert.equal(mesValido(""), false);
    assert.equal(mesValido(null), false);
  });
  it("mesLegible imprime el mes en cristiano", () => {
    assert.equal(mesLegible("2026-09"), "septiembre 2026");
    assert.equal(mesLegible("2026-01"), "enero 2026");
  });
  it("finExclusivoDe da el primer día del mes siguiente (también en diciembre)", () => {
    assert.equal(finExclusivoDe("2026-09"), "2026-10-01");
    assert.equal(finExclusivoDe("2026-12"), "2027-01-01");
    assert.equal(finExclusivoDe("mal"), null);
  });
});

describe("agruparLoteCuotas", () => {
  it("una factura por pagador, con sus cobros sumados", () => {
    const { facturables, sinNif } = agruparLoteCuotas({
      cobros: [
        cobro("c1", FAM_GARCIA, 250),
        cobro("c2", FAM_GARCIA, 100, { paidAt: "2026-09-01T09:00:00.000Z" }),
        cobro("c3", FAM_LOPEZ, 180),
      ],
      clientes: CLIENTES,
    });
    assert.equal(sinNif.length, 0);
    assert.equal(facturables.length, 2);
    const garcia = facturables.find((g) => g.clientId === FAM_GARCIA);
    assert.equal(garcia.importe, 350);
    assert.equal(garcia.cobros.length, 2);
    // Los cobros del grupo van en orden de fecha de cobro.
    assert.deepEqual(garcia.cobros.map((c) => c.id), ["c2", "c1"]);
  });

  it("el NIF de facturación manda y el de la ficha respalda (una empresa con CIF factura)", () => {
    const { facturables } = agruparLoteCuotas({
      cobros: [cobro("c1", FAM_GARCIA, 250), cobro("c2", FAM_LOPEZ, 180)],
      clientes: CLIENTES,
    });
    assert.equal(facturables.find((g) => g.clientId === FAM_GARCIA).nif, "11111111H");
    assert.equal(facturables.find((g) => g.clientId === FAM_LOPEZ).nif, "B76543210");
    // Y el nombre fiscal también manda sobre el de la ficha.
    assert.equal(facturables.find((g) => g.clientId === FAM_LOPEZ).nombre, "Empresa López SL");
  });

  it("sin NIF se aparta con su motivo, no tumba el lote", () => {
    const { facturables, sinNif } = agruparLoteCuotas({
      cobros: [cobro("c1", FAM_SIN_NIF, 250), cobro("c2", FAM_GARCIA, 100)],
      clientes: CLIENTES,
    });
    assert.equal(facturables.length, 1);
    assert.equal(sinNif.length, 1);
    assert.equal(sinNif[0].clientId, FAM_SIN_NIF);
    assert.equal(sinNif[0].motivo, "sin NIF");
    assert.equal(sinNif[0].importe, 250);
  });

  it("un cobro cuyo cliente no está entre las fichas se aparta como 'ficha no encontrada'", () => {
    const { sinNif } = agruparLoteCuotas({
      cobros: [cobro("c1", FAM_FANTASMA, 90)],
      clientes: CLIENTES,
    });
    assert.equal(sinNif.length, 1);
    assert.equal(sinNif[0].motivo, "ficha no encontrada");
  });

  it("quien ya tiene factura ese mes se MARCA (aviso), no se excluye", () => {
    const { facturables } = agruparLoteCuotas({
      cobros: [cobro("c1", FAM_GARCIA, 250), cobro("c2", FAM_LOPEZ, 180)],
      clientes: CLIENTES,
      clientesConFacturaDelMes: [FAM_GARCIA],
    });
    assert.equal(facturables.find((g) => g.clientId === FAM_GARCIA).facturaPrevia, true);
    assert.equal(facturables.find((g) => g.clientId === FAM_LOPEZ).facturaPrevia, false);
    assert.equal(facturables.length, 2);
  });

  it("un cobro sin cliente no entra en el lote (no puede haber factura sin destinatario)", () => {
    const { facturables, sinNif } = agruparLoteCuotas({
      cobros: [cobro("c1", null, 50)],
      clientes: CLIENTES,
    });
    assert.equal(facturables.length + sinNif.length, 0);
  });
});

describe("lineasDeCuota — cuadre del total con lo cobrado", () => {
  it("a IVA 0: una línea por cobro, con el mes en cristiano y la nota detrás", () => {
    const lines = lineasDeCuota({
      cobros: [cobro("c1", FAM_GARCIA, 250), cobro("c2", FAM_GARCIA, 100, { notes: "hermano pequeño" })],
      mes: "2026-09",
      vatRate: 0,
    });
    assert.equal(lines.length, 2);
    assert.equal(lines[0].description, "Cuota septiembre 2026");
    assert.equal(lines[1].description, "Cuota septiembre 2026 — hermano pequeño");
    assert.deepEqual(lines.map((l) => l.unitPrice), [250, 100]);
    const calc = calculateInvoice({ lines, irpfRate: 0 });
    assert.equal(calc.total, 350);
    assert.equal(calc.vatAmount, 0);
  });

  it("a IVA 21: la base se busca hacia atrás y el total sigue siendo lo cobrado", () => {
    for (const importe of [121, 250, 123.45, 37.51, 99.99, 0.03]) {
      const lines = lineasDeCuota({ cobros: [cobro("c1", FAM_GARCIA, importe)], mes: "2026-09", vatRate: 21 });
      const calc = calculateInvoice({ lines, irpfRate: 0 });
      assert.equal(calc.total, round2(importe), `importe ${importe}: total ${calc.total}`);
    }
  });

  it("cuadre céntimo a céntimo: ningún importe de 0,01 a 3,00 € descuadra a ningún tipo", () => {
    for (const tipo of [21, 10, 4]) {
      for (let c = 1; c <= 300; c++) {
        const importe = round2(c / 100);
        const lines = lineasDeCuota({ cobros: [cobro("c1", FAM_GARCIA, importe)], mes: "2026-09", vatRate: tipo });
        const calc = calculateInvoice({ lines, irpfRate: 0 });
        assert.equal(calc.total, importe, `IVA ${tipo} %, importe ${importe}: total ${calc.total}`);
      }
    }
  });

  it("el ajuste de redondeo solo aparece cuando hace falta, y va a IVA 0", () => {
    // 121,00 € a 21 % tiene base exacta (100,00): sin ajuste.
    const exactas = lineasDeCuota({ cobros: [cobro("c1", FAM_GARCIA, 121)], mes: "2026-09", vatRate: 21 });
    assert.equal(exactas.length, 1);
    // 0,03 € a 21 % no la tiene: base 0,02 + ajuste de 0,01 a IVA 0.
    const conAjuste = lineasDeCuota({ cobros: [cobro("c1", FAM_GARCIA, 0.03)], mes: "2026-09", vatRate: 21 });
    assert.equal(conAjuste.length, 2);
    assert.equal(conAjuste[1].description, "Ajuste de redondeo");
    assert.equal(conAjuste[1].vatRate, 0);
    assert.ok(conAjuste[1].unitPrice > 0, "el ajuste es siempre positivo (la base elegida nunca supera lo cobrado)");
  });

  it("el IRPF del lote es 0: una cuota de familia no retiene, y con retención no cuadraría", () => {
    const lines = lineasDeCuota({ cobros: [cobro("c1", FAM_GARCIA, 250)], mes: "2026-09", vatRate: 0 });
    const calc = calculateInvoice({ lines, irpfRate: 0 });
    assert.equal(calc.irpfAmount, 0);
    assert.equal(calc.total, 250);
  });
});

// ── Revisión del 06/09/2026: la etiqueta del mes no se repite ────────────────
describe("lineasDeCuota — la nota del cobro generado ya lleva «Cuota mes»", () => {
  it("no antepone la etiqueta cuando la nota ya empieza por ella", () => {
    const generado = cobro("c1", "fam1", 160, { notes: "Cuota septiembre 2026 — Logopedia · 2 sesiones/semana" });
    const [linea] = lineasDeCuota({ cobros: [generado], mes: "2026-09", vatRate: 0 });
    assert.equal(linea.description, "Cuota septiembre 2026 — Logopedia · 2 sesiones/semana");
  });
  it("y sí la antepone a una nota escrita a mano, o la pone sola si no hay nota", () => {
    const manual = cobro("c2", "fam1", 50, { notes: "Pagado en recepción" });
    const [l1] = lineasDeCuota({ cobros: [manual], mes: "2026-09", vatRate: 0 });
    assert.equal(l1.description, "Cuota septiembre 2026 — Pagado en recepción");
    const [l2] = lineasDeCuota({ cobros: [cobro("c3", "fam1", 50, { notes: "" })], mes: "2026-09", vatRate: 0 });
    assert.equal(l2.description, "Cuota septiembre 2026");
  });
});
