/**
 * migrate-booking-email-opcional.js — el correo de una cita deja de ser
 * obligatorio (02/08/2026). Universal.
 *
 * `bookings.client_email` nació NOT NULL porque el módulo de Citas se hizo para
 * RESERVAS PÚBLICAS: la familia entra en el widget, teclea su correo y recibe la
 * confirmación. Ahí el correo es imprescindible.
 *
 * Pero una cita también se crea DESDE DENTRO —recepción la apunta por teléfono,
 * o llega importada de otro sistema— y entonces puede no haber correo. Al
 * importar la agenda de Aumenta aparecieron 1.394 citas de familias que no lo
 * tienen: con la columna obligatoria, la única salida era inventarse una
 * dirección, que es peor que dejarla vacía.
 *
 * Quien SÍ necesita correo (la reserva pública, el recordatorio) lo sigue
 * exigiendo en su endpoint. Lo que se quita es la obligación a nivel de tabla.
 *
 * Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-booking-email-opcional.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-booking-email-opcional.js
 */

import { Sequelize } from "sequelize";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const [schemas] = await s.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
    );
    process.stdout.write(`\n▶ Correo de cita opcional · ${schemas.length} schema(s)\n\n`);

    for (const { schema_name: schema } of schemas) {
      const [col] = await s.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema=$1 AND table_name='bookings' AND column_name='client_email'`,
        { bind: [schema] }
      );
      if (!col.length) { log(`· ${schema}: sin módulo de citas, se salta`); continue; }
      if (col[0].is_nullable === "YES") { log(`· ${schema}: ya era opcional`); continue; }
      await s.query(`ALTER TABLE "${schema}"."bookings" ALTER COLUMN client_email DROP NOT NULL`);
      log(`✓ ${schema}: client_email ya no es obligatorio`);
    }
    process.stdout.write("\n✓ Migración completada\n\n");
  } finally {
    await s.close();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  process.exit(1);
});
