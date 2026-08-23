// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-campos-gasto.mjs — qué campos acepta un gasto y qué importes salen
 * de ellos (20/08/2026).
 *
 *   node scripts/_smoke-campos-gasto.mjs
 *   node --test-name-pattern="proveedor" scripts/_smoke-campos-gasto.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * `costs.supplier_id` existía, el import de la contabilidad de Aumenta lo
 * rellenaba y la ficha del proveedor contaba sus gastos para negarse a
 * borrarlo; pero la lista de campos que dejaban pasar POST y PATCH de
 * /api/billing/costs estaba escrita dos veces y en ninguna de las dos aparecía
 * `supplierId`. Resultado: todo gasto dado de alta desde el CRM nacía sin
 * proveedor y el «cuánto llevamos gastado con este» se quedaba congelado en lo
 * importado, sin que nada avisara.
 *
 * La lista vive ahora en `lib/billing/camposGasto.js`, un solo sitio. Esta
 * prueba fija lo que la función DEVUELVE: qué claves salen, cuáles no salen
 * nunca (los importes calculados) y qué diferencia hay entre «no viene» y
 * «viene vacío», que es justo lo que separa dejar el dato como estaba de
 * borrarlo.
 *
 * ── Y LA OTRA MITAD: LOS IMPORTES ──────────────────────────────────────────
 *
 * Si el cuerpo no puede fijar `taxAmount` ni `total`, alguien tiene que
 * calcularlos. Esa fórmula también estaba copiada dos veces —una en el POST,
 * otra en el PATCH— y ahora vive en `lib/billing/totalesGasto.js`. Lo que sigue
 * fija los cuatro números que devuelve, incluidos los casos raros que llegan de
 * verdad: la base con tres decimales, el importe en cero, el IVA nulo y el
 * texto que no es un número.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { camposGasto, CAMPOS_GASTO } from "../lib/billing/camposGasto.js";
import { computeCostTotals } from "../lib/billing/totalesGasto.js";

const PROVEEDOR = "6f1d0a3c-1111-4b0e-9a2b-0c0d0e0f1122";

describe("camposGasto — el proveedor del gasto", () => {
  it("deja pasar el proveedor elegido", () => {
    assert.equal(camposGasto({ supplierId: PROVEEDOR }).supplierId, PROVEEDOR);
  });

  it("acepta el proveedor junto al resto de campos del alta", () => {
    const campos = camposGasto({
      type: "material",
      category: "variable",
      description: "Folios",
      incurredAt: "2026-08-20",
      supplierId: PROVEEDOR,
    });
    assert.deepEqual(campos, {
      type: "material",
      category: "variable",
      description: "Folios",
      incurredAt: "2026-08-20",
      supplierId: PROVEEDOR,
    });
  });

  it("el desplegable vacío borra el proveedor en vez de intentar guardar una cadena vacía", () => {
    assert.equal(camposGasto({ supplierId: "" }).supplierId, null);
    assert.equal(camposGasto({ supplierId: "   " }).supplierId, null);
    assert.equal(camposGasto({ supplierId: null }).supplierId, null);
  });

  it("recorta los espacios de alrededor del id", () => {
    assert.equal(camposGasto({ supplierId: ` ${PROVEEDOR} ` }).supplierId, PROVEEDOR);
  });

  it("figura en la lista de campos aceptados", () => {
    assert.ok(CAMPOS_GASTO.includes("supplierId"));
  });
});

describe("camposGasto — no viene y viene vacío no son lo mismo", () => {
  it("no inventa una clave que el cuerpo no trae", () => {
    const campos = camposGasto({ description: "Alquiler agosto" });
    assert.deepEqual(Object.keys(campos), ["description"]);
    assert.equal("supplierId" in campos, false);
    assert.equal("clientId" in campos, false);
  });

  it("sí devuelve la clave cuando viene vacía, para poder borrar el dato", () => {
    const campos = camposGasto({ clientId: "", employeeId: "" });
    assert.deepEqual(campos, { clientId: null, employeeId: null });
  });

  it("con un cuerpo que no es un objeto no devuelve nada", () => {
    assert.deepEqual(camposGasto(null), {});
    assert.deepEqual(camposGasto(undefined), {});
    assert.deepEqual(camposGasto("supplierId=1"), {});
  });
});

describe("camposGasto — lo que no se acepta nunca", () => {
  it("no deja que el cuerpo fije el IVA ni el total, que se calculan", () => {
    const campos = camposGasto({ taxBase: 100, vatRate: 21, taxAmount: 0, total: 0 });
    assert.deepEqual(campos, {});
  });

  it("no deja pasar campos que no son del gasto", () => {
    const campos = camposGasto({ id: "otro", createdAt: "2020-01-01", projectId: PROVEEDOR });
    assert.deepEqual(campos, {});
  });
});

