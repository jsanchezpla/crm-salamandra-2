// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-reembolso-excepcion.mjs — las dos caras de la política de
 * devolución de citas (20/08/2026).
 *
 *   node --test scripts/_smoke-citas-reembolso-excepcion.mjs
 *   node --test-name-pattern="excepción" scripts/_smoke-citas-reembolso-excepcion.mjs
 *
 * ── QUÉ VIGILA ─────────────────────────────────────────────────────────────
 *
 * `_smoke-no-se-devuelve.mjs` fija la regla del 07/08/2026: el CRM no devuelve
 * dinero al cancelar. Esta fija la ÚNICA excepción que se le abrió el
 * 20/08/2026 (Jorge) y, sobre todo, que la excepción no se derrame: se cobró
 * una cita que otra petición ya había cancelado —una carrera de milisegundos
 * dentro de `/confirm`—, y ahí sí se devuelve, porque el cobro es un fallo
 * nuestro y no compra nada.
 *
 * Las dos caras van en el mismo fichero a propósito: una excepción sin la regla
 * al lado es lo que acaba devolviéndole el dinero a todo el mundo.
 *
 * Lo que se comprueba es lo que DEVUELVE `decidirReembolso`, que es una función
 * pura: quién cancela y con cuánta antelación no entran aquí, solo el estado
 * del cobro y el motivo con nombre.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decidirReembolso,
  MOTIVO_COBRO_DE_CITA_CANCELADA,
} from "../lib/citas/politicaReembolso.js";

describe("la regla: al cancelar una cita cobrada no se devuelve el dinero", () => {
  it("no devuelve nada cancele quien cancele", () => {
    for (const quienCancela of ["cliente", "profesional", "no_show"]) {
      const d = decidirReembolso({ quienCancela, paymentStatus: "paid", amount: 6000 });
      assert.equal(d.reembolsar, false, `cancela ${quienCancela}`);
      assert.equal(d.importe, 0);
    }
  });

  it("un motivo cualquiera no abre la puerta: solo la abre el que tiene nombre", () => {
    for (const motivo of [null, undefined, "", "cancelada", "cobro", "cobro_de_cita"]) {
      const d = decidirReembolso({ paymentStatus: "paid", amount: 6000, motivo });
      assert.equal(d.reembolsar, false, `motivo ${JSON.stringify(motivo)}`);
    }
  });

  it("dice por qué no, para que quede escrito en la auditoría", () => {
    const d = decidirReembolso({ paymentStatus: "paid", amount: 6000 });
    assert.match(d.motivo, /no se devuelve autom/i);
  });
});

describe("la excepción: se cobró una cita que ya estaba cancelada", () => {
  it("devuelve, y el importe entero", () => {
    const d = decidirReembolso({
      paymentStatus: "paid",
      amount: 6000,
      motivo: MOTIVO_COBRO_DE_CITA_CANCELADA,
    });
    assert.equal(d.reembolsar, true);
    assert.equal(d.importe, 6000);
  });

  it("una cita sin importe apuntado se devuelve igual: el importe lo pone el cobro", () => {
    for (const amount of [null, undefined, 0, -100, 12.5]) {
      const d = decidirReembolso({
        paymentStatus: "paid",
        amount,
        motivo: MOTIVO_COBRO_DE_CITA_CANCELADA,
      });
      assert.equal(d.reembolsar, true, `amount ${amount}`);
      assert.equal(d.importe, 0);
    }
  });

  it("dice que el cobro fue un fallo del CRM, que es lo que queda escrito en Stripe", () => {
    const d = decidirReembolso({
      paymentStatus: "paid",
      amount: 6000,
      motivo: MOTIVO_COBRO_DE_CITA_CANCELADA,
    });
    assert.match(d.motivo, /ya estaba cancelada/);
    assert.match(d.motivo, /se devuelve entero/);
  });

  it("da igual quién conste como cancelador: manda el motivo", () => {
    for (const quienCancela of ["cliente", "profesional", "no_show", undefined]) {
      const d = decidirReembolso({
        quienCancela,
        paymentStatus: "paid",
        amount: 6000,
        motivo: MOTIVO_COBRO_DE_CITA_CANCELADA,
      });
      assert.equal(d.reembolsar, true, `cancela ${quienCancela}`);
    }
  });
});

describe("sin un cobro capturado no hay nada que devolver, ni con la excepción", () => {
  it("el dinero solo RETENIDO no se devuelve: eso se suelta, y lo hace reembolsoCita.js antes de preguntar aquí", () => {
    for (const paymentStatus of ["authorizing", "authorized", "capturing", "failed"]) {
      const d = decidirReembolso({
        paymentStatus,
        amount: 6000,
        motivo: MOTIVO_COBRO_DE_CITA_CANCELADA,
      });
      assert.equal(d.reembolsar, false, `paymentStatus ${paymentStatus}`);
      assert.equal(d.importe, 0);
      assert.match(d.motivo, /no tiene un cobro que devolver/);
    }
  });

  it("una cita gratuita, a medias o ya devuelta tampoco devuelve dos veces", () => {
    for (const paymentStatus of ["none", "pending", "void", "refunded"]) {
      const d = decidirReembolso({
        paymentStatus,
        amount: 6000,
        motivo: MOTIVO_COBRO_DE_CITA_CANCELADA,
      });
      assert.equal(d.reembolsar, false, `paymentStatus ${paymentStatus}`);
    }
  });

  it("sin argumentos no revienta y no devuelve nada", () => {
    assert.equal(decidirReembolso().reembolsar, false);
    assert.equal(decidirReembolso({}).importe, 0);
  });
});
