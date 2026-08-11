/**
 * migrate-sesion-terapeuta-opcional.js — el terapeuta de una sesión clínica
 * deja de ser obligatorio (02/08/2026). Universal.
 *
 * `clinic_sessions.therapist_id` nació NOT NULL, y para una sesión que se
 * registra hoy tiene todo el sentido: la escribe quien la da.
 *
 * Pero al importar cuatro años de historial de Aumenta aparecieron 4.045
 * sesiones firmadas por gente que YA NO ESTÁ en el centro, o por cuentas que no
 * son personas (el «NADIE» de las citas sin asignar, la cuenta genérica de
 * fisioterapia). Con la columna obligatoria las opciones eran dos: tirar 4.045
 * notas clínicas, o atribuírselas a alguien que no las escribió.
 *
 * Las dos son peores que una nota sin autor. Un registro clínico sin firma
 * sigue siendo el registro de lo que se hizo con ese niño.
 *
 * Aditiva e idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-sesion-terapeuta-opcional.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-sesion-terapeuta-opcional.js
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
    const [filas] = await s.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
    );
    // Acotado si viene de `ensure-tenant-schema.js` (ONLY_SCHEMAS); global si se
    // lanza a mano, que es como se escribió. Ver scripts/_solo-este-tenant.js.
    const schemas = acotarSchemas(filas.map((r) => r.schema_name));
    process.stdout.write(`\n▶ Terapeuta opcional en la sesión · ${schemas.length} schema(s)\n\n`);

    for (const schema of schemas) {
      const [col] = await s.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema=$1 AND table_name='clinic_sessions' AND column_name='therapist_id'`,
        { bind: [schema] }
      );
      if (!col.length) { log(`· ${schema}: sin módulo clínico, se salta`); continue; }
      if (col[0].is_nullable === "YES") { log(`· ${schema}: ya era opcional`); continue; }
      await s.query(`ALTER TABLE "${schema}"."clinic_sessions" ALTER COLUMN therapist_id DROP NOT NULL`);
      log(`✓ ${schema}: therapist_id ya no es obligatorio`);
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
