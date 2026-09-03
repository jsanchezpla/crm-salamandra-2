/**
 * migrate-calendario-global.js — la tabla del calendario global (03/09/2026).
 *
 * MASTER, no toca schemas de tenant: crea `master.calendario_global_vinculos`,
 * donde se apunta qué calendarios de cliente ve cada cuenta de Salamandra
 * desde calendar.salamandrasolutions.com (ver
 * models/master/CalendarioGlobalVinculo.model.js).
 *
 * Solo crea la tabla y su índice único; no escribe ni una fila. Los vínculos
 * se dan de alta con `scripts/calendario-global-vincular.js` o desde el
 * back-office. Idempotente.
 *
 * Uso:
 *   npm run db:migrate:calendario-global        (local)
 *   docker exec crm-salamandra-app-1 node scripts/migrate-calendario-global.js   (producción)
 */

import { Sequelize } from "sequelize";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  process.stdout.write("\n▶ Migración: calendario global (master.calendario_global_vinculos)\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  try {
    await s.query(`
      CREATE TABLE IF NOT EXISTS "master"."calendario_global_vinculos" (
        "id"                UUID PRIMARY KEY,
        "usuario_id"        UUID NOT NULL,
        "tenant_id"         UUID NOT NULL,
        "tenant_usuario_id" UUID,
        "color"             VARCHAR(7),
        "orden"             INTEGER NOT NULL DEFAULT 0,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    log("✓ master.calendario_global_vinculos");

    await s.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "calendario_global_vinculos_usuario_id_tenant_id"
        ON "master"."calendario_global_vinculos" ("usuario_id", "tenant_id")
    `);
    log("✓ índice único (usuario_id, tenant_id)");

    // Comprobación real, no la fe en que el CREATE haya ido bien.
    const [tabla] = await s.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema='master' AND table_name='calendario_global_vinculos'`
    );
    if (!tabla.length) {
      process.stderr.write("\n✗ La tabla NO está. NO desplegar.\n\n");
      await s.close();
      process.exit(1);
    }

    const [filas] = await s.query(`SELECT count(*)::int AS n FROM master.calendario_global_vinculos`);
    log(`· ${filas[0].n} vínculo(s) apuntado(s)`);

    process.stdout.write("\n✓ Migración completada\n\n");
    await s.close();
  } catch (err) {
    process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
    await s.close();
    process.exit(1);
  }
}

main();