describe("camposGasto — normalización del resto de campos", () => {
  it("convierte a booleano el IVA deducible venga como venga", () => {
    assert.equal(camposGasto({ vatDeductible: "on" }).vatDeductible, true);
    assert.equal(camposGasto({ vatDeductible: false }).vatDeductible, false);
    assert.equal(camposGasto({ vatDeductible: null }).vatDeductible, false);
  });

  it("deja el adjunto vacío en nulo y no guarda una cadena vacía", () => {
    assert.equal(camposGasto({ attachmentUrl: "" }).attachmentUrl, null);
    assert.equal(camposGasto({ attachmentUrl: "https://x.test/f.pdf" }).attachmentUrl, "https://x.test/f.pdf");
  });

  it("no toca la descripción ni la fecha, que las valida el endpoint", () => {
    const campos = camposGasto({ description: "  Sueldo abril  ", incurredAt: "2026-04-30" });
    assert.equal(campos.description, "  Sueldo abril  ");
    assert.equal(campos.incurredAt, "2026-04-30");
  });
});

describe("computeCostTotals — base más IVA", () => {
  it("devuelve siempre los cuatro importes, base y tipo incluidos", () => {
    assert.deepEqual(computeCostTotals({ taxBase: 100, vatRate: 21 }), {
      taxBase: 100,
      vatRate: 21,
      taxAmount: 21,
      total: 121,
    });
  });

  it("aplica el tipo que le den, no siempre el 21 %", () => {
    assert.deepEqual(computeCostTotals({ taxBase: 100, vatRate: 4 }), {
      taxBase: 100,
      vatRate: 4,
      taxAmount: 4,
      total: 104,
    });
  });

  it("acepta los importes en texto, que es como los guarda la base", () => {
    assert.deepEqual(computeCostTotals({ taxBase: "1200.50", vatRate: "10.00" }), {
      taxBase: 1200.5,
      vatRate: 10,
      taxAmount: 120.05,
      total: 1320.55,
    });
  });
});

describe("computeCostTotals — el redondeo a céntimos", () => {
  it("redondea el IVA a dos decimales antes de sumarlo", () => {
    assert.deepEqual(computeCostTotals({ taxBase: 19.99, vatRate: 21 }), {
      taxBase: 19.99,
      vatRate: 21,
      taxAmount: 4.2,
      total: 24.19,
    });
  });

  it("redondea también la base, para que el total no arrastre milésimas", () => {
    assert.equal(computeCostTotals({ taxBase: 10.006, vatRate: 0 }).taxBase, 10.01);
    assert.equal(computeCostTotals({ taxBase: 10.004, vatRate: 0 }).total, 10);
  });

  it("un IVA que se queda por debajo de medio céntimo se pierde", () => {
    const totales = computeCostTotals({ taxBase: 0.01, vatRate: 21 });
    assert.equal(totales.taxAmount, 0);
    assert.equal(totales.total, 0.01);
  });
});

describe("computeCostTotals — los ceros y los huecos", () => {
  it("un gasto de 0 € no inventa IVA", () => {
    assert.deepEqual(computeCostTotals({ taxBase: 0, vatRate: 21 }), {
      taxBase: 0,
      vatRate: 21,
      taxAmount: 0,
      total: 0,
    });
  });

  it("sin base ni tipo, todo a cero en vez de reventar", () => {
    assert.deepEqual(computeCostTotals({}), { taxBase: 0, vatRate: 0, taxAmount: 0, total: 0 });
  });

  it("un IVA nulo es 0 %, no el 21 % de fábrica: ese default es del endpoint", () => {
    assert.deepEqual(computeCostTotals({ taxBase: 100, vatRate: null }), {
      taxBase: 100,
      vatRate: 0,
      taxAmount: 0,
      total: 100,
    });
    assert.equal(computeCostTotals({ taxBase: 100 }).vatRate, 0);
  });

  it("un gasto exento sale con el total igual que la base", () => {
    assert.deepEqual(computeCostTotals({ taxBase: 250.4, vatRate: 0 }), {
      taxBase: 250.4,
      vatRate: 0,
      taxAmount: 0,
      total: 250.4,
    });
  });
});

describe("computeCostTotals — lo que no es un número", () => {
  it("una base ilegible NO se convierte en cero euros", () => {
    const totales = computeCostTotals({ taxBase: "diez", vatRate: 21 });
    assert.ok(Number.isNaN(totales.taxBase));
    assert.ok(Number.isNaN(totales.taxAmount));
    assert.ok(Number.isNaN(totales.total));
    assert.equal(totales.vatRate, 21);
  });

  it("un tipo ilegible tampoco: contamina el IVA y el total, no la base", () => {
    const totales = computeCostTotals({ taxBase: 100, vatRate: "veintiuno" });
    assert.equal(totales.taxBase, 100);
    assert.ok(Number.isNaN(totales.vatRate));
    assert.ok(Number.isNaN(totales.taxAmount));
    assert.ok(Number.isNaN(totales.total));
  });
});
