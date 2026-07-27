/**
 * migrate-support-module.js
 *
 * Módulo Soporte (`support`): helpdesk con el que el TENANT atiende a SUS
 * clientes. Tickets con número correlativo (TK-0042), hilo de conversación con
 * notas internas, adjuntos, categorías, plantillas de respuesta, SLA y portal
 * público de seguimiento por token.
 *
 *   - tickets            → ya existía (modelo original de 2025, tabla creada por
 *                          db:sync en todos los schemas). Aquí se AMPLÍA:
 *                          número correlativo, contacto, categoría, canal,
 *                          token del portal, hitos SLA.
 *   - ticket_messages    → el hilo. Sustituye al JSONB `messages` de la tabla
 *                          tickets (columna que queda en BD sin uso): hace falta
 *                          autor, público/interno y hora para medir el SLA.
 *   - ticket_attachments → metadatos de adjuntos (el binario va a disco).
 *   - ticket_categories  → categorías configurables por el tenant.
 *   - ticket_templates   → plantillas de respuesta (macros).
 *   - support_settings   → una fila: SLA por prioridad, portal on/off, avisos.
 *
 * DOS PASADAS (mismo patrón que migrate-formularios-module):
 *
 *   1ª — CREAR, sobre los schemas con el módulo `support` activo (`byModule`).
 *        Para tablas que aún no existen en ningún sitio, `byTable` daría lista
 *        vacía y el módulo no se instalaría jamás.
 *   2ª — AMPLIAR Y BLINDAR sobre los schemas que YA tienen `tickets`
 *        (`byTable`), la creara quien la creara. Como el modelo Ticket está
 *        registrado para TODOS los tenants, la tabla existe en todos los
 *        schemas: esta pasada añade las columnas nuevas, crea las tablas
 *        hermanas (los modelos nuevos también están registrados globalmente y
 *        no deben reventar con 42P01), la secuencia del número, índices,
 *        DEFAULTs de base de datos y FKs condicionales.
 *
 * Ni un solo slug escrito a mano: ambas pasadas leen `master.tenants` en
 * tiempo de ejecución. Aditiva e idempotente: se puede lanzar cien veces.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-support-module.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-support-module.js
 */

import { Sequelize } from "sequelize";
import { byModule, byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const TABLA_TICKETS = "tickets";
const TABLA_MESSAGES = "ticket_messages";
const TABLA_ATTACHMENTS = "ticket_attachments";
const TABLA_CATEGORIES = "ticket_categories";
const TABLA_TEMPLATES = "ticket_templates";
const TABLA_SETTINGS = "support_settings";

async function crearTablas(s, schema, t) {
  // `tickets` con TODAS las columnas (schema nuevo). En los schemas donde ya
  // existe (db:sync del modelo viejo), el IF NOT EXISTS la deja en paz y las
  // columnas nuevas las añade `ampliarTickets`. status/priority van como
  // VARCHAR+CHECK aquí; en las tablas creadas por db:sync son enums de
  // Postgres — a la app le da igual (el modelo valida en JS y compara texto).
  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${TABLA_TICKETS}" (
       id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       number                INTEGER,
       client_id             UUID,
       contact_id            UUID,
       category_id           UUID,
       title                 VARCHAR(255) NOT NULL,
       description           TEXT,
       status                VARCHAR(20)  NOT NULL DEFAULT 'open',
       priority              VARCHAR(20)  NOT NULL DEFAULT 'medium',
       assigned_to           UUID,
       channel               VARCHAR(20)  NOT NULL DEFAULT 'manual',
       portal_token          VARCHAR(64),
       requester_name        VARCHAR(255),
       requester_email       VARCHAR(255),
       created_by            UUID,
       first_response_at     TIMESTAMPTZ,
       first_response_due_at TIMESTAMPTZ,
       resolution_due_at     TIMESTAMPTZ,
       resolved_at           TIMESTAMPTZ,
       closed_at             TIMESTAMPTZ,
       last_message_at       TIMESTAMPTZ,
       messages              JSONB        NOT NULL DEFAULT '[]'::jsonb,
       custom_fields         JSONB        NOT NULL DEFAULT '{}'::jsonb,
       created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
       updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );

  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${TABLA_MESSAGES}" (
       id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       ticket_id      UUID         NOT NULL,
       author_type    VARCHAR(20)  NOT NULL DEFAULT 'team',
       author_user_id UUID,
       author_name    VARCHAR(255),
       body           TEXT         NOT NULL,
       is_internal    BOOLEAN      NOT NULL DEFAULT FALSE,
       email_status   VARCHAR(20),
       created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
       updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );

  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${TABLA_ATTACHMENTS}" (
       id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       ticket_id        UUID         NOT NULL,
       message_id       UUID,
       file_name        VARCHAR(255) NOT NULL,
       storage_path     VARCHAR(500) NOT NULL,
       file_size        INTEGER      NOT NULL DEFAULT 0,
       mime_type        VARCHAR(120),
       uploaded_by_type VARCHAR(20)  NOT NULL DEFAULT 'team',
       created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
       updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );

  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${TABLA_CATEGORIES}" (
       id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       name       VARCHAR(80)  NOT NULL,
       color      VARCHAR(20),
       sort_order INTEGER      NOT NULL DEFAULT 0,
       active     BOOLEAN      NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
       updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );

  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${TABLA_TEMPLATES}" (
       id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       name       VARCHAR(120) NOT NULL,
       body       TEXT         NOT NULL,
       sort_order INTEGER      NOT NULL DEFAULT 0,
       active     BOOLEAN      NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
       updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );

  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${TABLA_SETTINGS}" (
       id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       sla_enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
       sla_config     JSONB       NOT NULL DEFAULT '{}'::jsonb,
       portal_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
       portal_intro   TEXT,
       notify_emails  JSONB       NOT NULL DEFAULT '[]'::jsonb,
       auto_classify  BOOLEAN     NOT NULL DEFAULT FALSE,
       created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );
}

