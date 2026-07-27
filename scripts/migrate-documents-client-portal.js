/**
 * migrate-documents-client-portal.js — documentos compartidos con el paciente.
 *
 * Añade a `documents` lo necesario para el portal del paciente (nutri_laura):
 *
 *   - client_visible      BOOLEAN NOT NULL DEFAULT FALSE
 *       ¿lo ve el paciente en su portal? Por defecto NO: nada de lo que ya
 *       existe se expone por accidente al activar la feature.
 *   - uploaded_by_client  BOOLEAN NOT NULL DEFAULT FALSE
 *       lo subió el paciente desde su portal (no el equipo). Sirve para
 *       distinguirlo en Adjuntos y para que él pueda verlo siempre.
 *   - owner_user_id pasa a ser NULLABLE
 *       un paciente NO es usuario del CRM, así que sus subidas no tienen owner.
 *       No hay FK sobre esa columna; el módulo Documentos ya compara
 *       `doc.ownerUserId !== userId` para permitir borrar, y con NULL
 *       simplemente nadie lo borra desde ahí (sí desde la ficha, que es donde
 *       corresponde).
 *
 * Índice (client_id, client_visible) para la consulta del portal.
 *
 * Aditiva e idempotente. Selecciona schemas por EXISTENCIA de la tabla
 * `documents` (byTable): así se blinda cualquier tenant que la tenga, haya
 * comprado o no el módulo.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-documents-client-portal.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-documents-client-portal.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: documentos visibles para el paciente\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(s, "documents");
  if (schemas.length === 0) log("· Ningún schema con tabla documents.");

  for (const schema of schemas) {
    try {
      await s.query(
        `ALTER TABLE "${schema}"."documents"
           ADD COLUMN IF NOT EXISTS client_visible BOOLEAN NOT NULL DEFAULT FALSE`
      );
      await s.query(
        `ALTER TABLE "${schema}"."documents"
           ADD COLUMN IF NOT EXISTS uploaded_by_client BOOLEAN NOT NULL DEFAULT FALSE`
      );
      // Idempotente: si ya es nullable, DROP NOT NULL no falla.
      await s.query(`ALTER TABLE "${schema}"."documents" ALTER COLUMN owner_user_id DROP NOT NULL`);
      await s.query(
        `CREATE INDEX IF NOT EXISTS documents_client_visible_idx
           ON "${schema}"."documents"(client_id, client_visible)`
      );
      log(`✓ ${schema}: documents listo (client_visible, uploaded_by_client, owner nullable)`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n ✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
