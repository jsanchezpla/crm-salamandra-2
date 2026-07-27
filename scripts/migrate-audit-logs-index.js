/**
 * migrate-audit-logs-index.js — índice (tenant_id, created_at DESC) en
 * master.audit_logs.
 *
 * La tabla no tenía NINGÚN índice porque nadie la leía: solo se escribía.
 * Con la pantalla Equipo → Actividad (GET /api/actividad) se consulta
 * filtrando por tenant y ordenando por fecha en cada visita; sin índice eso
 * es un scan completo de una tabla compartida que solo crece.
 *
 * OJO: opera sobre el schema MASTER, no sobre los crm_* — por eso NO va en
 * CORE/MODULES (ese registro corre por-tenant). Se lanza una vez a mano:
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-audit-logs-index.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-audit-logs-index.js
 */

import { Sequelize } from "sequelize";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  await s.query(`
    CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx
    ON master.audit_logs (tenant_id, created_at DESC)
  `);
  process.stdout.write("✓ master.audit_logs (tenant_id, created_at DESC)\n");

  await s.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
