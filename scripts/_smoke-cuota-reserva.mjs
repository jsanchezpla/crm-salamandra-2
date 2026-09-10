// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cuota-reserva.mjs — la reserva de plaza ya pagada se descuenta del
 * primer mes, y solo del primero (09/09/2026).
 *
 *   node scripts/_smoke-cuota-reserva.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Aumenta: «en cuotas que estamos creando, deja pendiente 30 €».
 *
 * Las familias pagan 30 € en verano para guardar la plaza del curso siguiente,
 * y ese dinero se descuenta del primer mes. El 01/09/2026 eso se hizo con un
 * script de una sola vez contra los cobros de septiembre YA generados (242
 * cobros con su «Reserva de plaza ya abonada: −30 €» escrito en la nota). Pero
 * la rebaja se quedó en aquellos cobros y no en la cuota: cada cuota nueva
 * generaba el mes entero, la familia pagaba lo suyo menos los 30 € que ya había
 * adelantado, y quedaban 30 € pendientes que nadie debía.
 *
 * Lo que se fija aquí es lo que de verdad puede volver a romperse:
 *
 *  - SE DESCUENTA UNA VEZ. El segundo mes tiene que salir entero. Un fallo aquí
 *    regala 30 € cada mes a 100 familias y nadie lo ve hasta el cierre.
 *  - NO SE PRORRATEA. La reserva se pagó entera aunque el mes de alta sea a
 *    medias, igual que los conceptos negativos del catálogo.
 *  - LA NOTA LA TIENE QUE PODER LEER `motivoDelCobro`, que es el cuadro «de
 *    dónde sale esta cifra» del cajón de cobrar. Si el molde no encaja, la
 *    frase se pinta como si fuera el NOMBRE del concepto.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  descuentoDeReserva,
  notaDeCobro,
  planDeCuotasDelMes,
  reservaDeLasCuotas,
  reservaPendiente,
} from "../lib/billing/cuotas.js";
import { partesConProrrateo } from "../lib/billing/prorrateo.js";
import { explicaCobro } from "../lib/billing/motivoDelCobro.js";

const CONCEPTO = { id: "11111111-1111-1111-1111-111111111111", name: "Cuota Psicología 45x1", unitPrice: 145 };

const cuotaBase = (extra = {}) => ({
  id: "22222222-2222-2222-2222-222222222222",
  clientId: "33333333-3333-3333-3333-333333333333",
  patientId: null,
  conceptIds: [CONCEPTO.id],
  amount: null,
  method: "transfer",
  dayOfMonth: null,
  startDate: "2026-09-01",
  endDate: null,
  active: true,
  reservaAbonada: null,
  reservaAplicadaEn: null,
  ...extra,
});

const plan = (cuota, mes = "2026-09") =>
  planDeCuotasDelMes({ mes, cuotas: [cuota], conceptos: [CONCEPTO], yaGenerados: [] });

describe("descuentoDeReserva", () => {
  it("sin reserva no descuenta nada", () => {
    assert.equal(descuentoDeReserva(cuotaBase(), "2026-09", 145), null);
    assert.equal(descuentoDeReserva(cuotaBase({ reservaAbonada: 0 }), "2026-09", 145), null);
  });

  it("descuenta la reserva y la explica", () => {
    const d = descuentoDeReserva(cuotaBase({ reservaAbonada: 30 }), "2026-09", 145);
    assert.equal(d.importe, 30);
    assert.equal(d.motivo, "Reserva de plaza ya abonada: −30 €");
  });

  it("ya aplicada en otro mes: el mes va entero", () => {
    const c = cuotaBase({ reservaAbonada: 30, reservaAplicadaEn: "2026-09" });
    assert.equal(descuentoDeReserva(c, "2026-10", 145), null);
  });

  it("aplicada en ESTE mes sigue descontando (rehacer el cobro no puede perderla)", () => {
    const c = cuotaBase({ reservaAbonada: 30, reservaAplicadaEn: "2026-09" });
    assert.equal(descuentoDeReserva(c, "2026-09", 145).importe, 30);
  });

  it("nunca deja el cobro por debajo de cero", () => {
    const d = descuentoDeReserva(cuotaBase({ reservaAbonada: 30 }), "2026-09", 25);
    assert.equal(d.importe, 25);
  });

  it("con céntimos, el importe se dice con dos decimales", () => {
    const d = descuentoDeReserva(cuotaBase({ reservaAbonada: 12.5 }), "2026-09", 145);
    assert.equal(d.motivo, "Reserva de plaza ya abonada: −12.50 €");
  });
});

