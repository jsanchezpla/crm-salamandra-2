// @prueba ligera
// Fija lib/clients/camposFiscales.js y su contrato con quien lo usa:
// - cada clave de la lista está en la lista blanca fiscal del PUT de
//   app/api/clients/[id]/route.js (si no, el panel enseñaría un campo que el
//   servidor tira en silencio);
// - la tarjeta de la ficha y el panel de edición usan LA MISMA lista (import),
//   no una copia.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAMPOS_FISCALES } from "../lib/clients/camposFiscales.js";

test("la lista tiene los cinco campos, con clave, rótulo y ejemplo", () => {
  assert.deepEqual(
    CAMPOS_FISCALES.map((c) => c.key),
    ["fiscalName", "fiscalTaxId", "fiscalAddress", "fiscalZip", "fiscalCity"]
  );
  for (const c of CAMPOS_FISCALES) {
    assert.ok(c.label && c.label.trim(), `${c.key} sin rótulo`);
    assert.ok(c.placeholder && c.placeholder.trim(), `${c.key} sin ejemplo`);
  }
});

test("cada clave está en la lista blanca fiscal del PUT de clientes", () => {
  const ruta = new URL("../app/api/clients/[id]/route.js", import.meta.url);
  const codigo = readFileSync(ruta, "utf8");
  for (const c of CAMPOS_FISCALES) {
    assert.ok(codigo.includes(`"${c.key}"`), `el PUT de /api/clients/[id] no acepta ${c.key}`);
  }
});

test("la tarjeta de la ficha y el panel del listado importan la lista, sin copias", () => {
  const tarjeta = readFileSync(new URL("../components/clients/ClientFiscalSection.jsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../app/(dashboard)/clientes/ClientesClient.jsx", import.meta.url), "utf8");
  assert.match(tarjeta, /from ["'].*lib\/clients\/camposFiscales\.js["']/);
  assert.match(panel, /from ["'].*lib\/clients\/camposFiscales\.js["']/);
  // Una copia local de la lista se delataría por redeclarar la clave con label:
  assert.ok(!/key: ["']fiscalName["']/.test(tarjeta), "ClientFiscalSection redeclara la lista en local");
});
