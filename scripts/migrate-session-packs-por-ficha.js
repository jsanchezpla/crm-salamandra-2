/**
 * migrate-session-packs-por-ficha.js — el bono de sesiones ya no exige correo
 * (07/09/2026, AV-0055 de Aumenta).
 *
 * `session_packs.client_email` nació NOT NULL porque el bono se pensó para el
 * área privada, donde la paciente se identifica por correo. En un centro como
 * Aumenta el bono es de la FAMILIA (la ficha), y 330 de sus 1.083 fichas no
 * tienen correo: «Dar un bono» no dejaba darlo. Ahora el bono se ata por
 * `client_id` cuando no hay correo, y las citas se enganchan eligiendo el bono
 * al crearlas (`lib/citas/packs.js`, `elegirPack`).
 *
 * Qué hace: `ALTER COLUMN client_email DROP NOT NULL` en todo schema que TENGA
 * la tabla (`byTable`: haya comprado el módulo o no). Idempotente. Ni un slug a
 * mano: lee `master.tenants` en ejecución.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-session-packs-por-ficha.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-session-packs-por-ficha.js
 */

import { Sequelize } from "sequelize";
import { byTable, slugDeSchema } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const TABLA = "session_packs";

const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

try {
  await s.authenticate();
  const { schemas: objetivos } = await byTable(s, TABLA);
  header(`${TABLA}.client_email → admite nulo (${objetivos.length} schema(s))`);
  let cambiados = 0;
  for (const schema of objetivos) {
    const slug = slugDeSchema(schema);
    const [[antes]] = await s.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = :schema AND table_name = :tabla AND column_name = 'client_email'`,
      { replacements: { schema, tabla: TABLA } }
    );
    if (!antes) { log(`${slug}: sin columna client_email (?)`); continue; }
    if (antes.is_nullable === "YES") { log(`${slug}: ya admitía nulo`); continue; }
    await s.query(`ALTER TABLE "${schema}"."${TABLA}" ALTER COLUMN client_email DROP NOT NULL`);
    cambiados++;
    log(`${slug}: ✓ client_email admite nulo`);
  }
  header(`Hecho: ${cambiados} schema(s) cambiados, ${objetivos.length - cambiados} ya estaban.`);
} catch (err) {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await s.close();
}
