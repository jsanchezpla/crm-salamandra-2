// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-formato-de-serie.mjs — el número de una serie se escribe con su
 * formato, y el CRM sabe seguir la numeración de otro programa (12/09/2026).
 *
 *   node scripts/_smoke-formato-de-serie.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Aumenta emitió sus tres primeras facturas en el CRM como F-2026-0001..0003
 * mientras las 14.274 de Organízate iban C2200001..C2602245. Las anularon
 * («no puede haber numeraciones distintas»). Desde hoy la serie guarda su
 * formato y el contador nunca se pone delante de lo que ya existe.
 *
 * Lo que fija esta prueba:
 *   · sin formato guardado, TODO sigue igual: `F-2026-0001`;
 *   · el formato de Organízate escribe `C2602246` y `R-C2600029`;
 *   · la expresión que reconoce los números de una serie y un año casa con los
 *     suyos, no con los de la otra serie, y saca el correlativo entero
 *     (en `C2602245` los dígitos del año y del número van pegados);
 *   · qué formatos se aceptan y cuáles no.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FORMATO_POR_DEFECTO,
  esFormatoValido,
  formatoDeSerie,
  numeroDeSerie,
  regexDeSerie,
  correlativoDe,
  ejemploDeSerie,
} from "../lib/billing/formatoDeSerie.js";

const F = { code: "F", prefix: "F", year: 2026, nextNumber: 4 };
const C = { code: "F", prefix: "C", year: 2026, nextNumber: 2246, numberFormat: "{prefix}{yy}{n:5}" };
const RC = { code: "R", prefix: "R-C", year: 2026, nextNumber: 29, number_format: "{prefix}{yy}{n:5}" };

describe("sin formato guardado, la serie escribe como siempre", () => {
  it("F-2026-0001, con cuatro cifras", () => {
    assert.equal(formatoDeSerie(F), FORMATO_POR_DEFECTO);
    assert.equal(numeroDeSerie(F, { year: 2026, n: 1 }), "F-2026-0001");
    assert.equal(numeroDeSerie(F, { year: 2026, n: 12345 }), "F-2026-12345");
  });
  it("un formato guardado que no vale se ignora y se escribe como siempre", () => {
    assert.equal(numeroDeSerie({ ...F, numberFormat: "sin ficha de número" }, { year: 2026, n: 7 }), "F-2026-0007");
  });
  it("reconoce F-2026-0003 y no R-2026-0003 ni F-2025-0003", () => {
    assert.equal(correlativoDe(F, 2026, "F-2026-0003"), 3);
    assert.equal(correlativoDe(F, 2026, "R-2026-0003"), null);
    assert.equal(correlativoDe(F, 2026, "F-2025-0003"), null);
    assert.equal(correlativoDe(F, 2026, "C2602245"), null);
  });
});

describe("la numeración de Organízate", () => {
  it("escribe C2602246 y R-C2600029", () => {
    assert.equal(numeroDeSerie(C, { year: 2026, n: 2246 }), "C2602246");
    assert.equal(numeroDeSerie(RC, { year: 2026, n: 29 }), "R-C2600029");
    assert.equal(numeroDeSerie(C, { year: 2027, n: 1 }), "C2700001");
  });
  it("la expresión de cada serie casa con los suyos y saca el correlativo entero", () => {
    assert.equal(regexDeSerie(C, 2026).source, "^C26([0-9]{5,})$");
    assert.equal(regexDeSerie(RC, 2026).source, "^R-C26([0-9]{5,})$");
    assert.equal(correlativoDe(C, 2026, "C2602245"), 2245);
    assert.equal(correlativoDe(C, 2026, "R-C2600028"), null, "la rectificativa no es de la serie normal");
    assert.equal(correlativoDe(RC, 2026, "R-C2600028"), 28);
    assert.equal(correlativoDe(RC, 2026, "C2602245"), null);
    assert.equal(correlativoDe(C, 2026, "C2502245"), null, "otro año");
    assert.equal(correlativoDe(C, 2026, "F-2026-0001"), null, "la numeración vieja del CRM no cuenta");
  });
  it("si el correlativo desborda el relleno, no se recorta", () => {
    assert.equal(numeroDeSerie(C, { year: 2026, n: 123456 }), "C26123456");
    assert.equal(correlativoDe(C, 2026, "C26123456"), 123456);
  });
  it("el ejemplo de Configuración es el próximo número tal y como está la serie", () => {
    assert.equal(ejemploDeSerie(C), "C2602246");
    assert.equal(ejemploDeSerie(RC), "R-C2600029");
    assert.equal(ejemploDeSerie(F), "F-2026-0004");
  });
});

describe("qué formatos se aceptan", () => {
  it("los que llevan una sola {n} y fichas conocidas", () => {
    for (const f of ["{prefix}-{year}-{n:4}", "{prefix}{yy}{n:5}", "{n}", "{yy}/{prefix}/{n:3}", "{prefix}{n:6}"]) {
      assert.equal(esFormatoValido(f), true, f);
    }
  });
  it("ni sin {n}, ni con dos, ni con fichas desconocidas, ni llaves sueltas, ni de más de 40", () => {
    for (const f of ["", "   ", "{prefix}-{year}", "{n}{n}", "{prefix}-{mes}-{n}", "{prefix}-{n", "F-{n:100}", "x".repeat(38) + "{n}"]) {
      assert.equal(esFormatoValido(f), false, JSON.stringify(f));
    }
  });
  it("un literal con signos de regex se escapa", () => {
    const S = { prefix: "F.", numberFormat: "{prefix}({year})+{n:2}" };
    assert.equal(numeroDeSerie(S, { year: 2026, n: 5 }), "F.(2026)+05");
    assert.equal(correlativoDe(S, 2026, "F.(2026)+05"), 5);
    assert.equal(correlativoDe(S, 2026, "FX(2026)+05"), null);
  });
});
