// @prueba ligera — funciones puras de /scripts con un doble de Sequelize.
/**
 * _smoke-schema-targets.mjs — sobre qué schemas actúa una migración
 * (04/09/2026).
 *
 *   node scripts/_smoke-schema-targets.mjs
 *   node --test-name-pattern="ONLY_SCHEMAS" scripts/_smoke-schema-targets.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * `scripts/_schema-targets.js` decide a qué schemas escriben las 87 migraciones
 * que usan `byTable` y las 21 que usan `byModule`, y no tenía ninguna prueba:
 * la única red era leerlo.
 *
 * El 04/09/2026, al activar Documentos en `salamandra_solutions`, 1 de las 79
 * migraciones del alta falló con `relation "crm_salamandra_solutions.incidencias"
 * does not exist`, y `enable-module.js` terminó con «✗ El módulo quedó
 * HABILITADO pero las migraciones fallaron. El schema puede estar incompleto».
 * El aviso es falso y el módulo estaba bien: lo que pasaba es que
 * `ensure-tenant-schema.js` acota cada alta con `ONLY_SCHEMAS`, y
 * `applyEnvOverrides` devolvía esa lista TAL CUAL, saltándose la única pregunta
 * que hace `byTable` — ¿tiene ese schema la tabla?
 *
 * No era un fallo de esa migración: le pasaba a cualquier migración aditiva
 * sobre una tabla que el tenant no tuviera, y sale en TODA alta de módulo o de
 * cliente nuevo. Esta prueba fija que los dos filtros se aplican los dos, y
 * también lo que NO cambia: que `byModule` sigue obedeciendo a ONLY_SCHEMAS a
 * secas, porque crear las tablas de un módulo recién comprado es su trabajo.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { byTable, byModule, tableExists, slugDeSchema } from "./_schema-targets.js";

// ── Doble de Sequelize ──────────────────────────────────────────────────────
// Solo entiende las tres consultas que hace el módulo. Devuelve `[rows]` como
// `sequelize.query`, para que el código bajo prueba no note la diferencia.
function fakeSequelize({ slugs, tablasPorSchema, schemasExistentes }) {
  return {
    consultas: [],
    async query(sql, opts = {}) {
      this.consultas.push(sql);
      if (sql.includes("FROM master.tenants t")) {
        // byModule: tenants con el módulo. El doble devuelve todos los slugs.
        return [slugs.map((slug) => ({ slug }))];
      }
      if (sql.includes("SELECT slug FROM master.tenants")) {
        return [slugs.map((slug) => ({ slug }))];
      }
      if (sql.includes("information_schema.tables")) {
        const { schema, table } = opts.replacements;
        return [(tablasPorSchema[schema] ?? []).includes(table) ? [{ "?column?": 1 }] : []];
      }
      if (sql.includes("information_schema.schemata")) {
        const { schema } = opts.replacements;
        return [schemasExistentes.includes(schema) ? [{ "?column?": 1 }] : []];
      }
      throw new Error("consulta inesperada en la prueba: " + sql.slice(0, 60));
    },
  };
}

// Un mundo pequeño: dos tenants normales y uno pelado, como salamandra_solutions.
const MUNDO = {
  slugs: ["aumenta", "pelado"],
  tablasPorSchema: {
    crm_aumenta: ["incidencias", "documents", "bookings"],
    crm_pelado: ["documents"], // NO tiene incidencias: ese es el caso del incidente
  },
  schemasExistentes: ["crm_aumenta", "crm_pelado"],
};

const s = () => fakeSequelize(MUNDO);

const ENV_ORIGINAL = { ONLY: process.env.ONLY_SCHEMAS, EXTRA: process.env.EXTRA_SCHEMAS };
beforeEach(() => {
  delete process.env.ONLY_SCHEMAS;
  delete process.env.EXTRA_SCHEMAS;
});
afterEach(() => {
  if (ENV_ORIGINAL.ONLY === undefined) delete process.env.ONLY_SCHEMAS;
  else process.env.ONLY_SCHEMAS = ENV_ORIGINAL.ONLY;
  if (ENV_ORIGINAL.EXTRA === undefined) delete process.env.EXTRA_SCHEMAS;
  else process.env.EXTRA_SCHEMAS = ENV_ORIGINAL.EXTRA;
});

describe("byTable sin acotar", () => {
  test("solo entran los schemas que tienen la tabla", async () => {
    const r = await byTable(s(), "incidencias");
    assert.deepEqual(r.schemas, ["crm_aumenta"]);
    assert.deepEqual(r.skipped, ["crm_pelado"]);
    assert.equal(r.exclusive, false);
  });

  test("una tabla que tienen todos los devuelve todos", async () => {
    const r = await byTable(s(), "documents");
    assert.deepEqual(r.schemas.sort(), ["crm_aumenta", "crm_pelado"]);
    assert.deepEqual(r.skipped, []);
  });
});

describe("byTable con ONLY_SCHEMAS: acota, pero no exime", () => {
  test("EL INCIDENTE: un schema pedido SIN la tabla se salta, no revienta", async () => {
    process.env.ONLY_SCHEMAS = "crm_pelado";
    const r = await byTable(s(), "incidencias");
    // Antes del 04/09/2026 esto devolvía ["crm_pelado"] y la migración moría
    // con 42P01 en cuanto hacía ALTER TABLE.
    assert.deepEqual(r.schemas, [], "un schema sin la tabla no puede entrar");
    assert.deepEqual(r.skipped, ["crm_pelado"], "y tiene que decirse, no desaparecer");
    assert.equal(r.exclusive, true);
  });

  test("un schema pedido CON la tabla sí entra", async () => {
    process.env.ONLY_SCHEMAS = "crm_aumenta";
    const r = await byTable(s(), "incidencias");
    assert.deepEqual(r.schemas, ["crm_aumenta"]);
    assert.deepEqual(r.skipped, []);
  });

  test("pedir varios reparte cada uno a su lado", async () => {
    process.env.ONLY_SCHEMAS = "crm_aumenta,crm_pelado";
    const r = await byTable(s(), "incidencias");
    assert.deepEqual(r.schemas, ["crm_aumenta"]);
    assert.deepEqual(r.skipped, ["crm_pelado"]);
  });

  test("sigue acotando: no se cuela un schema que NO se ha pedido", async () => {
    process.env.ONLY_SCHEMAS = "crm_pelado";
    const r = await byTable(s(), "documents");
    assert.deepEqual(r.schemas, ["crm_pelado"], "aumenta tiene la tabla pero no se pidió");
  });
});

describe("byModule no cambia", () => {
  test("ONLY_SCHEMAS manda sola: crear las tablas del módulo es su trabajo", async () => {
    process.env.ONLY_SCHEMAS = "crm_pelado";
    const r = await byModule(s(), "clinica");
    assert.deepEqual(r.schemas, ["crm_pelado"], "aunque aún no tenga ninguna tabla del módulo");
    assert.equal(r.exclusive, true);
  });
});

describe("EXTRA_SCHEMAS y utilidades", () => {
  test("EXTRA_SCHEMAS añade sin quitar", async () => {
    process.env.EXTRA_SCHEMAS = "crm_staging";
    const r = await byTable(s(), "incidencias");
    assert.ok(r.schemas.includes("crm_aumenta"));
    assert.ok(r.schemas.includes("crm_staging"));
  });

  test("tableExists contesta lo que hay", async () => {
    assert.equal(await tableExists(s(), "crm_aumenta", "incidencias"), true);
    assert.equal(await tableExists(s(), "crm_pelado", "incidencias"), false);
  });

  test("slugDeSchema entiende los dorados", () => {
    assert.equal(slugDeSchema("crm_aumenta"), "aumenta");
    assert.equal(slugDeSchema("crm_demo_golden"), "demo");
    assert.equal(slugDeSchema("crm_demo"), "demo");
  });
});