describe("el plan del mes con reserva", () => {
  it("el primer mes sale rebajado y lo dice en la nota", () => {
    const { aGenerar } = plan(cuotaBase({ reservaAbonada: 30 }));
    assert.equal(aGenerar.length, 1);
    assert.equal(aGenerar[0].importe, 115);
    assert.equal(aGenerar[0].importeMensual, 145);
    assert.deepEqual(aGenerar[0].reservaAplicada, { mes: "2026-09", importe: 30 });
    assert.match(aGenerar[0].notes, /Reserva de plaza ya abonada: −30 €$/);
  });

  it("el mes siguiente, con la reserva ya gastada, sale entero", () => {
    const c = cuotaBase({ reservaAbonada: 30, reservaAplicadaEn: "2026-09" });
    const { aGenerar } = plan(c, "2026-10");
    assert.equal(aGenerar[0].importe, 145);
    assert.equal(aGenerar[0].reservaAplicada, null);
    assert.doesNotMatch(aGenerar[0].notes, /[Rr]eserva/);
  });

  it("la reserva NO se prorratea: el mes de alta a medias la resta entera", () => {
    // Alta el 16 de septiembre: 15 de 30 días → la mitad de 145 = 72,50.
    const c = cuotaBase({ startDate: "2026-09-16", reservaAbonada: 30 });
    const { aGenerar } = plan(c);
    assert.equal(aGenerar[0].importe, 42.5);
    assert.match(aGenerar[0].notes, /desde el 16\/09\/2026/);
    assert.match(aGenerar[0].notes, /Reserva de plaza ya abonada: −30 €/);
  });

  it("si la reserva se come el mes entero, no se genera un cobro de 0 €", () => {
    const c = cuotaBase({ amount: 30, reservaAbonada: 30 });
    const { aGenerar, sinImporte } = plan(c);
    assert.equal(aGenerar.length, 0);
    assert.equal(sinImporte.length, 1);
  });
});

describe("una reserva gastada no se descuenta dos veces", () => {
  /*
   * Lo que Rodrigo no quiere volver a oír: «me está cobrando 30 € de menos
   * porque se ha quedado los de la reserva». Con el mes escrito, cualquier otro
   * mes va entero — da igual cuántas veces se genere o se rehaga el cobro.
   */
  it("gastada en septiembre: octubre, noviembre y diciembre van enteros", () => {
    const c = cuotaBase({ reservaAbonada: 30, reservaAplicadaEn: "2026-09" });
    for (const mes of ["2026-10", "2026-11", "2026-12"]) {
      assert.equal(descuentoDeReserva(c, mes, 145), null, `${mes} tendría que ir entero`);
      assert.equal(plan(c, mes).aGenerar[0].importe, 145);
    }
  });

  it("volver a generar el MISMO mes no la descuenta otra vez", () => {
    const c = cuotaBase({ reservaAbonada: 30, reservaAplicadaEn: "2026-09" });
    const uno = plan(c).aGenerar[0];
    const dos = plan(c).aGenerar[0];
    assert.equal(uno.importe, 115);
    assert.equal(dos.importe, 115); // el descuento es de ese mes, no un contador
  });

  it("sin reserva escrita no se descuenta nada en ningún mes", () => {
    for (const mes of ["2026-09", "2026-10", "2027-01"]) {
      assert.equal(plan(cuotaBase(), mes).aGenerar[0].importe, 145);
    }
  });
});

describe("la nota la sabe leer el cajón de cobrar", () => {
  it("la reserva sale como MOTIVO, no como nombre del concepto", () => {
    const { aGenerar } = plan(cuotaBase({ reservaAbonada: 30 }));
    const leido = explicaCobro({ notes: aGenerar[0].notes });
    assert.equal(leido.concepto, "Cuota Psicología 45x1");
    assert.deepEqual(leido.motivos, ["Reserva de plaza ya abonada: −30,00 €"]);
  });

  it("con prorrateo, el rótulo y la reserva son dos motivos distintos", () => {
    const c = cuotaBase({ startDate: "2026-09-16", reservaAbonada: 30 });
    const leido = explicaCobro({ notes: plan(c).aGenerar[0].notes });
    assert.equal(leido.concepto, "Cuota Psicología 45x1");
    assert.equal(leido.motivos.length, 2);
    assert.match(leido.motivos[0], /^desde el 16\/09\/2026/);
    assert.equal(leido.motivos[1], "Reserva de plaza ya abonada: −30,00 €");
  });
});

