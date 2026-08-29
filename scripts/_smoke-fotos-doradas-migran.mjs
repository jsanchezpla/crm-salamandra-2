// @prueba ligera
/**
 * _smoke-fotos-doradas-migran.mjs — las migraciones cubren las fotos doradas.
 *
 * Fija la decisión del 29/08/2026 (Rodrigo): byTable y byModule incluyen los
 * schemas dorados de las demos, para que ninguna migración vuelva a dejar las
 * fotos atrás (tres pasadas manuales en dos días, 26–27/08). Prueba lo que
 * DEVUELVEN con una base de datos de mentira: si alguien quita los dorados de
 * la lista, esto falla con nombre y diff.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { byTable, byModule, slugDeSchema } from "./_schema-targets.js";

// Una «base de datos» que contesta a las cuatro consultas del helper.
function fakeDb({ tenants, tablas, schemas, modulos }) {
  return {
    query: async (sql, opts = {}) => {
      const r = opts.replacements ?? {};
      if (sql.includes("master.tenants") && !sql.includes("tenant_modules")) {
        return [tenants.map((slug) => ({ slug }))];
      }
      if (sql.includes("tenant_modules")) {
        return [modulos.map((slug) => ({ slug }))];
      }
      if (sql.includes("information_schema.tables")) {
        return [tablas.has(`${r.schema}.${r.table}`) ? [{ ok: 1 }] : []];
      }
      if (sql.includes("information_schema.schemata")) {
        return [schemas.has(r.schema) ? [{ ok: 1 }] : []];
      }
      throw new Error(`consulta inesperada en la prueba: ${sql}`);
    },
  };
}

const sinOverrides = () => {
  delete process.env.ONLY_SCHEMAS;
  delete process.env.EXTRA_SCHEMAS;
};

test("byTable añade la foto dorada que tiene la tabla, detrás de los vivos", async () => {
  sinOverrides();
  const s = fakeDb({
    tenants: ["aumenta", "demo", "demo_agencia"],
    tablas: new Set([
      "crm_aumenta.team_members",
      "crm_demo.team_members",
      "crm_demo_agencia.team_members",
      "crm_demo_golden.team_members",
      // crm_demo_agencia_golden NO tiene la tabla: no debe entrar
    ]),
    schemas: new Set(),
    modulos: [],
  });
  const { schemas, skipped } = await byTable(s, "team_members");
  assert.deepEqual(schemas, [
    "crm_aumenta",
    "crm_demo",
    "crm_demo_agencia",
    "crm_demo_golden",
  ]);
  assert.deepEqual(skipped, []);
});

test("byModule añade el dorado de la demo que tiene el módulo, si existe", async () => {
  sinOverrides();
  const s = fakeDb({
    tenants: [],
    tablas: new Set(),
    schemas: new Set(["crm_demo_golden"]),
    modulos: ["aumenta", "demo", "demo_nutricion"], // demo_nutricion sin dorado aún
  });
  const { schemas } = await byModule(s, "billing");
  assert.deepEqual(schemas, [
    "crm_aumenta",
    "crm_demo",
    "crm_demo_nutricion",
    "crm_demo_golden",
  ]);
});

test("ONLY_SCHEMAS sigue siendo exclusivo: tampoco añade dorados", async () => {
  sinOverrides();
  process.env.ONLY_SCHEMAS = "crm_staging";
  try {
    const s = fakeDb({
      tenants: ["demo"],
      tablas: new Set(["crm_demo.bookings", "crm_demo_golden.bookings"]),
      schemas: new Set(),
      modulos: [],
    });
    const { schemas, exclusive } = await byTable(s, "bookings");
    assert.equal(exclusive, true);
    assert.deepEqual(schemas, ["crm_staging"]);
  } finally {
    sinOverrides();
  }
});

test("slugDeSchema entiende los dorados y respeta los underscores", () => {
  assert.equal(slugDeSchema("crm_demo_golden"), "demo");
  assert.equal(slugDeSchema("crm_demo_clinica_golden"), "demo_clinica");
  assert.equal(slugDeSchema("crm_demo_clinica"), "demo_clinica");
  assert.equal(slugDeSchema("crm_nutri_laura"), "nutri_laura");
  assert.equal(slugDeSchema("crm_aumenta"), "aumenta");
});
