// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-cobros-del-tramo.mjs — de una cuota firmada salen TODOS sus cobros
 * (10/09/2026, Rodrigo).
 *
 * «Aumentín hemos puesto que tenga 6 meses de cuota en Pedagogía 60x1. Por
 * tanto deberían salir 6 cobros pendientes, cada uno relativo a un mes.»
 *
 * Lo que se fija aquí es QUÉ MESES hay que poner al día, que es lo único que
 * decide `lib/billing/cobrosDelTramo.js`; lo que se escribe en cada uno lo
 * resuelve `sincronizarCobroDelMes`, con sus propias pruebas.
 *
 *   node scripts/_smoke-cobros-del-tramo.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mesSiguiente, mesesDelTramo, mesesAPonerAlDia, TOPE_MESES } from "../lib/billing/cobrosDelTramo.js";

// La cuota del ejemplo: seis meses desde septiembre.
const AUMENTIN = { startDate: "2026-09-01", endDate: "2027-02-28" };
const HOY = "2026-09";

describe("mesesDelTramo — los meses que se han firmado", () => {
  it("seis meses firmados son seis meses", () => {
    assert.deepEqual(mesesDelTramo(AUMENTIN, { hoy: HOY }), [
      "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02",
    ]);
  });

  it("una cuota que empieza más adelante arranca en su mes, no en este", () => {
    assert.deepEqual(
      mesesDelTramo({ startDate: "2026-11-15", endDate: "2027-01-31" }, { hoy: HOY }),
      ["2026-11", "2026-12", "2027-01"]
    );
  });

  it("lo que ya pasó no se rehace: se empieza en el mes en curso", () => {
    // Firmada en marzo hasta noviembre y editada hoy: marzo… agosto se quedan
    // como se quedaron. Inventarles un cobro sería inventarle deuda a la familia.
    assert.deepEqual(
      mesesDelTramo({ startDate: "2026-03-01", endDate: "2026-11-30" }, { hoy: HOY }),
      ["2026-09", "2026-10", "2026-11"]
    );
  });

  it("sin fecha de baja no hay número firmado", () => {
    assert.deepEqual(mesesDelTramo({ startDate: "2026-09-01", endDate: null }, { hoy: HOY }), []);
    assert.deepEqual(mesesDelTramo({}, { hoy: HOY }), []);
  });

  it("un tramo que terminó, o del revés, no da meses", () => {
    assert.deepEqual(mesesDelTramo({ startDate: "2025-09-01", endDate: "2026-06-30" }, { hoy: HOY }), []);
    assert.deepEqual(mesesDelTramo({ startDate: "2027-01-01", endDate: "2026-09-30" }, { hoy: HOY }), []);
  });

  it("y hay tope: una cuota firmada a cinco años no llena Cobros", () => {
    const largo = mesesDelTramo({ startDate: "2026-09-01", endDate: "2031-06-30" }, { hoy: HOY });
    assert.equal(largo.length, TOPE_MESES);
    assert.equal(largo[0], "2026-09");
  });

  it("el cambio de año se cuenta bien", () => {
    assert.equal(mesSiguiente("2026-12"), "2027-01");
    assert.equal(mesSiguiente("2026-01"), "2026-02");
  });
});

describe("mesesAPonerAlDia — y los pendientes que sobran", () => {
  it("acortar la cuota repasa también los meses que ya no cubre", () => {
    // De seis meses a tres: los cobros de diciembre, enero y febrero siguen
    // pendientes y hay que pasar por ellos para retirarlos.
    const meses = mesesAPonerAlDia(
      {
        startDate: "2026-09-01",
        endDate: "2026-11-30",
        pendientes: ["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"],
      },
      { hoy: HOY }
    );
    assert.deepEqual(meses, [
      "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02",
    ]);
  });

  it("un pendiente viejo no se toca", () => {
    const meses = mesesAPonerAlDia(
      { startDate: "2026-09-01", endDate: "2026-10-31", pendientes: ["2026-03-01"] },
      { hoy: HOY }
    );
    assert.deepEqual(meses, ["2026-09", "2026-10"]);
  });

  it("sin tramo firmado queda el mes en curso, como hasta hoy", () => {
    assert.deepEqual(mesesAPonerAlDia({ startDate: "2026-09-01" }, { hoy: HOY }), [HOY]);
    assert.deepEqual(mesesAPonerAlDia({}, { hoy: HOY }), [HOY]);
  });

  it("no repite un mes por estar en los dos sitios, y salen en orden", () => {
    const meses = mesesAPonerAlDia(
      { startDate: "2026-09-01", endDate: "2026-11-30", pendientes: ["2026-11-01", "2026-09-01"] },
      { hoy: HOY }
    );
    assert.deepEqual(meses, ["2026-09", "2026-10", "2026-11"]);
  });
});
