// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-paciente-del-cobro.mjs — qué paciente puede ir en un cobro
 * (07/09/2026).
 *
 *   node scripts/_smoke-paciente-del-cobro.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * El 07/09/2026 entraron a master, con horas de diferencia, dos cosas que se
 * pisaron: «Editar cobro» empezó a validar que el paciente fuera de la familia
 * del cobro, y la cuota pasó a poder tener PAGADOR
 * (`billing_cuotas.payer_client_id`), con lo que el cobro nace a nombre de
 * quien paga y el niño es de OTRA ficha.
 *
 * Resultado, reproducido en local antes de arreglarlo: un cobro nacido de una
 * cuota que paga una fundación devolvía 409 «Ese paciente no es de la familia
 * de este cobro» al guardar CUALQUIER cambio —el importe, la fecha, el
 * método—, porque el cajón manda siempre el paciente que ya tenía. La cuota
 * quedaba inservible desde las dos pantallas que la editan (Cobros y la vista
 * lateral del arqueo).
 *
 * Lo que aquí se fija, por lo que DEVUELVE: valen las dos fichas —la del cobro
 * y la de la cuota—, y lo que no se sabe no se bloquea.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pacienteValeParaElCobro } from "../lib/billing/patientLink.js";

const FAMILIA = "11111111-1111-1111-1111-111111111111";
const FUNDACION = "22222222-2222-2222-2222-222222222222";
const OTRA = "33333333-3333-3333-3333-333333333333";

describe("qué paciente vale para un cobro", () => {
  it("el de la familia del cobro, como siempre", () => {
    assert.equal(
      pacienteValeParaElCobro({ pacienteClientId: FAMILIA, cobroClientId: FAMILIA }),
      true
    );
  });

  it("EL CASO QUE SE ROMPIÓ: con pagador, el niño es de la familia de la CUOTA", () => {
    assert.equal(
      pacienteValeParaElCobro({
        pacienteClientId: FAMILIA,
        cobroClientId: FUNDACION,
        cuotaClientId: FAMILIA,
      }),
      true
    );
  });

  it("un paciente de una tercera ficha sigue sin valer", () => {
    assert.equal(
      pacienteValeParaElCobro({
        pacienteClientId: OTRA,
        cobroClientId: FUNDACION,
        cuotaClientId: FAMILIA,
      }),
      false
    );
    assert.equal(
      pacienteValeParaElCobro({ pacienteClientId: OTRA, cobroClientId: FAMILIA }),
      false
    );
  });

  it("un paciente sin ficha no se discute: no hay con qué compararlo", () => {
    assert.equal(
      pacienteValeParaElCobro({ pacienteClientId: null, cobroClientId: FAMILIA }),
      true
    );
  });

  it("sin ninguna ficha conocida no se bloquea nada", () => {
    assert.equal(pacienteValeParaElCobro({ pacienteClientId: FAMILIA }), true);
    assert.equal(pacienteValeParaElCobro({}), true);
  });

  it("compara por valor, no por tipo: los ids pueden llegar como objeto de la base", () => {
    assert.equal(
      pacienteValeParaElCobro({
        pacienteClientId: FAMILIA,
        cobroClientId: { toString: () => FAMILIA },
      }),
      true
    );
  });
});
