// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-tipo-de-factura.mjs — normales o rectificativas, y el orden por número
 * (14/09/2026, Rodrigo para Aumenta).
 *
 *   node scripts/_smoke-tipo-de-factura.mjs
 *
 * Nace de «cuando las agrupas por número se ponen primero las rectificativas»:
 * `R-C2600029` va detrás de `C2602282` como texto y el primer clic en «Nº» es
 * descendente. Fija `lib/billing/tipoDeFactura.js`: qué cuenta como
 * rectificativa (la serie O el enlace, porque las de Organízate no traen
 * enlace), el `where` de cada botón y que el orden por número pone las
 * normales delante en los dos sentidos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
// Operadores de mentira: la regla solo los pasa de mano, y así no se carga Sequelize.
const Op = { or: Symbol("or"), in: Symbol("in"), notIn: Symbol("notIn"), ne: Symbol("ne") };
import {
  tipoDeFacturaValido,
  codigosRectificativos,
  whereTipoDeFactura,
  esRectificativa,
  ordenPorNumero,
} from "../lib/billing/tipoDeFactura.js";

const SERIES_AUMENTA = [
  { code: "F", kind: "normal", prefix: "C" },
  { code: "R", kind: "rectificative", prefix: "R-C" },
];

describe("qué tipo se pide", () => {
  it("lo desconocido o vacío es «todas», no un filtro inventado", () => {
    assert.equal(tipoDeFacturaValido("normales"), "normales");
    assert.equal(tipoDeFacturaValido("rectificativas"), "rectificativas");
    assert.equal(tipoDeFacturaValido(""), "todas");
    assert.equal(tipoDeFacturaValido("R'; DROP"), "todas");
    assert.equal(tipoDeFacturaValido(undefined), "todas");
  });

  it("los códigos salen del TIPO de la serie, no de la letra", () => {
    assert.deepEqual(codigosRectificativos(SERIES_AUMENTA), ["R"]);
    assert.deepEqual(
      codigosRectificativos([{ code: "F", kind: "normal" }, { code: "AB", kind: "rectificative" }]),
      ["AB"],
    );
  });

  it("sin series dadas de alta vale la R de fábrica", () => {
    assert.deepEqual(codigosRectificativos([]), ["R"]);
    assert.deepEqual(codigosRectificativos(null), ["R"]);
  });
});

describe("el where de cada botón", () => {
  const codigos = ["R"];

  it("«todas» no filtra", () => {
    assert.equal(whereTipoDeFactura({ tipo: "todas", codigos, Op }), null);
  });

  it("«normales» quita la serie rectificativa Y las que apuntan a otra", () => {
    assert.deepEqual(whereTipoDeFactura({ tipo: "normales", codigos, Op }), {
      series: { [Op.notIn]: ["R"] },
      rectifiesInvoiceId: null,
    });
  });

  it("«rectificativas» coge la serie O el enlace", () => {
    assert.deepEqual(whereTipoDeFactura({ tipo: "rectificativas", codigos, Op }), {
      [Op.or]: [{ series: { [Op.in]: ["R"] } }, { rectifiesInvoiceId: { [Op.ne]: null } }],
    });
  });
});

describe("esRectificativa, en memoria", () => {
  it("la de Organízate (serie R, sin enlace) lo es", () => {
    assert.equal(esRectificativa({ series: "R", number: "R-C2600029", rectifiesInvoiceId: null }), true);
  });
  it("la del CRM con enlace lo es aunque la serie fuera otra", () => {
    assert.equal(esRectificativa({ series: "F", rectifiesInvoiceId: "abc" }), true);
  });
  it("una ordinaria no, y nada no revienta", () => {
    assert.equal(esRectificativa({ series: "F", number: "C2602282" }), false);
    assert.equal(esRectificativa(null), false);
  });
  it("las dos mitades del where parten la lista sin dejar ni repetir ninguna", () => {
    const lista = [
      { series: "F" },
      { series: "R" },
      { series: "F", rectifiesInvoiceId: "x" },
      { series: "R", rectifiesInvoiceId: "y" },
    ];
    const r = lista.filter((f) => esRectificativa(f));
    const n = lista.filter((f) => !esRectificativa(f));
    assert.equal(r.length + n.length, lista.length);
    assert.equal(n.length, 1);
  });
});

describe("ordenar por número", () => {
  const literal = (sql) => ({ sql });
  const escape = (v) => `'${String(v).replace(/'/g, "''")}'`;

  it("las normales van delante en DESC — el fallo del encargo", () => {
    const order = ordenPorNumero({ dir: "DESC", codigos: ["R"], literal, escape });
    assert.equal(order[0][1], "ASC");
    assert.match(order[0][0].sql, /IN \('R'\)/);
    assert.deepEqual(order[1], ["number", "DESC"]);
  });

  it("y también en ASC", () => {
    const order = ordenPorNumero({ dir: "asc", codigos: ["R"], literal, escape });
    assert.equal(order[0][1], "ASC");
    assert.deepEqual(order[1], ["number", "ASC"]);
  });

  it("aplicado a filas de verdad, la primera página abre con la última ordinaria", () => {
    const filas = [
      { number: "R-C2600029", series: "R" },
      { number: "C2602282", series: "F" },
      { number: "C2602281", series: "F" },
      { number: "R-C2600028", series: "R" },
    ];
    const ordenadas = [...filas].sort((a, b) => {
      const ga = esRectificativa(a) ? 1 : 0;
      const gb = esRectificativa(b) ? 1 : 0;
      return ga - gb || b.number.localeCompare(a.number);
    });
    assert.deepEqual(
      ordenadas.map((f) => f.number),
      ["C2602282", "C2602281", "R-C2600029", "R-C2600028"],
    );
  });

  it("los códigos se escapan: un código raro no rompe el SQL", () => {
    const order = ordenPorNumero({ dir: "DESC", codigos: ["R'X"], literal, escape });
    assert.match(order[0][0].sql, /IN \('R''X'\)/);
  });
});
