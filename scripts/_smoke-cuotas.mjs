// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cuotas.mjs — la cuota mensual asignada: vigencia, prorrateo y plan de
 * generación (01/09/2026).
 *
 *   node scripts/_smoke-cuotas.mjs
 *   node --test-name-pattern="prorrat" scripts/_smoke-cuotas.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Aumenta pidió «crear cuotas para grupos de pacientes y programarlas
 * mensualmente», y hasta ahora la cuota vivía en `clients.cuota_concept_ids`:
 * una lista de conceptos que el CRM APRENDÍA del último cobro. Sirve para
 * rellenar el drawer, pero no sabe decir quién debe pagar este mes — no tiene
 * ni fecha de alta, ni baja, ni paciente, ni método. Con 175 cuotas al mes,
 * eso es teclear 175 cobros a mano cada 30 días.
 *
 * La mitad decidible sin base de datos vive en `lib/billing/cuotas.js` y esto
 * la fija por lo que DEVUELVE. Los tres sitios donde se rompe de verdad:
 *
 *  - EL TRAMO: el mes del alta y el de la baja NO se cobran enteros. Un fallo
 *    aquí cobra de más a una familia que empezó el día 20.
 *  - LA REPETICIÓN: relanzar el mes no puede duplicar el cobro. El candado es
 *    `payments.cuota_id`, y aquí se fija que una cuota ya generada sale de
 *    «repetidas» y NUNCA del lote.
 *  - EL IMPORTE: sin importe pactado manda la suma de sus conceptos, para que
 *    una subida de tarifa se aplique cambiando UN concepto y no 300 filas.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mesValido,
  mesLegible,
  diasDelMes,
  ultimoDiaDe,
  tramoDelMes,
  rotuloDeTramo,
  importeDeCuota,
  fechaDeCobro,
  notaDeCobro,
  planDeCuotasDelMes,
  limpiarCuota,
  metodosValidos,
} from "../lib/billing/cuotas.js";
import { prorrateoDeCuota } from "../lib/billing/prorrateo.js";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const LOGO = "22222222-2222-2222-2222-222222222222";
const PSICO = "33333333-3333-3333-3333-333333333333";
const CONCEPTOS = [
  { id: LOGO, name: "Logopedia 60x2", unitPrice: "190.00" },
  { id: PSICO, name: "Psicología 45x1", unitPrice: "110.00" },
];

const cuota = (extra = {}) => ({
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  clientId: CLIENTE,
  patientId: null,
  conceptIds: [LOGO],
  amount: null,
  method: "transfer",
  dayOfMonth: 5,
  startDate: "2020-01-01",
  endDate: null,
  active: true,
  nombre: "Familia Pérez",
  ...extra,
});

describe("el mes", () => {
  it("solo acepta AAAA-MM de verdad", () => {
    assert.equal(mesValido("2026-09"), true);
    assert.equal(mesValido("2026-13"), false);
    assert.equal(mesValido("2026-9"), false);
    assert.equal(mesValido(""), false);
    assert.equal(mesValido(null), false);
  });

  it("cuenta los días reales, febrero bisiesto incluido", () => {
    assert.equal(diasDelMes("2026-09"), 30);
    assert.equal(diasDelMes("2026-02"), 28);
    assert.equal(diasDelMes("2028-02"), 29); // bisiesto
    assert.equal(ultimoDiaDe("2026-02"), "2026-02-28");
  });

  it("se dice en cristiano", () => {
    assert.equal(mesLegible("2026-09"), "septiembre 2026");
  });
});

describe("el tramo del mes (qué parte se cobra)", () => {
  it("una cuota de siempre cobra el mes entero", () => {
    const t = tramoDelMes("2026-09", { startDate: "2020-01-01" });
    assert.equal(t.completo, true);
    assert.equal(t.factor, 1);
    assert.equal(rotuloDeTramo(t), null); // sin rótulo: no hay nada que explicar
  });

  it("el mes del ALTA se prorratea por días, igual que el drawer de cobros", () => {
    const t = tramoDelMes("2026-09", { startDate: "2026-09-13" });
    assert.equal(t.diasCobrados, 18);
    assert.equal(t.diasDelMes, 30);
    // La misma cuenta que `prorrateo.js`, que es lo que ya ve la familia en la
    // nota del cobro: si divergieran, el mismo alta daría dos importes.
    assert.equal(t.diasCobrados, prorrateoDeCuota(0, "2026-09-13").diasCobrados);
    assert.equal(rotuloDeTramo(t), "desde el 13/09/2026 (18/30 días)");
  });

  it("el mes de la BAJA también, por el otro lado", () => {
    const t = tramoDelMes("2026-09", { startDate: "2020-01-01", endDate: "2026-09-10" });
    assert.equal(t.diasCobrados, 10);
    assert.equal(rotuloDeTramo(t), "hasta el 10/09/2026 (10/30 días)");
  });

  it("alta y baja dentro del mismo mes cobran solo esos días", () => {
    const t = tramoDelMes("2026-09", { startDate: "2026-09-10", endDate: "2026-09-19" });
    assert.equal(t.diasCobrados, 10);
    assert.equal(rotuloDeTramo(t), "del 10/09/2026 al 19/09/2026 (10/30 días)");
  });

  it("fuera del mes no hay tramo (ni antes del alta ni después de la baja)", () => {
    assert.equal(tramoDelMes("2026-08", { startDate: "2026-09-01" }), null);
    assert.equal(tramoDelMes("2026-10", { startDate: "2020-01-01", endDate: "2026-09-30" }), null);
  });

  it("la baja el último día del mes cobra el mes entero", () => {
    const t = tramoDelMes("2026-09", { startDate: "2020-01-01", endDate: "2026-09-30" });
    assert.equal(t.completo, true);
  });

  it("una fecha ilegible no deja a nadie fuera: se cobra el mes entero", () => {
    const t = tramoDelMes("2026-09", { startDate: "vete a saber" });
    assert.equal(t.completo, true);
  });
});

