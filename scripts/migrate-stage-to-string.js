/**
 * migrate-stage-to-string.js
 *
 * Convierte la columna `stage` de leads de ENUM a VARCHAR(50) en todos los schemas de tenant.
 * Necesario porque se añadieron nuevos estados (in_progress, demo_scheduled, demo_done, closed_yes, closed_no)
 * que el ENUM original no admitía.
 *
 * Uso: node scripts/migrate-stage-to-string.js
 */

import { Sequelize } from "sequelize";
import { acotarSlugs } from "./_solo-este-tenant.js";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  process.stderr.write("ERROR: DATABASE_URL no definida en .env\n");
  process.exit(1);
}

const db = new Sequelize(DATABASE_URL, {
  dialect: "postgres",
  logging: false,
});

/**
 * La lista sale de `master.tenants` (regla 12), no de una constante.
 *
 * Aquí había cinco slugs escritos a mano —demo, quality_energy, aumenta,
 * abarcaia, retorika—, y era la ÚNICA de las 92 migraciones que dispara el
 * alta que se quedaba sin acotar. Dos problemas a la vez:
 *
 *   · Dar de alta a un cliente entraba en el `information_schema` de esos
 *     cinco. Hoy no escribe nada porque los nueve schemas ya tienen `stage`
 *     como VARCHAR (comprobado en producción el 11/08), así que el ALTER de
 *     abajo no se alcanza. Pero eso es suerte del estado actual, no una
 *     garantía: en cuanto un schema tuviera el ENUM, un alta ajena le
 *     reescribiría la tabla de leads con candado exclusivo.
 *   · Y a los cuatro clientes que llegaron DESPUÉS —nutri_laura,
 *     spain_enzymes, healim, salamandra_solutions— no les hacía nada, que es
 *     lo que siempre acaba pasando con una lista copiada a mano.
 */
async function slugsDestino() {
  // `status = 'active'` es el criterio que ya usan las otras ocho migraciones
  // que se enumeran solas: mismo criterio en todas, o nadie sabe cuál manda.
  const [filas] = await db.query(
    `SELECT slug FROM master.tenants WHERE status = 'active' ORDER BY slug`
  );
  // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
  // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
  return acotarSlugs(filas.map((f) => f.slug));
}

async function migrateSchema(slug) {
  const schema = `crm_${slug}`;

  // Comprobar si la columna es ENUM
  const [rows] = await db.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = '${schema}'
      AND table_name = 'leads'
      AND column_name = 'stage'
    LIMIT 1;
  `);

  if (rows.length === 0) {
    process.stdout.write(`  · ${schema}: tabla leads no existe, saltando\n`);
    return;
  }

  const dataType = rows[0].data_type;

  if (dataType === "character varying") {
    process.stdout.write(`  · ${schema}: stage ya es VARCHAR, sin cambios\n`);
    return;
  }

  // Convertir ENUM → VARCHAR
  await db.query(
    `ALTER TABLE "${schema}".leads ALTER COLUMN stage TYPE VARCHAR(50) USING stage::text;`
  );

  // Eliminar el tipo ENUM huérfano
  await db.query(
    `DROP TYPE IF EXISTS "${schema}"."enum_leads_stage";`
  ).catch(() => {
    // El tipo puede estar en search_path por defecto; intentar sin schema
  });

  process.stdout.write(`  ✓ ${schema}: ENUM → VARCHAR(50)\n`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Migración: stage ENUM → VARCHAR(50)    \n");
  process.stdout.write("════════════════════════════════════════\n\n");

  const slugs = await slugsDestino();
  if (slugs.length === 0) {
    process.stdout.write("  · ningún schema en el alcance pedido, nada que hacer\n");
  }
  for (const slug of slugs) {
    await migrateSchema(slug);
  }

  await db.close();

  process.stdout.write("\n✓ Migración completada\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
