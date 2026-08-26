// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-fraccionado-proximo-pago.mjs — el día del próximo pago de un
 * fraccionado (26/08/2026).
 *
 *   node scripts/_smoke-fraccionado-proximo-pago.mjs
 *   node --test-name-pattern="aniversario" scripts/_smoke-fraccionado-proximo-pago.mjs
 *
 * ── DE QUÉ NACE ─────────────────────────────────────────────────────────────
 *
 * Rodrigo (26/08/2026): quien paga su programa a plazos tiene que ver en su
 * área privada qué día le toca la siguiente cuota — «un mes después del
 * primero, así hasta completar todos los pagos». La cuenta vive en
 * `proximoPagoDe` (`lib/citas/packs.js`) y el portal solo la pinta.
 *
 * Lo que esta prueba fija, porque es donde se rompería sin que nadie lo viera:
 *
 *   · la cuota vence en el ANIVERSARIO de la compra, calculado siempre desde
 *     la fecha original — no sumando de mes en mes, que tras pasar por un
 *     febrero convertiría todos los día-31 en día-28 para siempre;
 *   · una compra el 31 de enero vence el 28 de febrero (no el 3 de marzo) y
 *     VUELVE al 31 en marzo;
 *   · al vencer la última cuota no hay «próximo pago»: la sección del portal
 *     desaparece en vez de prometer un cobro que no va a llegar;
 *   · un bono de pago único o anulado no anuncia nada, tenga lo que tenga en
 *     las columnas del fraccionado.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { proximoPagoDe, PAGO_FRACCIONADO, PAGO_UNICO } from "../lib/citas/packs.js";

/** Un bono fraccionado de verdad: 3 cuotas de 130 € compradas el 15 de agosto. */
function bono(extra = {}) {
  return {
    pricingMode: PAGO_FRACCIONADO,
    status: "active",
    purchasedAt: "2026-08-15T10:00:00.000Z",
    instalmentAmount: 13000,
    instalmentMonths: 3,
    ...extra,
  };
}

const dia = (fecha) => fecha.toISOString().slice(0, 10);

describe("quién no anuncia nada", () => {
  it("un bono de pago único devuelve null aunque tenga columnas de fraccionado", () => {
    assert.equal(proximoPagoDe(bono({ pricingMode: PAGO_UNICO })), null);
  });

  it("un bono anulado por el centro devuelve null: ya no se cobra", () => {
    assert.equal(proximoPagoDe(bono({ status: "anulado" })), null);
  });

  it("sin meses fiables (null, 1, texto) devuelve null", () => {
    assert.equal(proximoPagoDe(bono({ instalmentMonths: null })), null);
    assert.equal(proximoPagoDe(bono({ instalmentMonths: 1 })), null);
    assert.equal(proximoPagoDe(bono({ instalmentMonths: "tres" })), null);
  });

  it("sin fecha de compra fiable devuelve null", () => {
    assert.equal(proximoPagoDe(bono({ purchasedAt: "no es una fecha" })), null);
  });

  it("null o undefined no revientan", () => {
    assert.equal(proximoPagoDe(null), null);
    assert.equal(proximoPagoDe(undefined), null);
  });
});

describe("el aniversario mensual de la compra", () => {
  it("recién comprado: la que toca es la cuota 2, un mes después", () => {
    const pago = proximoPagoDe(bono(), new Date("2026-08-20T00:00:00Z"));
    assert.equal(pago.cuota, 2);
    assert.equal(pago.totalCuotas, 3);
    assert.equal(pago.importe, 13000);
    assert.equal(dia(pago.fecha), "2026-09-15");
  });

  it("pasada la cuota 2, toca la 3", () => {
    const pago = proximoPagoDe(bono(), new Date("2026-09-20T00:00:00Z"));
    assert.equal(pago.cuota, 3);
    assert.equal(dia(pago.fecha), "2026-10-15");
  });

  it("en el instante exacto del vencimiento la cuota ya no es «próxima»", () => {
    const pago = proximoPagoDe(bono(), new Date("2026-09-15T10:00:00.000Z"));
    assert.equal(pago.cuota, 3);
  });

  it("vencida la última cuota no hay próximo pago: null", () => {
    assert.equal(proximoPagoDe(bono(), new Date("2026-10-20T00:00:00Z")), null);
  });

  it("sin importe de cuota fiable, la fecha sale igual y el importe va null", () => {
    const pago = proximoPagoDe(bono({ instalmentAmount: null }), new Date("2026-08-20T00:00:00Z"));
    assert.equal(pago.importe, null);
    assert.equal(dia(pago.fecha), "2026-09-15");
  });
});

describe("los meses cortos no descolocan el día", () => {
  const eneroTreintaYUno = bono({
    purchasedAt: "2026-01-31T10:00:00.000Z",
    instalmentMonths: 4,
  });

  it("comprado el 31 de enero, febrero recorta al 28 (no se cuela en marzo)", () => {
    const pago = proximoPagoDe(eneroTreintaYUno, new Date("2026-02-10T00:00:00Z"));
    assert.equal(pago.cuota, 2);
    assert.equal(dia(pago.fecha), "2026-02-28");
  });

  it("y en marzo VUELVE al 31: el ancla es el día de la compra, no el mes anterior", () => {
    const pago = proximoPagoDe(eneroTreintaYUno, new Date("2026-03-10T00:00:00Z"));
    assert.equal(pago.cuota, 3);
    assert.equal(dia(pago.fecha), "2026-03-31");
  });
});