describe("notaDeCobro con motivos", () => {
  it("sin motivos no cambia lo que escribía siempre", () => {
    assert.equal(notaDeCobro({ mes: "2026-09", conceptos: ["Logopedia 60x2"] }), "Cuota septiembre 2026 — Logopedia 60x2");
  });
  it("los motivos van al final, separados por « — »", () => {
    assert.equal(
      notaDeCobro({ mes: "2026-09", conceptos: ["Logopedia 60x2"], motivos: ["Reserva de plaza ya abonada: −30 €"] }),
      "Cuota septiembre 2026 — Logopedia 60x2 — Reserva de plaza ya abonada: −30 €"
    );
  });
});

describe("la reserva que ve el CAJÓN de cobros (10/09/2026)", () => {
  /*
   * EL CASO DE RODRIGO. «Debía 145 de logopedia 45x1. Hizo la reserva, por
   * tanto se descontaron 30 euros. Como ha empezado tarde se ha partido en
   * varias sesiones y debía 108,75 − 30 de reserva.»
   *
   * El cajón prorratea la TARIFA del catálogo (145 × 3/4 = 108,75) y hasta hoy
   * ahí se quedaba: los 30 € que la familia ya había adelantado no entraban en
   * la cuenta, así que proponía 108,75 € para un mes que valía 78,75 €. La
   * generación mensual llevaba desde el 07/09 haciendo bien esta misma resta.
   */
  const CITAS = ["2026-09-10", "2026-09-17", "2026-09-24"].map((f) => ({
    scheduledAt: `${f}T10:00:00.000Z`,
    conceptId: CONCEPTO.id,
  }));

  const loQueProponeElCajon = (cuotas) => {
    const bruto = partesConProrrateo(
      [{ importe: CONCEPTO.unitPrice, inicio: "2026-09-10", fin: "", conceptId: CONCEPTO.id }],
      { mes: "2026-09", citas: CITAS }
    ).total;
    const reserva = reservaDeLasCuotas(cuotas, "2026-09");
    return Math.max(0, Math.round((bruto - Math.min(reserva, bruto)) * 100) / 100);
  };

  it("3 de 4 sesiones son 108,75 € de tarifa", () => {
    assert.equal(loQueProponeElCajon([]), 108.75);
  });

  it("y con la reserva ya abonada, 78,75 €", () => {
    assert.equal(loQueProponeElCajon([cuotaBase({ reservaAbonada: 30, reservaAplicadaEn: "2026-09" })]), 78.75);
  });

  it("una reserva gastada en otro mes no vuelve a descontarse", () => {
    assert.equal(loQueProponeElCajon([cuotaBase({ reservaAbonada: 30, reservaAplicadaEn: "2026-08" })]), 108.75);
  });
});

describe("reservaPendiente / reservaDeLasCuotas", () => {
  it("sin reserva, o gastada en otro mes, no queda nada por descontar", () => {
    assert.equal(reservaPendiente(cuotaBase(), "2026-09"), 0);
    assert.equal(reservaPendiente(cuotaBase({ reservaAbonada: 0 }), "2026-09"), 0);
    assert.equal(reservaPendiente(cuotaBase({ reservaAbonada: 30, reservaAplicadaEn: "2026-08" }), "2026-09"), 0);
  });

  it("sin gastar, o gastada en ESTE mes, quedan los 30 €", () => {
    assert.equal(reservaPendiente(cuotaBase({ reservaAbonada: 30 }), "2026-09"), 30);
    assert.equal(reservaPendiente(cuotaBase({ reservaAbonada: 30, reservaAplicadaEn: "2026-09" }), "2026-09"), 30);
  });

  it("con dos cuotas de la misma familia se suman", () => {
    const dos = [cuotaBase({ reservaAbonada: 30 }), cuotaBase({ reservaAbonada: 30 })];
    assert.equal(reservaDeLasCuotas(dos, "2026-09"), 60);
    assert.equal(reservaDeLasCuotas([], "2026-09"), 0);
    assert.equal(reservaDeLasCuotas(null, "2026-09"), 0);
  });

  it("dice lo mismo que `descuentoDeReserva` cuando cabe entero", () => {
    const c = cuotaBase({ reservaAbonada: 30 });
    assert.equal(reservaPendiente(c, "2026-09"), descuentoDeReserva(c, "2026-09", 145).importe);
  });
});
