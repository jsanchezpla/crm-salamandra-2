/**
 * migrate-whatsapp-messages.js — la tabla del hilo de WhatsApp.
 *
 * Crea `whatsapp_messages` en TODOS los schemas que tengan `clients`, que es lo
 * mismo que decir en todos. No se filtra por módulo a propósito (regla #14: la
 * configuración es universal, cualquier cliente puede conectar su WhatsApp
 * mañana sin que nadie toque código), y `byTable` no mira el estado del tenant,
 * así que un cliente suspendido también se pone al día — regla #12.
 *
 * Idempotente: se puede lanzar las veces que haga falta. Un fallo en un tenant
 * no aborta el resto. Nunca db:sync.
 *
 * ⚠️ ORDEN DE DEPLOY: es forward-compatible (solo AÑADE una tabla que el código
 * viejo ignora), pero el modelo nuevo entra en `tenantDb.js` y el endpoint la
 * lee, así que la migración va ANTES de `deploy.sh`:
 *
 *   git pull
 *   docker exec crm-salamandra-app-1 node scripts/migrate-whatsapp-messages.js
 *   ./deploy.sh
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-whatsapp-messages.js
 */

import { Sequelize } from "sequelize";
import { byTable, tableExists } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function schemaExists(s, schema) {
  const [rows] = await s.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, { bind: [schema] });
  return rows.length > 0;
}

async function indexExists(s, t, schema, indexName) {
  const [rows] = await s.query(`SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, {
    bind: [schema, indexName],
    transaction: t,
  });
  return rows.length > 0;
}

// gen_random_uuid(): nativa desde PG13; PG12 vía pgcrypto. Si no se puede
// garantizar, se omite el DEFAULT y el id lo pone Sequelize desde JS.
async function ensureUuidFn(s) {
  try {
    await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  } catch {
    /* sin permiso — seguimos e intentamos detectar */
  }
  try {
    await s.query(`SELECT gen_random_uuid()`);
    return true;
  } catch {
    return false;
  }
}

async function ensureIndex(s, t, schema, indexName, colsSql, unique = false) {
  if (await indexExists(s, t, schema, indexName)) return;
  await s.query(
    `CREATE ${unique ? "UNIQUE " : ""}INDEX "${indexName}" ON "${schema}"."whatsapp_messages" ${colsSql}`,
    { transaction: t }
  );
  log(`✓ ${schema}: índice ${indexName} creado`);
}

async function processSchema(s, schema) {
  const uuidDefault = await ensureUuidFn(s);
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;

  await s.transaction(async (t) => {
    if (!(await tableExists(s, schema, "whatsapp_messages"))) {
      await s.query(
        `CREATE TABLE "${schema}"."whatsapp_messages" (
          ${idCol},
          wam_id VARCHAR(255) NOT NULL,
          direction VARCHAR(8) NOT NULL,
          origin VARCHAR(16) NOT NULL DEFAULT 'api',
          phone VARCHAR(32) NOT NULL,
          client_id UUID REFERENCES "${schema}"."clients"(id) ON DELETE SET NULL,
          type VARCHAR(32) NOT NULL DEFAULT 'text',
          body TEXT,
          status VARCHAR(16),
          error_message TEXT,
          sent_at TIMESTAMPTZ,
          raw JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        { transaction: t }
      );
      log(`✓ ${schema}.whatsapp_messages: tabla creada`);
    } else {
      log(`· ${schema}.whatsapp_messages: ya existía`);
    }

    // UNIQUE sobre el id de Meta: es la idempotencia del webhook. Meta entrega
    // "al menos una vez" y reintenta lo que no reciba un 200; sin este índice,
    // un reintento duplicaría el mensaje en el hilo del paciente.
    await ensureIndex(s, t, schema, "whatsapp_messages_wam_id_unique", "(wam_id)", true);
    await ensureIndex(s, t, schema, "whatsapp_messages_phone_idx", "(phone)");
    await ensureIndex(s, t, schema, "whatsapp_messages_client_idx", "(client_id)");
    // Por fecha DE META, que es como se pinta el hilo: el historial de la
    // coexistencia son mensajes de hace meses y ordenarlos por created_at los
    // pondría todos en el día de la conexión.
    await ensureIndex(s, t, schema, "whatsapp_messages_sent_at_idx", "(sent_at)");
  });

  log(`✓ ${schema}: listo`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: hilo de WhatsApp (whatsapp_messages)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas, skipped } = await byTable(sequelize, "clients");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla clients.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schema(s): ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla clients (se omiten): ${skipped.join(", ")}`);

  for (const schema of schemas) {
    header(schema);
    if (!(await schemaExists(sequelize, schema))) {
      log(`✗ schema ${schema} no existe, se salta`);
      continue;
    }
    try {
      await processSchema(sequelize, schema);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
