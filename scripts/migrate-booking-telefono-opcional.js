/**
 * migrate-booking-telefono-opcional.js — el teléfono de una cita deja de ser
 * obligatorio (28/08/2026). Universal.
 *
 * Hermana exacta de `migrate-booking-email-opcional.js`, que hizo esto mismo con
 * el correo el 02/08/2026 y por el mismo motivo. Aquella dejó el trabajo a
 * medias sin querer: quitó la obligación del correo y dejó la del teléfono, y
 * como la pantalla exigía los dos, nadie lo notó.
 *
 * ── POR QUÉ AHORA (Lau de Aumenta) ─────────────────────────────────────────
 *
 * El alta manual de una cita exigía correo Y teléfono. Medido en producción el
 * 28/08/2026: de los 1.050 pacientes activos de Aumenta, **164 no se pueden
 * citar** porque su familia no tiene ninguno de los dos en ningún sitio del CRM
 * —ni en la ficha, ni en los tutores, ni en la pestaña de contactos—. Ese dato
 * no existe: o se le pide a la familia, o se deja de exigir.
 *
 * Un requisito que no se puede cumplir no protege el dato, lo ensucia: la gente
 * escribe cualquier cosa para poder seguir, y entonces el CRM cree que tiene un
 * teléfono bueno. El hueco al menos se ve.
 *
 * ── ESTA MIGRACIÓN VA **ANTES** DEL DESPLIEGUE ─────────────────────────────
 *
 * Es el orden que manda la skill de desplegar: aquí no se añade una columna, se
 * relaja una restricción que el código nuevo va a dejar de cumplir. Si el código
 * llegara primero, el `Booking.create` sin teléfono reventaría con un 500
 * genérico en vez de crear la cita. Al revés no rompe nada: una columna que pasa
 * a admitir NULL es invisible para el código que ya está corriendo, que sigue
 * mandando siempre teléfono.
 *
 * ── NO TOCA NI UNA FILA ────────────────────────────────────────────────────
 *
 * `DROP NOT NULL` cambia el catálogo, no los datos: no reescribe la tabla y es
 * instantáneo incluso en Aumenta con sus 12.030 citas. Coge un ACCESS EXCLUSIVE
 * de milisegundos.
 *
 * Aditiva e idempotente: un schema que ya la tenga opcional se salta.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-booking-telefono-opcional.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-booking-telefono-opcional.js
 */

import { Sequelize } from "sequelize";
import { acotarSchemas } from "./_solo-este-tenant.js";

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("Falta DATABASE_URL\n"); process.exit(1); }

  const s = new Sequelize(url, { logging: false });
  try {
    await s.authenticate();
    const [rows] = await s.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
    );
    // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
    // lanza a mano. Ver scripts/_solo-este-tenant.js.
    const schemas = acotarSchemas(rows.map((r) => r.schema_name));
    process.stdout.write(`\n▶ Teléfono de cita opcional · ${schemas.length} schema(s)\n\n`);

    for (const schema of schemas) {
      const [col] = await s.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema=$1 AND table_name='bookings' AND column_name='client_phone'`,
        { bind: [schema] }
      );
      if (!col.length) { log(`· ${schema}: sin módulo de citas, se salta`); continue; }
      if (col[0].is_nullable === "YES") { log(`· ${schema}: ya era opcional`); continue; }
      await s.query(`ALTER TABLE "${schema}"."bookings" ALTER COLUMN client_phone DROP NOT NULL`);
      log(`✓ ${schema}: client_phone ya no es obligatorio`);
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
