/**
 * migrate-patients-multi-per-client.js — permite que UN cliente pagador tenga
 * VARIOS pacientes (p. ej. Pedro paga y asisten Juan y María).
 *
 * CONTEXTO: el sprint "Clientes ↔ módulos" añadió un índice ÚNICO parcial
 * `patients_client_unique` sobre `patients(client_id)` heredado del diseño viejo
 * (1 cliente = 1 paciente auto-materializado). Ese diseño se abandonó: ahora el
 * paciente se crea SIEMPRE explícito desde la ficha del cliente y un cliente
 * puede tener varios pacientes (ver lib/clients/moduleAssignments.js:46-51 y el
 * comentario de Booking.patientId). El índice único quedó como residuo y BLOQUEA
 * el segundo paciente (viola unicidad, error 23505).
 *
 * Para CADA tenant con tabla `patients` (lista de master.tenants en runtime —
 * regla #12), de forma idempotente y NO destructiva con los datos:
 *   - DROP INDEX `patients_client_unique` si existe (quita el candado 1:1).
 *   - CREATE INDEX no-único `patients_client_idx` sobre (client_id) si no existe
 *     (se mantiene la búsqueda rápida de "pacientes de un cliente").
 *
 * Solo toca índices, nunca filas. Re-ejecutable sin efecto. Es FORWARD-COMPATIBLE:
 * el código actual ya espera varios pacientes por cliente, así que puede correrse
 * antes o después de deploy.sh (recomendado antes, junto al resto de migraciones).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-patients-multi-per-client.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-patients-multi-per-client.js
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function schemaExists(s, schema) {
  const [rows] = await s.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, { bind: [schema] });
  return rows.length > 0;
}
async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}
async function indexExists(s, schema, indexName) {
  const [rows] = await s.query(`SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, {
    bind: [schema, indexName],
  });
  return rows.length > 0;
}

async function fetchSlugs(s) {
  const [rows] = await s.query(`
    SELECT DISTINCT t.slug FROM master.tenants t ORDER BY t.slug
  `);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

async function processSchema(s, schema) {
  if (!(await tableExists(s, schema, "patients"))) {
    log(`· ${schema}: sin tabla patients — se omite`);
    return;
  }
  await s.transaction(async (t) => {
    if (await indexExists(s, schema, "patients_client_unique")) {
      await s.query(`DROP INDEX "${schema}"."patients_client_unique"`, { transaction: t });
      log(`✓ ${schema}: índice único patients_client_unique ELIMINADO (candado 1:1 quitado)`);
    } else {
      log(`· ${schema}: patients_client_unique ya no existe`);
    }
    if (!(await indexExists(s, schema, "patients_client_idx"))) {
      await s.query(
        `CREATE INDEX "patients_client_idx" ON "${schema}"."patients" (client_id) WHERE client_id IS NOT NULL`,
        { transaction: t }
      );
      log(`✓ ${schema}: índice de búsqueda patients_client_idx creado (no único)`);
    } else {
      log(`· ${schema}: patients_client_idx ya existe`);
    }
  });
  log(`✓ ${schema}: listo — un cliente ya puede tener varios pacientes`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: varios pacientes por cliente (quita candado 1:1)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const slugs = await fetchSlugs(s);
  log(`✓ ${slugs.length} tenants activos: ${slugs.join(", ")}`);

  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    header(`Tenant ${slug} (${schema})`);
    if (!(await schemaExists(s, schema))) {
      log(`✗ schema ${schema} no existe, se salta`);
      continue;
    }
    try {
      await processSchema(s, schema);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
