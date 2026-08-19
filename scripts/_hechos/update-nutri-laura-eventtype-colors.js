/**
 * update-nutri-laura-eventtype-colors.js — Repinta los EventType de nutri_laura
 * con la paleta rosa-marrón.
 *
 * Cambia los antiguos verdes nutricionales (#3F6E5B / #6B8E7E) por:
 *   - Primera consulta: #A97873 (rosa maquillaje profundo)
 *   - Seguimiento     : #C89C97 (rosa medio, derivado del primary)
 *
 * Idempotente: si los colores ya están en la nueva paleta no hace nada.
 *
 * Uso local:  node --env-file=.env.local scripts/update-nutri-laura-eventtype-colors.js
 */

import { getTenantDb } from "../../lib/db/tenantDb.js";

const SLUG = "nutri_laura";

const MAPPING = {
  "#3F6E5B": "#A97873", // primer color del seed antiguo → primary nuevo
  "#6B8E7E": "#C89C97", // segundo color del seed antiguo → variante media
};

async function main() {
  process.stdout.write(`\n▶ Actualizando colores de EventType en ${SLUG}...\n`);

  const { sequelize } = await getTenantDb(SLUG);

  for (const [oldColor, newColor] of Object.entries(MAPPING)) {
    const [, meta] = await sequelize.query(
      `UPDATE crm_${SLUG}.event_types SET color = :newColor WHERE color = :oldColor`,
      {
        replacements: { oldColor, newColor },
        logging: false,
      }
    );
    process.stdout.write(`  ✓ ${oldColor} → ${newColor}: ${meta.rowCount} fila(s)\n`);
  }

  const ets = await sequelize.query(
    `SELECT name, color FROM crm_${SLUG}.event_types ORDER BY name`,
    { type: sequelize.QueryTypes.SELECT, logging: false }
  );
  process.stdout.write(`\n  Estado final:\n`);
  for (const et of ets) {
    process.stdout.write(`    · ${et.name}: ${et.color}\n`);
  }
  process.stdout.write("\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
