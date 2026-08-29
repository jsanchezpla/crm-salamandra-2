/**
 * _schema-targets.js — helper compartido para decidir SOBRE QUÉ SCHEMAS actúa
 * una migración.
 *
 * Nace del incidente del 2026-07-21: las migraciones elegían los schemas
 * preguntando "¿qué tenants tienen el módulo X?". Un tenant que ya tenía la
 * tabla creada por un `db:sync` anterior pero aún no había comprado el módulo se
 * quedaba sin las columnas nuevas; al activarlo más tarde, toda lectura
 * reventaba con 42703 (fue el bug de las reservas de tunutrilaura.com).
 *
 * Dos modos, según lo que haga la migración:
 *
 *   byTable(s, "bookings")     → todo tenant cuyo schema TENGA esa tabla.
 *                                Para migraciones ADITIVAS (ADD COLUMN, índices,
 *                                FKs, ALTER TYPE): si la tabla está, se blinda,
 *                                haya comprado el módulo o no.
 *
 *   byModule(s, "clinica")     → tenants con ese módulo activo. Para migraciones
 *                                que CREAN las tablas de un módulo: no tiene
 *                                sentido crear las 8 tablas de Clínica en un
 *                                tenant que no la ha comprado. Estas dependen de
 *                                `ensure-tenant-schema.js`, que las relanza
 *                                cuando el módulo se activa.
 *
 * ── UN CLIENTE APAGADO TAMBIÉN SE MIGRA (12/08/2026) ────────────────────────
 * Los dos modos filtraban por `status = 'active'`, y eso dejaba a los
 * SUSPENDIDOS congelados en el schema del día que se apagaron. En silencio: como
 * suspender apaga de verdad al cliente (sus usuarios no pueden entrar y sus
 * widgets públicos no responden), nadie choca con nada… hasta que se reactiva.
 * Ese día vuelve a estar vivo con el schema N migraciones por detrás, y lo que
 * se lleva el golpe es la primera pantalla que lea una columna que no existe,
 * con un 500 genérico.
 *
 * Se vio en producción el 12/08/2026: `quality_energy` llevaba 22 columnas de
 * retraso en 7 tablas y `abarcaia` 20 en 6, mientras los siete activos estaban
 * al día. Es exactamente el incidente del 2026-07-21 de aquí arriba, con otro
 * disfraz: elegir los schemas por una condición de NEGOCIO en vez de por lo que
 * hay en la base de datos.
 *
 * Por eso ya no se mira el estado en ninguno de los dos modos: el estado decide
 * quién PUEDE ENTRAR, no qué FORMA tiene su schema. Un schema que existe se
 * mantiene al día, y punto.
 *
 * ── LAS FOTOS DORADAS TAMBIÉN SE MIGRAN (29/08/2026, Rodrigo) ───────────────
 * `crm_{demo}_golden` estuvo fuera («no es un tenant de master») y el precio
 * fueron TRES pasadas manuales en dos días (26–27/08): cada migración que
 * añadía columnas dejaba las fotos atrás, el aviso del deploy saltaba y había
 * que rehacerlas a mano. Rehacerlas, además, congela lo que haya en la demo EN
 * ESE MOMENTO —incluido lo que acabe de ensuciar un visitante—, así que el
 * remedio manual tenía su propio riesgo.
 *
 * Ahora los dos modos incluyen los schemas dorados de las demos: la migración
 * les añade las mismas columnas (y los mismos backfills) que al schema vivo, y
 * la foto no se queda atrás nunca. Rehacer la foto queda SOLO para cuando
 * cambian los DATOS a propósito (seeds nuevos, rebuild del escaparate).
 *
 * OJO si tu migración deriva el slug del nombre del schema: usa slugDeSchema()
 * de aquí abajo, no `schema.replace(/^crm_/, "")` — con los dorados esa cuenta
 * sale «demo_golden», que no es ningún tenant.
 *
 * Ambos respetan las variables de entorno que ya usaba Jorge en
 * migrate-nutricion-recipes.js:
 *   ONLY_SCHEMAS=crm_a,crm_b   modo EXCLUSIVO: ignora la lista calculada
 *                              (y entonces los dorados tampoco se añaden solos).
 *   EXTRA_SCHEMAS=crm_staging  modo ADITIVO: añade schemas a la lista.
 *
 * Devuelven siempre nombres de schema completos (`crm_<slug>`), sin duplicados.
 */

