/**
 * update-nutri-laura-eventtype-notice.js — Pone una antelación mínima
 * uniforme en todos los EventType de nutri_laura.
 *
 * Valor por defecto: 3 horas. Sin distinción entre Primera consulta y
 * Seguimiento — el seed antiguo tenía 24h / 12h (criterios arbitrarios)
 * y se quería un comportamiento uniforme.
 *
 * Idempotente.
 *
 * Override del valor: variable de entorno MIN_NOTICE_HOURS. Ej.:
 *   MIN_NOTICE_HOURS=6 node --env-file=.env.local scripts/update-nutri-laura-eventtype-notice.js
 *
 * Uso local: node --env-file=.env.local scripts/update-nutri-laura-eventtype-notice.js
 * Uso VPS:   docker compose exec app node scripts/update-nutri-laura-eventtype-notice.js
 */

import { getTenantDb } from "../../lib/db/tenantDb.js";

const SLUG = "nutri_laura";
const DEFAULT_HOURS = 3;

async function main() {
  const hours = Number(process.env.MIN_NOTICE_HOURS ?? DEFAULT_HOURS);
  if (!Number.isInteger(hours) || hours < 0) {
    process.stderr.write(`\n✗ MIN_NOTICE_HOURS inválido: ${process.env.MIN_NOTICE_HOURS}\n`);
    process.exit(1);
  }

  process.stdout.write(`\n▶ Fijando min_notice_hours = ${hours}h en EventType de ${SLUG}...\n`);

  const { sequelize } = await getTenantDb(SLUG);
  const [, meta] = await sequelize.query(
    `UPDATE crm_${SLUG}.event_types SET min_notice_hours = :hours WHERE min_notice_hours <> :hours`,
    { replacements: { hours }, logging: false }
  );
  process.stdout.write(`  ✓ ${meta.rowCount} EventType(s) actualizado(s) a ${hours}h\n`);

  const ets = await sequelize.query(
    `SELECT name, min_notice_hours FROM crm_${SLUG}.event_types ORDER BY name`,
    { type: sequelize.QueryTypes.SELECT, logging: false }
  );
  process.stdout.write(`\n  Estado final:\n`);
  for (const et of ets) {
    process.stdout.write(`    · ${et.name}: ${et.min_notice_hours}h\n`);
  }
  process.stdout.write("\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