describe("cuánto vale la cuota", () => {
  const porId = new Map(CONCEPTOS.map((c) => [c.id, c]));

  it("sin importe escrito, la suma de sus conceptos", () => {
    const r = importeDeCuota({ conceptIds: [LOGO, PSICO] }, porId);
    assert.equal(r.importe, 300);
    assert.equal(r.fuente, "conceptos");
  });

  it("con importe escrito manda ese, aunque los conceptos digan otra cosa", () => {
    const r = importeDeCuota({ amount: "250.00", conceptIds: [LOGO, PSICO] }, porId);
    assert.equal(r.importe, 250);
    assert.equal(r.fuente, "pactado");
  });

  it("un importe de 0 pactado es válido (una beca), no 'sin importe'", () => {
    const r = importeDeCuota({ amount: 0, conceptIds: [LOGO] }, porId);
    assert.equal(r.importe, 0);
    assert.equal(r.fuente, "pactado");
  });

  it("un concepto borrado se cuenta aparte en vez de cobrar de menos en silencio", () => {
    const r = importeDeCuota({ conceptIds: [LOGO, "44444444-4444-4444-4444-444444444444"] }, porId);
    assert.equal(r.importe, 190);
    assert.equal(r.conceptosPerdidos.length, 1);
  });
});

describe("la fecha del cobro", () => {
  it("es el día de cobro de la cuota dentro de ese mes", () => {
    assert.equal(fechaDeCobro("2026-09", { dayOfMonth: 5 }, tramoDelMes("2026-09", {})), "2026-09-05");
  });

  it("un día 31 en febrero se recorta al último día real", () => {
    assert.equal(fechaDeCobro("2026-02", { dayOfMonth: 31 }, tramoDelMes("2026-02", {})), "2026-02-28");
  });

  it("nunca es anterior al día en que la cuota empieza", () => {
    const t = tramoDelMes("2026-09", { startDate: "2026-09-20" });
    assert.equal(fechaDeCobro("2026-09", { dayOfMonth: 5 }, t), "2026-09-20");
  });

  it("sin día configurado, el primero del tramo", () => {
    assert.equal(fechaDeCobro("2026-09", {}, tramoDelMes("2026-09", {})), "2026-09-01");
  });
});

describe("la nota que queda escrita", () => {
  it("lleva el mes, los conceptos y el prorrateo si lo hay", () => {
    const t = tramoDelMes("2026-09", { startDate: "2026-09-13" });
    assert.equal(
      notaDeCobro({ mes: "2026-09", conceptos: ["Logopedia 60x2"], rotulo: rotuloDeTramo(t) }),
      "Cuota septiembre 2026 — Logopedia 60x2 — desde el 13/09/2026 (18/30 días)"
    );
  });

  it("sin conceptos ni prorrateo, solo el mes", () => {
    assert.equal(notaDeCobro({ mes: "2026-09" }), "Cuota septiembre 2026");
  });
});

