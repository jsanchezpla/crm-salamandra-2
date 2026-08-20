// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-campos-gasto.mjs — qué campos acepta un gasto (20/08/2026).
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
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { camposGasto, CAMPOS_GASTO } from "../lib/billing/camposGasto.js";

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
