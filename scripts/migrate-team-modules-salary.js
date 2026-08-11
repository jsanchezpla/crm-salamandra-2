/**
 * migrate-team-modules-salary.js
 *
 * Sprint "Equipo — módulos por miembro + retribución".
 * Para cada tenant con el módulo `team` activo (regla #12: leído de
 * master.tenants JOIN tenant_modules en runtime):
 *
 *   1) team_members: + annual_gross NUMERIC(10,2), + payment_periods INTEGER
 *      NOT NULL DEFAULT 12 (CHECK IN (12,14)). Idempotente.
 *   2) Backfill: annual_gross = ROUND(monthly_salary * 12, 2) y payment_periods=12
 *      para los miembros que ya tenían monthly_salary y aún no tienen annual_gross
 *      (decisión: asumir 12 pagas para los existentes; ajustable a mano).
 *   3) CREATE TABLE IF NOT EXISTS team_member_modules (config de módulos por
 *      miembro; SIN gate real este sprint). id lo genera la app (UUIDV4), como
 *      hace db:sync, para no depender de gen_random_uuid() (local PG12).
 *
 * Transacción POR TENANT (cada schema independiente). Idempotente:
 *   ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, CHECK/UNIQUE en DO block.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-team-modules-salary.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-team-modules-salary.js
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function fetchTeamSlugs(s) {
  const [rows] = await s.query(`
    SELECT t.slug FROM master.tenants t
    JOIN master.tenant_modules tm ON tm.tenant_id = t.id
    WHERE t.status = 'active' AND tm.module_key = 'team' AND tm.enabled = TRUE
    ORDER BY t.slug
  `);
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(rows.map((r) => r.slug));
}

async function processSchema(s, schema) {
  const res = { backfilled: 0 };
  await s.transaction(async (t) => {
    // 1) Columnas de retribución en team_members
    await s.query(
      `ALTER TABLE "${schema}"."team_members"
         ADD COLUMN IF NOT EXISTS annual_gross    NUMERIC(10,2),
         ADD COLUMN IF NOT EXISTS payment_periods INTEGER NOT NULL DEFAULT 12`,
      { transaction: t }
    );
    // CHECK (12,14) idempotente
    await s.query(
      `DO $$ BEGIN
         ALTER TABLE "${schema}"."team_members"
           ADD CONSTRAINT team_members_payment_periods_chk CHECK (payment_periods IN (12,14));
       EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      { transaction: t }
    );

    // 2) Backfill annual_gross = monthly_salary * 12 (12 pagas) para existentes
    const [upd] = await s.query(
      `UPDATE "${schema}"."team_members"
         SET annual_gross = ROUND(monthly_salary * 12, 2), payment_periods = 12
       WHERE monthly_salary IS NOT NULL AND annual_gross IS NULL
       RETURNING id`,
      { transaction: t }
    );
    res.backfilled = upd.length;

    // 3) Tabla team_member_modules (id lo pone la app; sin DEFAULT de BD)
    await s.query(
      `CREATE TABLE IF NOT EXISTS "${schema}"."team_member_modules" (
         id             UUID PRIMARY KEY,
         team_member_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE,
         module_key     VARCHAR(64) NOT NULL,
         enabled        BOOLEAN NOT NULL DEFAULT FALSE,
         created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CONSTRAINT team_member_modules_uq UNIQUE (team_member_id, module_key)
       )`,
      { transaction: t }
    );
    await s.query(
      `CREATE INDEX IF NOT EXISTS team_member_modules_team_member_idx
         ON "${schema}"."team_member_modules" (team_member_id)`,
      { transaction: t }
    );
  });
  return res;
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: Equipo — módulos por miembro + retribución\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Tenants con módulo `team` activo...");
  const slugs = await fetchTeamSlugs(s);
  if (slugs.length === 0) {
    log("· Ninguno. Nada que hacer.");
    await s.close();
    process.exit(0);
  }
  log(`✓ ${slugs.length}: ${slugs.join(", ")}`);

  for (const slug of slugs) {
    const schema = `crm_${slug}`;
    try {
      const { backfilled } = await processSchema(s, schema);
      log(`✓ ${schema}: columnas + team_member_modules listos (backfill ${backfilled} salarios)`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