describe("el plan del mes", () => {
  const plan = (extra = {}, resto = {}) =>
    planDeCuotasDelMes({ mes: "2026-09", cuotas: [cuota(extra)], conceptos: CONCEPTOS, ...resto });

  it("una cuota vigente genera su cobro del mes", () => {
    const { aGenerar } = plan();
    assert.equal(aGenerar.length, 1);
    assert.equal(aGenerar[0].importe, 190);
    assert.equal(aGenerar[0].paidAt, "2026-09-05");
    assert.equal(aGenerar[0].periodMonth, "2026-09-01");
    assert.equal(aGenerar[0].method, "transfer");
  });

  it("el mes del alta sale prorrateado, con su explicación", () => {
    const { aGenerar } = plan({ startDate: "2026-09-16" });
    assert.equal(aGenerar[0].importe, 95); // 190 × 15/30
    assert.equal(aGenerar[0].importeMensual, 190);
    assert.match(aGenerar[0].notes, /desde el 16\/09\/2026 \(15\/30 días\)/);
  });

  it("RELANZAR EL MES NO DUPLICA: la ya generada sale en repetidas", () => {
    const { aGenerar, repetidas } = plan({}, { yaGenerados: ["aaaaaaaa-0000-0000-0000-000000000001"] });
    assert.equal(aGenerar.length, 0);
    assert.equal(repetidas.length, 1);
  });

  it("una cuota EN PAUSA (apagada y sin fecha de baja) no genera nada", () => {
    assert.equal(plan({ active: false }).aGenerar.length, 0);
  });

  it("una cuota DADA DE BAJA sí genera el mes de la baja, prorrateado", () => {
    const { aGenerar } = plan({ active: false, endDate: "2026-09-10" });
    assert.equal(aGenerar.length, 1);
    assert.equal(aGenerar[0].importe, 63.33); // 190 × 10/30
  });

  it("y ya no genera el mes siguiente", () => {
    const { aGenerar } = planDeCuotasDelMes({
      mes: "2026-10",
      cuotas: [cuota({ active: false, endDate: "2026-09-10" })],
      conceptos: CONCEPTOS,
    });
    assert.equal(aGenerar.length, 0);
  });

  it("un cobro de 0 € no se genera: se aparta con su motivo", () => {
    const { aGenerar, sinImporte } = plan({ conceptIds: [], amount: null });
    assert.equal(aGenerar.length, 0);
    assert.equal(sinImporte.length, 1);
    assert.equal(sinImporte[0].motivo, "importe 0");
  });

  it("una cuota cuyos conceptos ya no existen se aparta diciéndolo", () => {
    const { sinImporte } = plan({ conceptIds: ["44444444-4444-4444-4444-444444444444"] });
    assert.equal(sinImporte[0].motivo, "sus conceptos ya no existen");
  });

  it("el filtro por método aparta las demás sin cambiarles el importe", () => {
    const cuotas = [
      cuota({ id: "aaaaaaaa-0000-0000-0000-00000000000a", method: "transfer" }),
      cuota({ id: "aaaaaaaa-0000-0000-0000-00000000000b", method: "cash" }),
    ];
    const solo = planDeCuotasDelMes({ mes: "2026-09", cuotas, conceptos: CONCEPTOS, metodos: ["cash"] });
    assert.equal(solo.aGenerar.length, 1);
    assert.equal(solo.aGenerar[0].method, "cash");
    assert.equal(solo.aGenerar[0].importe, 190); // el mismo que en el lote entero
  });

  it("con UN concepto el cobro lleva su terapia; con dos, no (no se puede partir)", () => {
    assert.equal(plan({ conceptIds: [LOGO] }).aGenerar[0].conceptId, LOGO);
    assert.equal(plan({ conceptIds: [LOGO, PSICO] }).aGenerar[0].conceptId, null);
  });

  it("un mes inválido devuelve el plan vacío en vez de reventar", () => {
    const r = planDeCuotasDelMes({ mes: "2026-13", cuotas: [cuota()] });
    assert.deepEqual(r, { aGenerar: [], repetidas: [], sinImporte: [] });
  });
});

describe("lo que acepta el alta de una cuota", () => {
  const base = { clientId: CLIENTE, startDate: "2026-09-01" };

  it("sin cliente no hay cuota", () => {
    assert.match(limpiarCuota({ startDate: "2026-09-01" }).problema, /cliente/i);
  });

  it("el importe vacío SIGNIFICA algo: 'lo que digan sus conceptos'", () => {
    assert.equal(limpiarCuota({ ...base, amount: "" }).valores.amount, null);
  });

  it("un importe ilegible se rechaza en vez de colarse valiendo cero", () => {
    assert.match(limpiarCuota({ ...base, amount: "ochenta" }).problema, /número/i);
  });

  it("la baja no puede ser anterior al alta", () => {
    assert.match(limpiarCuota({ ...base, endDate: "2026-08-01" }).problema, /anterior/i);
  });

  it("un día de cobro fuera de mes se rechaza", () => {
    assert.match(limpiarCuota({ ...base, dayOfMonth: 40 }).problema, /1 y 31/);
  });

  it("un método inventado se rechaza", () => {
    assert.match(limpiarCuota({ ...base, method: "bizum" }).problema, /método/i);
    assert.deepEqual(metodosValidos(["cash", "bizum", "card"]), ["cash", "card"]);
  });

  it("la edición parcial solo toca lo que viaja", () => {
    const { valores } = limpiarCuota({ amount: 200 }, { parcial: true });
    assert.deepEqual(Object.keys(valores), ["amount"]);
  });

  it("los conceptos repetidos se colapsan y los ids falsos se caen", () => {
    const { valores } = limpiarCuota({ ...base, conceptIds: [LOGO, LOGO, "no-soy-un-uuid"] });
    assert.deepEqual(valores.conceptIds, [LOGO]);
  });
});