/**
 * Columnas nuevas de `tickets` para los schemas donde la tabla ya existía con
 * la forma de 2025 (id, client_id, title, description, status, priority,
 * assigned_to, messages, resolved_at, custom_fields).
 */
async function ampliarTickets(s, schema, t) {
  const columnas = [
    ["number", "INTEGER"],
    ["contact_id", "UUID"],
    ["category_id", "UUID"],
    ["channel", "VARCHAR(20) NOT NULL DEFAULT 'manual'"],
    ["portal_token", "VARCHAR(64)"],
    ["requester_name", "VARCHAR(255)"],
    ["requester_email", "VARCHAR(255)"],
    ["created_by", "UUID"],
    ["first_response_at", "TIMESTAMPTZ"],
    ["first_response_due_at", "TIMESTAMPTZ"],
    ["resolution_due_at", "TIMESTAMPTZ"],
    ["closed_at", "TIMESTAMPTZ"],
    ["last_message_at", "TIMESTAMPTZ"],
  ];
  for (const [col, tipo] of columnas) {
    await s.query(
      `ALTER TABLE "${schema}"."${TABLA_TICKETS}" ADD COLUMN IF NOT EXISTS ${col} ${tipo}`,
      { transaction: t }
    );
  }
}

/**
 * Número correlativo por tenant. La secuencia vive en el schema del tenant y
 * la aplica la BD como DEFAULT: la app no asigna números (dos altas a la vez
 * jamás chocan). Backfill de los tickets pre-existentes en orden de llegada.
 */
async function numerar(s, schema, t) {
  await s.query(`CREATE SEQUENCE IF NOT EXISTS "${schema}".ticket_number_seq`, { transaction: t });
  await s.query(
    `ALTER TABLE "${schema}"."${TABLA_TICKETS}"
       ALTER COLUMN number SET DEFAULT nextval('"${schema}".ticket_number_seq')`,
    { transaction: t }
  );
  await s.query(
    `UPDATE "${schema}"."${TABLA_TICKETS}" t
        SET number = sub.rn + (SELECT COALESCE(MAX(number), 0)
                                 FROM "${schema}"."${TABLA_TICKETS}"
                                WHERE number IS NOT NULL)
       FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
               FROM "${schema}"."${TABLA_TICKETS}"
              WHERE number IS NULL) sub
      WHERE t.id = sub.id`,
    { transaction: t }
  );
  await s.query(
    `SELECT setval('"${schema}".ticket_number_seq',
                   (SELECT COALESCE(MAX(number), 0) + 1 FROM "${schema}"."${TABLA_TICKETS}"),
                   false)`,
    { transaction: t }
  );
}

