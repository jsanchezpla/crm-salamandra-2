// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-diagnostico-cobros.mjs — el diagnóstico se cobra POR FASES
 * (18/09/2026, Rodrigo): la entrevista inicial (50 €) y lo que queda del
 * producto (300 € / 600 €).
 *
 *   node --test scripts/_smoke-diagnostico-cobros.mjs
 *
 * Fija `lib/clinica/cobrosDelDiagnostico.js`:
 *   · cuánto vale cada fase y cuándo se puede mandar a cobro;
 *   · que una fase ya apuntada no se vuelve a ofrecer (ni cobrada, ni
 *     pendiente), que es lo que evita cobrar dos veces un diagnóstico;
 *   · que sin permiso no se ofrece ninguna;
 *   · que el descuento de la entrevista es el de siempre
 *     (`cobroDelProducto`): 350 − 50 = 300, 650 − 50 = 600.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FASES,
  esFase,
  estadoDeCobro,
  cobroDeProductoEntre,
  importeDeLaEntrevista,
  fasesDeCobro,
  avisoDeOrden,
  MOTIVO_SIN_PERMISO_COBRO,
} from "../lib/clinica/cobrosDelDiagnostico.js";
import { cobroDelProducto, cobroDeLaEntrevista, PRODUCTOS_DE_FABRICA } from "../lib/clinica/diagnostico.js";

const SIMPLE = PRODUCTOS_DE_FABRICA.find((p) => p.key === "simple");
const COMPLETO = PRODUCTOS_DE_FABRICA.find((p) => p.key === "completo");

/** Un expediente con lo justo para decidir sus fases. */
const expediente = (extra = {}) => ({ id: "d1", status: "en_curso", packId: "p1", productoNombre: "Diagnóstico completo", ...extra });

/** Una fila de `payments`. */
const pago = (extra = {}) => ({ id: "c1", amount: 50, status: "pending", packId: null, ...extra });

describe("las dos fases", () => {
  it("son entrevista y producto, y nada más", () => {
    assert.deepEqual([...FASES], ["entrevista", "producto"]);
    assert.equal(esFase("entrevista"), true);
    assert.equal(esFase("producto"), true);
    assert.equal(esFase("bono"), false);
    assert.equal(esFase(""), false);
  });

  it("estadoDeCobro distingue cobrado, pendiente y devuelto", () => {
    assert.equal(estadoDeCobro(null), null);
    assert.equal(estadoDeCobro(pago({ status: "completed" })), "cobrado");
    assert.equal(estadoDeCobro(pago({ status: "pending" })), "pendiente");
    assert.equal(estadoDeCobro(pago({ status: "completed", refundedAt: "2026-09-18" })), "devuelto");
    assert.equal(estadoDeCobro(pago({ status: "refunded" })), "devuelto");
  });

  it("el cobro del producto es el del bono del expediente, y manda el vivo sobre el devuelto", () => {
    const e = expediente();
    const devuelto = pago({ id: "viejo", packId: "p1", status: "refunded" });
    const vivo = pago({ id: "nuevo", packId: "p1", status: "pending" });
    assert.equal(cobroDeProductoEntre(e, [devuelto, vivo])?.id, "nuevo");
    assert.equal(cobroDeProductoEntre(e, [devuelto])?.id, "viejo");
    // El de la entrevista no lleva bono: no es el del producto.
    assert.equal(cobroDeProductoEntre(e, [pago({ packId: null })]), null);
    assert.equal(cobroDeProductoEntre(expediente({ packId: null }), [vivo]), null);
  });
});

describe("qué se puede mandar a cobro", () => {
  const conProducto = (e, cobros = {}) =>
    fasesDeCobro({
      expediente: e,
      cobroEntrevista: cobros.entrevista ?? null,
      cobroProducto: cobros.producto ?? null,
      importeEntrevista: importeDeLaEntrevista(cobroDeLaEntrevista(null)),
      cobroDelProducto: cobroDelProducto(COMPLETO, null, { descuentoEuros: cobros.entrevista ? Number(cobros.entrevista.amount) : 0 }),
      puedeDecidir: true,
    });

  it("en «entrevista»: la entrevista sí, el producto todavía no (no hay bono)", () => {
    const f = conProducto(expediente({ status: "entrevista", packId: null }));
    assert.equal(f.entrevista.puedeGenerar, true);
    assert.equal(f.entrevista.importe, 50);
    assert.equal(f.producto.puedeGenerar, false);
    assert.match(f.producto.motivo, /Seguir con el diagnóstico/);
  });

  it("en curso y con la entrevista ya cobrada: el producto vale 600 €, no 650", () => {
    const f = conProducto(expediente(), { entrevista: pago({ amount: 50, status: "completed" }) });
    assert.equal(f.entrevista.puedeGenerar, false);
    assert.equal(f.entrevista.estadoCobro, "cobrado");
    assert.equal(f.producto.puedeGenerar, true);
    assert.equal(f.producto.importe, 600);
  });

  it("el simple queda en 300 € con la entrevista descontada", () => {
    const cobro = cobroDelProducto(SIMPLE, null, { descuentoEuros: 50 });
    assert.equal(cobro.importeEuros, 300);
    assert.match(cobro.texto, /descontada la entrevista inicial de 50 €/);
  });

  it("una fase ya apuntada no se vuelve a ofrecer, aunque siga pendiente", () => {
    const f = conProducto(expediente(), { producto: pago({ packId: "p1", status: "pending", amount: 650 }) });
    assert.equal(f.producto.puedeGenerar, false);
    assert.equal(f.producto.estadoCobro, "pendiente");
    assert.match(f.producto.motivo, /ya está pendiente de cobro/);
  });

  it("sin permiso no se ofrece ninguna", () => {
    const f = fasesDeCobro({ expediente: expediente(), puedeDecidir: false, cobroDelProducto: cobroDelProducto(COMPLETO, null) });
    assert.equal(f.entrevista.puedeGenerar, false);
    assert.equal(f.producto.puedeGenerar, false);
    assert.equal(f.entrevista.motivo, MOTIVO_SIN_PERMISO_COBRO);
  });

  it("un expediente cerrado no admite cobros nuevos", () => {
    const f = conProducto(expediente({ status: "cerrado" }));
    assert.equal(f.entrevista.puedeGenerar, false);
    assert.match(f.entrevista.motivo, /«Cerrado»/);
    assert.equal(f.producto.puedeGenerar, false);
  });

  it("parado sin cobro: la entrevista todavía se puede apuntar", () => {
    const f = conProducto(expediente({ status: "no_continua", packId: null }));
    assert.equal(f.entrevista.puedeGenerar, true);
  });
});

describe("el aviso de orden", () => {
  it("avisa cuando se va a seguir sin haber cobrado la entrevista", () => {
    const aviso = avisoDeOrden({ cobroEntrevista: null, cobroDelProducto: cobroDelProducto(COMPLETO, null) });
    assert.match(aviso, /entrevista inicial aún no se ha mandado a cobro/);
  });

  it("calla si la entrevista ya está apuntada o si el producto no vale nada", () => {
    assert.equal(avisoDeOrden({ cobroEntrevista: pago(), cobroDelProducto: cobroDelProducto(COMPLETO, null) }), null);
    assert.equal(avisoDeOrden({ cobroEntrevista: null, cobroDelProducto: { importeEuros: null } }), null);
  });
});
