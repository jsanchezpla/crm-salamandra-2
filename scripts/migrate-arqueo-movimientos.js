/**
 * migrate-arqueo-movimientos.js — entradas y salidas de caja (01/09/2026).
 *
 * Tabla nueva `cash_movements` por tenant: lo que entra y sale del cajón y NO
 * es un cobro (pagar la mensajería, sacar el sobre para el banco, meter
 * cambio). Es lo que le faltaba al arqueo para que lo esperado sea fondo +
 * cobros en efectivo + entradas − salidas, en vez de descuadrar todos los días
 * y explicarlo en un texto libre.
 *
 * Recorre los schemas con `_schema-targets.js` (`byTable` sobre `cash_points`:
 * donde hay cajas), fotos doradas incluidas. Aditiva e idempotente, no escribe
 * filas. Correr ANTES de deploy.sh: el modelo nuevo se registra en tenantDb.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-arqueo-movimientos.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-arqueo-movimientos.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: entradas y salidas de caja\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(s, "cash_points");
  for (const schema of skipped) {
    process.stdout.write(`  · ${schema}: sin cash_points (arqueo no migrado) — se omite\n`);
  }

  for (const schema of schemas) {
    // El enum vive en el schema del tenant, como el resto de los suyos.
    await s.query(
      `DO $$ BEGIN
         CREATE TYPE "${schema}"."enum_cash_movements_direction" AS ENUM ('in', 'out');
       EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
    );
    await s.query(
      `CREATE TABLE IF NOT EXISTS "${schema}"."cash_movements" (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         cash_point_id UUID NOT NULL,
         date DATE NOT NULL,
         direction "${schema}"."enum_cash_movements_direction" NOT NULL,
         amount NUMERIC(10,2) NOT NULL,
         concept VARCHAR(200) NOT NULL,
         notes TEXT,
         created_by_id UUID,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    await s.query(`CREATE INDEX IF NOT EXISTS cash_movements_point_date_idx ON "${schema}"."cash_movements" (cash_point_id, date)`);
    await s.query(`CREATE INDEX IF NOT EXISTS cash_movements_date_idx ON "${schema}"."cash_movements" (date)`);

    /*
     * La FK va DESPUÉS y tolerando el fallo, igual que en `migrate-arqueo.js`:
     * las fotos doradas de las demos (`crm_*_golden`) se copian sin claves
     * primarias, así que ahí PostgreSQL rechaza el REFERENCES. Con la FK dentro
     * del CREATE TABLE, la tabla no llegaba ni a existir en esos schemas.
     * CASCADE: borrar una caja se lleva sus apuntes, que sin caja no significan
     * nada (el histórico contable que hay que conservar son los CIERRES).
     */
    try {
      await s.query(
        `ALTER TABLE "${schema}"."cash_movements"
           ADD CONSTRAINT cash_movements_point_fk
           FOREIGN KEY (cash_point_id) REFERENCES "${schema}"."cash_points"(id) ON DELETE CASCADE`
      );
    } catch (e) {
      const yaEstaba = /ya existe|already exists/i.test(e.message);
      if (!yaEstaba) process.stdout.write(`  · ${schema}: sin FK a cash_points (${e.message.split("\n")[0]})\n`);
    }

    process.stdout.write(`  ✓ ${schema}: cash_movements lista\n`);
  }

  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e.message}\n`);
  process.exit(1);
});