/**
 * Índices, DEFAULTs de base de datos, CHECKs y FKs. Todo lo que también hay
 * que garantizar en un schema donde las tablas las creó `db:sync` (allí los
 * DEFAULT viven en JavaScript, no en la base de datos).
 */
async function blindar(s, schema, t) {
  // Índices de la bandeja y del portal.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS tickets_number_unique
       ON "${schema}"."${TABLA_TICKETS}" (number)`,
    { transaction: t }
  );
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS tickets_portal_token_unique
       ON "${schema}"."${TABLA_TICKETS}" (portal_token) WHERE portal_token IS NOT NULL`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS tickets_status_last_idx
       ON "${schema}"."${TABLA_TICKETS}" (status, last_message_at DESC)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS tickets_assigned_idx
       ON "${schema}"."${TABLA_TICKETS}" (assigned_to)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS tickets_client_idx
       ON "${schema}"."${TABLA_TICKETS}" (client_id)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx
       ON "${schema}"."${TABLA_MESSAGES}" (ticket_id, created_at ASC)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS ticket_attachments_ticket_idx
       ON "${schema}"."${TABLA_ATTACHMENTS}" (ticket_id)`,
    { transaction: t }
  );

  // DEFAULT en base de datos (el patrón que reventó projects-sprint-2).
  const defaults = [
    [TABLA_TICKETS, "id", "gen_random_uuid()"],
    [TABLA_TICKETS, "channel", `'manual'`],
    [TABLA_TICKETS, "custom_fields", `'{}'::jsonb`],
    [TABLA_MESSAGES, "id", "gen_random_uuid()"],
    [TABLA_MESSAGES, "author_type", `'team'`],
    [TABLA_MESSAGES, "is_internal", "FALSE"],
    [TABLA_ATTACHMENTS, "id", "gen_random_uuid()"],
    [TABLA_ATTACHMENTS, "file_size", "0"],
    [TABLA_ATTACHMENTS, "uploaded_by_type", `'team'`],
    [TABLA_CATEGORIES, "id", "gen_random_uuid()"],
    [TABLA_CATEGORIES, "sort_order", "0"],
    [TABLA_CATEGORIES, "active", "TRUE"],
    [TABLA_TEMPLATES, "id", "gen_random_uuid()"],
    [TABLA_TEMPLATES, "sort_order", "0"],
    [TABLA_TEMPLATES, "active", "TRUE"],
    [TABLA_SETTINGS, "id", "gen_random_uuid()"],
    [TABLA_SETTINGS, "sla_enabled", "TRUE"],
    [TABLA_SETTINGS, "sla_config", `'{}'::jsonb`],
    [TABLA_SETTINGS, "portal_enabled", "TRUE"],
    [TABLA_SETTINGS, "notify_emails", `'[]'::jsonb`],
    [TABLA_SETTINGS, "auto_classify", "FALSE"],
  ];
  for (const [tabla, columna, valor] of defaults) {
    await s.query(
      `ALTER TABLE "${schema}"."${tabla}" ALTER COLUMN ${columna} SET DEFAULT ${valor}`,
      { transaction: t }
    );
  }

  // Valores permitidos, garantizados en base de datos y no solo en el modelo.
  // OJO: status/priority NO llevan CHECK aquí — en los schemas creados por
  // db:sync son enums de Postgres (enum_tickets_status) y ya restringen solos;
  // en los creados por esta migración el CHECK iría bien, pero un CHECK sobre
  // una columna enum con literales de texto es frágil entre versiones. El
  // modelo Sequelize valida ambos en JS.
  const checks = [
    [TABLA_TICKETS, "tickets_channel_chk", `channel IN ('manual','portal')`],
    [TABLA_MESSAGES, "ticket_messages_author_type_chk", `author_type IN ('team','client','system')`],
    [TABLA_ATTACHMENTS, "ticket_attachments_uploader_chk", `uploaded_by_type IN ('team','client')`],
  ];
  for (const [tabla, nombre, condicion] of checks) {
    await s.query(
      `DO $$
       BEGIN
         ALTER TABLE "${schema}"."${tabla}" ADD CONSTRAINT ${nombre} CHECK (${condicion});
       EXCEPTION
         WHEN duplicate_object THEN NULL;
         WHEN duplicate_table  THEN NULL;
       END $$;`,
      { transaction: t }
    );
  }

  // FKs reales (ON DELETE elegido a conciencia): borrar un ticket arrastra su
  // hilo y sus adjuntos; borrar un cliente/contacto/categoría/miembro deja el
  // ticket vivo con el campo a NULL. Condicionales: la tabla referenciada
  // puede no existir en un schema sin ese módulo (p.ej. sin team_members).
  const fks = [
    [TABLA_TICKETS, "tickets_client_fk", `FOREIGN KEY (client_id) REFERENCES "${schema}".clients(id) ON DELETE SET NULL`],
    [TABLA_TICKETS, "tickets_contact_fk", `FOREIGN KEY (contact_id) REFERENCES "${schema}".contacts(id) ON DELETE SET NULL`],
    [TABLA_TICKETS, "tickets_category_fk", `FOREIGN KEY (category_id) REFERENCES "${schema}".${TABLA_CATEGORIES}(id) ON DELETE SET NULL`],
    [TABLA_TICKETS, "tickets_assignee_fk", `FOREIGN KEY (assigned_to) REFERENCES "${schema}".team_members(id) ON DELETE SET NULL`],
    [TABLA_MESSAGES, "ticket_messages_ticket_fk", `FOREIGN KEY (ticket_id) REFERENCES "${schema}".${TABLA_TICKETS}(id) ON DELETE CASCADE`],
    [TABLA_ATTACHMENTS, "ticket_attachments_ticket_fk", `FOREIGN KEY (ticket_id) REFERENCES "${schema}".${TABLA_TICKETS}(id) ON DELETE CASCADE`],
    [TABLA_ATTACHMENTS, "ticket_attachments_message_fk", `FOREIGN KEY (message_id) REFERENCES "${schema}".${TABLA_MESSAGES}(id) ON DELETE CASCADE`],
  ];
  for (const [tabla, nombre, definicion] of fks) {
    await s.query(
      `DO $$
       BEGIN
         ALTER TABLE "${schema}"."${tabla}" ADD CONSTRAINT ${nombre} ${definicion};
       EXCEPTION
         WHEN duplicate_object THEN NULL;
         WHEN duplicate_table  THEN NULL;
         WHEN undefined_table  THEN NULL;
         WHEN undefined_column THEN NULL;
       END $$;`,
      { transaction: t }
    );
  }
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: módulo Soporte (tickets)\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // ── Pasada 1: crear en los tenants que tienen el módulo activo ────────────
  header("Pasada 1 — schemas con el módulo `support` activo (crear)");
  const { schemas: conModulo } = await byModule(s, "support");
  if (conModulo.length === 0) {
    log("· Ninguno todavía. Se creará cuando se dé de alta el módulo a algún tenant.");
  }
  for (const schema of conModulo) {
    try {
      await s.transaction(async (t) => {
        await crearTablas(s, schema, t);
      });
      log(`✓ ${schema}: tablas creadas o ya existentes`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  // ── Pasada 2: ampliar y blindar allí donde `tickets` YA existe ────────────
  // La tabla existe en todos los schemas (modelo registrado globalmente), así
  // que esta pasada deja CUALQUIER schema consistente con los modelos nuevos.
  header("Pasada 2 — schemas con tabla `tickets` (ampliar, numerar, blindar)");
  const { schemas: conTabla } = await byTable(s, TABLA_TICKETS);
  if (conTabla.length === 0) log("· Ninguno.");
  for (const schema of conTabla) {
    try {
      await s.transaction(async (t) => {
        await crearTablas(s, schema, t); // hermanas IF NOT EXISTS (42P01-proof)
        await ampliarTickets(s, schema, t);
        await numerar(s, schema, t);
        await blindar(s, schema, t);
      });
      log(`✓ ${schema}: columnas, secuencia, índices, defaults y FKs al día`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