import { DEMO_SLUGS, schemaDorado } from "../lib/demo/demos.js";

function envList(name) {
  return (process.env[name] || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function applyEnvOverrides(schemas) {
  const only = envList("ONLY_SCHEMAS");
  if (only.length) return { schemas: only, exclusive: true };
  const extra = envList("EXTRA_SCHEMAS");
  return { schemas: [...new Set([...schemas, ...extra])], exclusive: false };
}

/** Slugs de TODOS los tenants, activos o no (ver la cabecera del fichero). */
async function tenantSlugs(s) {
  const [rows] = await s.query(`SELECT slug FROM master.tenants ORDER BY slug`);
  return rows.map((r) => r.slug);
}

/** ¿Existe el schema? (las fotos doradas no salen de master.tenants) */
async function schemaExists(s, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = :schema`,
    { replacements: { schema } }
  );
  return rows.length > 0;
}

/**
 * El slug de un schema, entendiendo también los dorados:
 * `crm_demo` → `demo`, `crm_demo_golden` → `demo`. Para las migraciones que
 * consultan master (módulos, settings) por el slug del schema que recorren.
 */
export function slugDeSchema(schema) {
  const sinPrefijo = String(schema).replace(/^crm_/, "");
  const sinDorado = sinPrefijo.replace(/_golden$/, "");
  return DEMO_SLUGS.includes(sinDorado) ? sinDorado : sinPrefijo;
}

/**
 * Los schemas dorados que deben acompañar a los vivos de `vivos`
 * (`condicion` decide si un dorado concreto entra: tiene la tabla, existe…).
 */
async function doradosQueAcompanan(vivos, condicion) {
  const dorados = [];
  for (const slug of DEMO_SLUGS) {
    if (!vivos.includes(`crm_${slug}`)) continue;
    const golden = schemaDorado(slug);
    if (await condicion(golden)) dorados.push(golden);
  }
  return dorados;
}

/** ¿Existe la tabla en ese schema? */
export async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = :schema AND table_name = :table`,
    { replacements: { schema, table } }
  );
  return rows.length > 0;
}

/**
 * Schemas que TIENEN la tabla indicada, sea cual sea el estado del tenant.
 * @returns {Promise<{schemas: string[], skipped: string[], exclusive: boolean}>}
 */
export async function byTable(s, table) {
  const slugs = await tenantSlugs(s);
  const withTable = [];
  const skipped = [];
  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    if (await tableExists(s, schema, table)) withTable.push(schema);
    else skipped.push(schema);
  }
  // Las fotos doradas de las demos van detrás de su vivo: misma tabla, mismas
  // columnas nuevas. Si la foto no tiene la tabla, no hay nada que blindar (el
  // restore ya tolera tablas que le falten y el deploy avisa de la deriva).
  withTable.push(...(await doradosQueAcompanan(withTable, (g) => tableExists(s, g, table))));
  const { schemas, exclusive } = applyEnvOverrides(withTable);
  return { schemas, skipped: exclusive ? [] : skipped, exclusive };
}

/**
 * Schemas de tenants con ese módulo (o alguno de esos módulos) CONTRATADO.
 * El estado del tenant no entra: lo que decide es el módulo.
 * @param {string|string[]} moduleKeys
 */
export async function byModule(s, moduleKeys) {
  const keys = Array.isArray(moduleKeys) ? moduleKeys : [moduleKeys];
  const [rows] = await s.query(
    `SELECT DISTINCT t.slug FROM master.tenants t
       JOIN master.tenant_modules tm ON tm.tenant_id = t.id
      WHERE tm.enabled = TRUE AND tm.module_key IN (:keys)
      ORDER BY t.slug`,
    { replacements: { keys } }
  );
  const base = rows.map((r) => `crm_${r.slug}`);
  // Si una demo tiene el módulo, su foto dorada recibe las mismas tablas: si
  // no, la siguiente migración byTable las encontraría solo en el vivo.
  base.push(...(await doradosQueAcompanan(base, (g) => schemaExists(s, g))));
  const { schemas, exclusive } = applyEnvOverrides(base);
  return { schemas, skipped: [], exclusive };
}
