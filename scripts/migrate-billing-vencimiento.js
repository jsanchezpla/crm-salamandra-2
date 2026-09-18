/**
 * migrate-billing-vencimiento.js — el ajuste «imprimir el vencimiento en la
 * factura» (18/09/2026, AV-0176 de Aumenta; decidido por Rodrigo).
 *
 * Una columna en `tenant_billing_settings`:
 *   - print_due_date BOOLEAN DEFAULT true → si el PDF imprime la fila
 *     «Vencimiento» junto a la fecha de emisión.
 *
 * Isabel: «y quitar lo de Vencimiento». El impreso es el de TODOS los clientes,
 * así que no se quita para todos: se apaga en quien lo pida. Encendido de
 * serie, que es como está hoy.
 *
 * ⚠️ NULLABLE con DEFAULT, no `NOT NULL DEFAULT`: un `NOT NULL DEFAULT` reescribe
 * todas las filas de la tabla y eso ya es tocar datos. Así la columna nace vacía
 * en lo que ya existe y el código lee «distinto de false» — o sea, se imprime,
 * que es lo de siempre.
 *
 * Recorre los schemas con `_schema-targets.js` (`byTable`): TODOS los que tengan
 * la tabla, fotos doradas incluidas. Idempotente, no escribe filas. Correr ANTES
 * de deploy.sh (el modelo pide la columna).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-billing-vencimiento.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-billing-vencimiento.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: imprimir el vencimiento en la factura\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(s, "tenant_billing_settings");
  for (const schema of skipped) {
    process.stdout.write(`  · ${schema}: sin tenant_billing_settings — se omite\n`);
  }
  for (const schema of schemas) {
    await s.query(
      `ALTER TABLE "${schema}"."tenant_billing_settings"
         ADD COLUMN IF NOT EXISTS print_due_date BOOLEAN DEFAULT true`
    );
    process.stdout.write(`  ✓ ${schema}: print_due_date lista\n`);
  }

  await s.close();
  process.stdout.write("\n✓ Hecho\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
