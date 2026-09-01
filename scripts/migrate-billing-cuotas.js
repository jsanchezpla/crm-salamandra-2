/**
 * migrate-billing-cuotas.js — las cuotas asignadas y su enlace con el cobro
 * (01/09/2026).
 *
 * Dos cosas, las dos aditivas:
 *   1. Tabla nueva `billing_cuotas` por tenant: qué paga cada familia todos los
 *      meses (conceptos, importe, método, día de cobro, alta y baja). Es lo que
 *      permite «programar las cuotas mensualmente» y darlas de baja sin borrar.
 *   2. Columna `payments.cuota_id`: de qué cuota nació un cobro. Es lo que
 *      evita generar dos veces el mismo mes — sin ella, «ya generado» habría
 *      que adivinarlo por importe y fecha.
 *
 * Recorre los schemas con `_schema-targets.js` (`byTable` sobre `invoices`: la
 * cuota acompaña a quien factura), fotos doradas incluidas. Idempotente
 * (IF NOT EXISTS), no escribe filas. Correr ANTES de deploy.sh: el modelo nuevo
 * se registra en tenantDb y pide las columnas por nombre.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-cuotas.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-cuotas.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: cuotas asignadas + payments.cuota_id\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(s, "invoices");
  for (const schema of skipped) {
    process.stdout.write(`  · ${schema}: sin invoices (módulo billing no migrado) — se omite\n`);
  }

  for (const schema of schemas) {
    await s.query(
      `CREATE TABLE IF NOT EXISTS "${schema}"."billing_cuotas" (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         client_id UUID NOT NULL,
         patient_id UUID,
         concept_ids JSONB,
         amount NUMERIC(12,2),
         method VARCHAR(20),
         day_of_month INTEGER,
         start_date DATE NOT NULL,
         end_date DATE,
         active BOOLEAN NOT NULL DEFAULT true,
         notes TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    await s.query(`CREATE INDEX IF NOT EXISTS billing_cuotas_client_idx ON "${schema}"."billing_cuotas" (client_id)`);
    await s.query(`CREATE INDEX IF NOT EXISTS billing_cuotas_patient_idx ON "${schema}"."billing_cuotas" (patient_id)`);
    await s.query(`CREATE INDEX IF NOT EXISTS billing_cuotas_active_idx ON "${schema}"."billing_cuotas" (active)`);

    // El cobro sabe de qué cuota nació. Sin FK, como el resto de puentes
    // opcionales de payments: el cobro apuntado a mano sigue naciendo a NULL.
    await s.query(`ALTER TABLE "${schema}"."payments" ADD COLUMN IF NOT EXISTS cuota_id UUID`);
    await s.query(
      `CREATE INDEX IF NOT EXISTS payments_cuota_periodo_idx ON "${schema}"."payments" (cuota_id, period_month)`
    );

    process.stdout.write(`  ✓ ${schema}: billing_cuotas + payments.cuota_id listos\n`);
  }

  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
