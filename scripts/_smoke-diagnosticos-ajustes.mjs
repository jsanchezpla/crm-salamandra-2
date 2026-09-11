// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-diagnosticos-ajustes.mjs — los productos de diagnóstico tal como se
 * editan en Configuración → Módulos (12/09/2026).
 *
 *   node --test scripts/_smoke-diagnosticos-ajustes.mjs
 *
 * Fija `lib/clinica/diagnosticosAjustes.js`:
 *   · qué se guarda a partir de lo que manda la tarjeta: `[]` quita la lista
 *     (vuelta a fábrica), una lista con algo válido se guarda limpia, y una
 *     lista sin nada válido NO se guarda y devuelve la frase;
 *   · el resumen que ve dirección en la auditoría;
 *   · la clave que se propone para un producto nuevo a partir de su nombre;
 *   · qué le pasa a cada fila del formulario antes de guardar, y el viaje
 *     ida y vuelta formulario ↔ productos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  productosParaGuardar,
  resumenDeProductos,
  claveDesdeNombre,
  problemasDeProductos,
  productosDesdeFormulario,
  formularioDeProductos,
  PROBLEMA_SIN_PRODUCTOS,
} from "../lib/clinica/diagnosticosAjustes.js";
import { PRODUCTOS_DE_FABRICA } from "../lib/clinica/diagnostico.js";

const UUID = "5eef78c6-e17d-4cd0-b3c7-8066edec4638";

describe("productosParaGuardar", () => {
  it("una lista vacía quita la guardada: valor null y sin problema", () => {
    assert.deepEqual(productosParaGuardar([]), { valor: null, problema: null });
  });

  it("lo que no es lista no se guarda", () => {
    assert.equal(productosParaGuardar("simple").valor, undefined);
    assert.match(productosParaGuardar(null).problema, /lista/);
  });

  it("guarda los válidos como objetos planos y descarta los que no valen", () => {
    const { valor, problema } = productosParaGuardar([
      { key: "Simple", nombre: " Diagnóstico simple ", horas: 12, conceptId: UUID, precioEuros: "400" },
      { key: "", nombre: "sin clave", horas: 5 },
      { key: "completo", nombre: "Diagnóstico completo", horas: 0 },
    ]);
    assert.equal(problema, null);
    assert.deepEqual(valor, [
      { key: "simple", nombre: "Diagnóstico simple", horas: 12, conceptId: UUID, precioEuros: 400 },
    ]);
    assert.ok(!Object.isFrozen(valor[0]), "va al JSONB: sin congelar");
  });

  it("sin ningún producto válido no guarda nada y lo dice", () => {
    const r = productosParaGuardar([{ key: "!!", nombre: "x", horas: 1 }]);
    assert.equal(r.valor, undefined);
    assert.equal(r.problema, PROBLEMA_SIN_PRODUCTOS);
  });

  it("los de fábrica se pueden guardar tal cual (no se confunden con «nada válido»)", () => {
    const r = productosParaGuardar(PRODUCTOS_DE_FABRICA.map((p) => ({ ...p })));
    assert.equal(r.problema, null);
    assert.equal(r.valor.length, 2);
    assert.equal(r.valor[1].horas, 20);
  });
});

describe("resumenDeProductos", () => {
  it("sin lista guardada dice «de fábrica»", () => {
    assert.equal(resumenDeProductos(undefined), "(de fábrica)");
    assert.equal(resumenDeProductos([]), "(de fábrica)");
  });

  it("una línea por producto con sus horas y su precio de caída", () => {
    assert.equal(
      resumenDeProductos([
        { key: "simple", nombre: "S", horas: 10.5, precioEuros: 350 },
        { key: "tdah", nombre: "TDAH", horas: 8 },
      ]),
      "simple: 10,5 h · 350 € · tdah: 8 h"
    );
  });
});

describe("claveDesdeNombre", () => {
  it("quita acentos, pasa a minúsculas y separa con guiones", () => {
    assert.equal(claveDesdeNombre("Diagnóstico TDAH (niños)"), "diagnostico-tdah-ninos");
    assert.equal(claveDesdeNombre("  --Simple--  "), "simple");
    assert.equal(claveDesdeNombre(""), "");
  });
});

describe("problemasDeProductos", () => {
  it("devuelve una lista paralela con null en las filas buenas", () => {
    const problemas = problemasDeProductos([
      { key: "simple", nombre: "Simple", horas: "10", precioEuros: "350" },
      { key: "simple", nombre: "Otra", horas: "10" },
      { key: "mal clave", nombre: "x", horas: "1" },
      { key: "sin-nombre", nombre: "  ", horas: "1" },
      { key: "cero", nombre: "Cero", horas: "0" },
      { key: "cuarto", nombre: "Cuarto", horas: "1,25" },
      { key: "precio", nombre: "Precio", horas: "2", precioEuros: "abc" },
      { key: "coma", nombre: "Coma", horas: "2,5", precioEuros: "" },
    ]);
    assert.equal(problemas[0], null);
    assert.match(problemas[1], /repetida/);
    assert.match(problemas[2], /clave/);
    assert.match(problemas[3], /nombre/);
    assert.match(problemas[4], /0,5 a 200/);
    assert.match(problemas[5], /media en media/);
    assert.match(problemas[6], /precio/);
    assert.equal(problemas[7], null);
  });
});

describe("formulario ↔ productos", () => {
  it("los productos se pintan como texto con coma decimal y vuelven como números", () => {
    const filas = formularioDeProductos([
      { key: "simple", nombre: "Simple", horas: 10.5, conceptId: UUID, precioEuros: 350 },
      { key: "libre", nombre: "Libre", horas: 4, conceptId: null, precioEuros: null },
    ]);
    assert.deepEqual(filas, [
      { key: "simple", nombre: "Simple", horas: "10,5", conceptId: UUID, precioEuros: "350" },
      { key: "libre", nombre: "Libre", horas: "4", conceptId: "", precioEuros: "" },
    ]);
    // El precio en blanco no viaja (ni como null): `productosDe` leería 0 €.
    assert.deepEqual(productosDesdeFormulario(filas), [
      { key: "simple", nombre: "Simple", horas: 10.5, conceptId: UUID, precioEuros: 350 },
      { key: "libre", nombre: "Libre", horas: 4, conceptId: null },
    ]);
    assert.equal("precioEuros" in productosDesdeFormulario(filas)[1], false);
  });
});
