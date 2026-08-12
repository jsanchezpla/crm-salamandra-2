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
 * mantiene al día, y punto. `crm_demo_golden` sigue fuera porque no es un
 * tenant de `master` (su restore ya tolera columnas que le falten: ver
 * `lib/demo/resetDemo.js`).
 *
 * Ambos respetan las variables de entorno que ya usaba Jorge en
 * migrate-nutricion-recipes.js:
 *   ONLY_SCHEMAS=crm_a,crm_b   modo EXCLUSIVO: ignora la lista calculada.
 *   EXTRA_SCHEMAS=crm_staging  modo ADITIVO: añade schemas a la lista.
 *
 * Devuelven siempre nombres de schema completos (`crm_<slug>`), sin duplicados.
 */

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
  const { schemas, exclusive } = applyEnvOverrides(base);
  return { schemas, skipped: [], exclusive };
}
