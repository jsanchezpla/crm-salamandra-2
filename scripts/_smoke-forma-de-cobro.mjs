// @prueba ligera — función pura de /lib y una regex sobre las pantallas.
/**
 * _smoke-forma-de-cobro.mjs — un cobro pendiente no tiene forma de pago
 * (18/09/2026, AV-0188 de Aumenta; decidido por Rodrigo).
 *
 *   node scripts/_smoke-forma-de-cobro.mjs
 *
 * Rosa mandó una captura de Cobros con una fila que decía «Transferencia ·
 * Pendiente». Eso se lee como dinero que ya entró por el banco, y no había
 * entrado nada: hasta el 10/09/2026 `method` era obligatorio y el generador de
 * cuotas lo rellenaba con `transfer` para tapar el hueco. En Aumenta quedan 125
 * pendientes arrastrando una forma que nadie eligió.
 *
 * Lo que se fija: que el estado MANDA sobre la columna, y que lo cobrado se
 * sigue rotulando como siempre — que es lo que no se puede romper, porque de
 * ahí salen el arqueo y el resumen de caja.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formaDeCobro, esSinForma, SIN_FORMA, FORMAS_DE_COBRO, OPCIONES_DE_COBRO } from "../lib/billing/formaDeCobro.js";

describe("un cobro pendiente no dice por dónde entró el dinero", () => {
  it("aunque la columna diga «transfer», que es el caso de la captura", () => {
    assert.equal(formaDeCobro({ status: "pending", method: "transfer" }), SIN_FORMA);
    assert.equal(formaDeCobro({ status: "pending", method: "card" }), SIN_FORMA);
    assert.equal(formaDeCobro({ status: "pending", method: null }), SIN_FORMA);
  });

  it("y se llama «Ninguno», que es como lo pidió Rodrigo", () => {
    assert.equal(SIN_FORMA, "Ninguno");
    assert.equal(esSinForma(formaDeCobro({ status: "pending", method: "transfer" })), true);
  });
});

describe("lo cobrado se rotula como siempre", () => {
  it("cada forma con su nombre", () => {
    assert.equal(formaDeCobro({ status: "completed", method: "transfer" }), "Transferencia");
    assert.equal(formaDeCobro({ status: "completed", method: "cash" }), "Efectivo");
    assert.equal(formaDeCobro({ status: "completed", method: "card" }), "Tarjeta");
    assert.equal(formaDeCobro({ status: "completed", method: "direct_debit" }), "Domiciliación");
  });

  it("un devuelto también: el dinero entró y salió, pero entró por algún sitio", () => {
    assert.equal(formaDeCobro({ status: "refunded", method: "cash" }), "Efectivo");
  });

  it("y lo que no se entiende no se inventa", () => {
    assert.equal(formaDeCobro({ status: "completed", method: null }), SIN_FORMA);
    assert.equal(formaDeCobro({ status: "completed", method: "bizum" }), "bizum");
    assert.equal(formaDeCobro(null), SIN_FORMA);
    assert.equal(formaDeCobro(undefined), SIN_FORMA);
  });
});

describe("las pantallas leen la regla y no su propia copia", () => {
  const lee = (r) => readFileSync(new URL(r, import.meta.url), "utf8");

  it("las cuatro formas siguen en el desplegable, en su orden", () => {
    assert.deepEqual(OPCIONES_DE_COBRO.map((o) => o.value), Object.keys(FORMAS_DE_COBRO));
    assert.equal(OPCIONES_DE_COBRO.length, 4);
  });

  it("Cobros, las dos fichas y el Excel llaman a `formaDeCobro`", () => {
    for (const ruta of [
      "../app/(dashboard)/facturacion/cobros/page.jsx",
      "../components/billing/ClientPaymentsSection.jsx",
      "../components/billing/PatientBillingSection.jsx",
      // El Excel se baja de la misma pantalla: si dijera «Transferencia» donde
      // la tabla dice «Ninguno», la queja volvería por otra puerta.
      "../app/api/billing/exports/payments/route.js",
    ]) {
      const src = lee(ruta);
      assert.match(src, /formaDeCobro\(/, `${ruta} no usa la regla`);
      // Y ya no llevan su propio mapa escrito a mano.
      assert.doesNotMatch(src, /transfer:\s*"Transferencia"/, `${ruta} conserva su copia del mapa`);
    }
  });
});

/*
 * El aviso que habría evitado el cobro duplicado (18/09/2026, AV-0188,
 * Rodrigo: «avisa de que hay un cobro pendiente al mismo paciente e indica
 * cuál es con un botón para que vayan directamente»).
 *
 * Es pantalla, así que se vigila con una regex sobre el fuente: lo que no
 * puede perderse es que se pregunte por PACIENTE (y no solo por el mes, que es
 * lo que ya había) y que el aviso lleve el botón, porque sin botón hay que
 * buscar el cobro a mano y nadie lo hace.
 */
describe("el aviso de que ese paciente ya debe algo", () => {
  const src = readFileSync(new URL("../app/(dashboard)/facturacion/cobros/page.jsx", import.meta.url), "utf8");

  it("se piden los pendientes de ESE paciente, de cualquier mes", () => {
    assert.match(src, /payments\?status=pending&patientId=/);
    assert.match(src, /pendientesDelPaciente/);
  });

  it("y el aviso lleva un botón que abre ese cobro", () => {
    assert.match(src, /Ir a ese cobro/);
    assert.match(src, /abrirCobroPendiente\(/);
  });

  it("abrir el cobro cierra el alta: dos cajones abiertos no se sabe cuál se guarda", () => {
    const i = src.indexOf("const abrirCobroPendiente");
    assert.notEqual(i, -1);
    assert.match(src.slice(i, i + 400), /setShowForm\(false\)/);
  });
});
