// @prueba ligera — funciones puras de lib/billing; sin base, sin servidor, sin .env.
/**
 * _smoke-cuota-una-vara.mjs — dentro de una cuota, una sola vara de medir
 * (18/09/2026, AV-0170 de Aumenta; decidido por Rodrigo el mismo día).
 *
 *   node scripts/_smoke-cuota-una-vara.mjs
 *
 * Rosa dio de alta el 21/09 una cuota con dos terapias de 145 € y esperaba
 * 72,50 + 72,50 = 145 €. Salieron 120,83 € y lo corrigió a mano cinco minutos
 * después. El motivo: T.O. tenía las dos citas que quedaban del mes —dibuja
 * patrón, 2 de 4— y logopedia solo una, así que ESA caía a días (10/30). Dos
 * varas de medir dentro de la misma cuota, y la que caía a días lo hacía justo
 * cuando la agenda de ese servicio está a medias: el día del alta.
 *
 * Rodrigo: «todas tienen que utilizar el tema de las sesiones, no los días».
 *
 * Lo que se fija aquí es el CASO DE LA QUEJA con sus números, que es lo que
 * hace que esta prueba se entienda dentro de un año, y las dos fronteras que
 * no se pueden mover sin romper reglas anteriores:
 *   · si NINGÚN servicio dibuja patrón, no se hereda nada y la cuota sigue
 *     yendo por días (AV-0082: una sola sesión no dibuja un patrón);
 *   · si cada servicio tiene su propio ritmo, nadie hereda: se sigue cobrando
 *     cada terapia con SUS sesiones (AV-0068, la razón de repartir por
 *     concepto).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repartoPorConcepto, rotuloDeTramo } from "../lib/billing/cuotas.js";

const CONCEPTOS = new Map([
  ["logo", { unitPrice: 145, name: "Cuota Logopedia 45x1" }],
  ["to", { unitPrice: 145, name: "Cuota T.O. 45x1" }],
]);
const CUOTA = { startDate: "2026-09-21", conceptIds: ["logo", "to"], amount: null };
const reparto = (citas, cuota = CUOTA) =>
  repartoPorConcepto("2026-09", cuota, { conceptosPorId: CONCEPTOS, citas });

describe("el servicio sin patrón cobra al ritmo de su cuota (AV-0170)", () => {
  // Septiembre de 2026 tiene cuatro lunes: 7, 14, 21 y 28. Alta el 21.
  const citas = [
    { scheduledAt: "2026-09-21T10:00:00Z", conceptId: "logo" },
    { scheduledAt: "2026-09-21T11:00:00Z", conceptId: "to" },
    { scheduledAt: "2026-09-28T11:00:00Z", conceptId: "to" },
  ];

  it("los 145 € que pedía Rosa, y no los 120,83 €", () => {
    const r = reparto(citas);
    assert.equal(r.importe, 145);
    assert.equal(r.tramo.heredado, true);
  });

  it("el factor es el de las sesiones (2 de 4), no el de los días (10 de 30)", () => {
    const r = reparto(citas);
    assert.equal(Number(r.tramo.factor.toFixed(4)), 0.5);
    assert.notEqual(Number(r.tramo.factor.toFixed(4)), Number((10 / 30).toFixed(4)));
  });

  it("y el rótulo vuelve a decir la fracción en vez de callarse", () => {
    // Antes salía `mixto: true` —unos por sesiones y otros por días— y el
    // rótulo se quedaba sin cuenta. Ahora la cuenta es una sola y se dice.
    const r = reparto(citas);
    assert.equal(r.tramo.mixto, false);
    assert.match(rotuloDeTramo(r.tramo), /2 de 4 sesiones/);
  });
});

describe("las dos fronteras que no se mueven", () => {
  it("si NINGÚN servicio dibuja patrón, no se hereda nada: por días (AV-0082)", () => {
    const unaCadaUno = [
      { scheduledAt: "2026-09-21T10:00:00Z", conceptId: "logo" },
      { scheduledAt: "2026-09-21T11:00:00Z", conceptId: "to" },
    ];
    assert.equal(reparto(unaCadaUno), null);
  });

  it("si cada uno tiene su ritmo, cada uno cobra el suyo (AV-0068)", () => {
    // Logopedia los martes (4 en el mes) y T.O. los lunes, de baja el 28.
    const cuota = { startDate: "2026-09-01", endDate: "2026-09-28", conceptIds: ["logo", "to"], amount: null };
    const citas = [
      { scheduledAt: "2026-09-01T10:00:00Z", conceptId: "logo" },
      { scheduledAt: "2026-09-08T10:00:00Z", conceptId: "logo" },
      { scheduledAt: "2026-09-15T10:00:00Z", conceptId: "logo" },
      { scheduledAt: "2026-09-22T10:00:00Z", conceptId: "logo" },
      { scheduledAt: "2026-09-21T11:00:00Z", conceptId: "to" },
      { scheduledAt: "2026-09-28T11:00:00Z", conceptId: "to" },
    ];
    const r = reparto(citas, cuota);
    assert.equal(r.tramo.heredado, false, "nadie tiene que heredar si todos cuentan sus sesiones");
    // No cobran lo mismo: cada terapia va con las suyas.
    assert.ok(r.importe < 290 && r.importe > 145);
  });

  it("con importe pactado a mano no se reparte nada: ese número es un total", () => {
    const pactada = { ...CUOTA, amount: 200 };
    const citas = [
      { scheduledAt: "2026-09-21T11:00:00Z", conceptId: "to" },
      { scheduledAt: "2026-09-28T11:00:00Z", conceptId: "to" },
    ];
    assert.equal(reparto(citas, pactada), null);
  });
});
