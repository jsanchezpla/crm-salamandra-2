/**
 * migrate-formularios-module.js
 *
 * Módulo Formularios: formularios públicos cuyas solicitudes caen en una
 * bandeja del CRM y, al aceptarlas, se convierten en ficha de cliente.
 *
 *   - forms              → la DEFINICIÓN del formulario. Las preguntas viven en
 *                          `fields` (JSONB): añadir una pregunta es una fila,
 *                          no un despliegue.
 *   - form_submissions   → cada solicitud recibida, con las respuestas y el
 *                          enunciado de cada pregunta dentro.
 *
 * DOS PASADAS, y conviene entender por qué:
 *
 *   1ª — CREAR, sobre los schemas con el módulo `formularios` activo
 *        (`byModule`). La regla del proyecto dice "elegir schemas por
 *        EXISTENCIA de tabla", pero eso vale para migraciones ADITIVAS sobre
 *        tablas que ya están. Para una tabla que aún no existe en ningún sitio,
 *        `byTable` devolvería lista vacía y el módulo no se instalaría jamás.
 *   2ª — BLINDAR (índices y columnas añadidas después), sobre los schemas que
 *        YA tienen la tabla (`byTable`). Esta es la pasada que cierra el
 *        agujero del incidente del 2026-07-21: alcanza también a los schemas
 *        donde la tabla la creó `db:sync` desde los modelos y no esta
 *        migración, que es justo donde faltan los DEFAULT de base de datos.
 *
 * Ni un solo slug escrito a mano: ambas pasadas leen `master.tenants` en
 * tiempo de ejecución. Aditiva e idempotente: se puede lanzar cien veces.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-formularios-module.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-formularios-module.js
 */

import { Sequelize } from "sequelize";
import { byModule, byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const TABLA_FORMS = "forms";
const TABLA_SUBMISSIONS = "form_submissions";

async function crearTablas(s, schema, t) {
  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${TABLA_FORMS}" (
       id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       slug              VARCHAR(64)  NOT NULL,
       title             VARCHAR(255) NOT NULL,
       intro_text        TEXT,
       fields            JSONB        NOT NULL DEFAULT '[]'::jsonb,
       submit_label      VARCHAR(64),
       thank_you_message TEXT,
       settings          JSONB        NOT NULL DEFAULT '{}'::jsonb,
       active            BOOLEAN      NOT NULL DEFAULT TRUE,
       sort_order        INTEGER      NOT NULL DEFAULT 0,
       created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
       updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );

  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${TABLA_SUBMISSIONS}" (
       id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       form_id          UUID         NOT NULL,
       form_slug        VARCHAR(64)  NOT NULL,
       form_title       VARCHAR(255) NOT NULL,
       name             VARCHAR(255),
       email            VARCHAR(255),
       phone            VARCHAR(64),
       answers          JSONB        NOT NULL DEFAULT '[]'::jsonb,
       status           VARCHAR(20)  NOT NULL DEFAULT 'pending',
       client_id        UUID,
       accepted_at      TIMESTAMPTZ,
       rejected_at      TIMESTAMPTZ,
       rejection_reason TEXT,
       internal_notes   TEXT,
       handled_by       VARCHAR(255),
       source_url       VARCHAR(500),
       spam_score       INTEGER      NOT NULL DEFAULT 0,
       consent_at       TIMESTAMPTZ,
       consent_text     TEXT,
       consent_version  VARCHAR(32),
       created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
       updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );
}

/**
 * Todo lo que hay que garantizar TAMBIÉN en un schema donde las tablas las
 * creó `db:sync` desde los modelos: ahí los DEFAULT viven en JavaScript, no en
 * la base de datos, y los índices con nombre no existen.
 */
async function blindar(s, schema, t) {
  // Índice único del slug del formulario.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS forms_slug_unique
       ON "${schema}"."${TABLA_FORMS}" (slug)`,
    { transaction: t }
  );

  // Índices de la bandeja.
  await s.query(
    `CREATE INDEX IF NOT EXISTS form_submissions_status_created_idx
       ON "${schema}"."${TABLA_SUBMISSIONS}" (status, created_at DESC)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS form_submissions_form_idx
       ON "${schema}"."${TABLA_SUBMISSIONS}" (form_id)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS form_submissions_client_idx
       ON "${schema}"."${TABLA_SUBMISSIONS}" (client_id)`,
    { transaction: t }
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS form_submissions_phone_idx
       ON "${schema}"."${TABLA_SUBMISSIONS}" (phone)`,
    { transaction: t }
  );

  // DEFAULT en base de datos. Sequelize los aplica en JS al crear filas desde
  // la app, pero cualquier INSERT hecho por un script se quedaría sin ellos:
  // es exactamente el patrón que reventó `projects-sprint-2` y `billing-rework`.
  const defaults = [
    [TABLA_FORMS, "id", "gen_random_uuid()"],
    [TABLA_FORMS, "fields", `'[]'::jsonb`],
    [TABLA_FORMS, "settings", `'{}'::jsonb`],
    [TABLA_FORMS, "active", "TRUE"],
    [TABLA_FORMS, "sort_order", "0"],
    [TABLA_FORMS, "created_at", "now()"],
    [TABLA_FORMS, "updated_at", "now()"],
    [TABLA_SUBMISSIONS, "id", "gen_random_uuid()"],
    [TABLA_SUBMISSIONS, "answers", `'[]'::jsonb`],
    [TABLA_SUBMISSIONS, "status", `'pending'`],
    [TABLA_SUBMISSIONS, "spam_score", "0"],
    [TABLA_SUBMISSIONS, "created_at", "now()"],
    [TABLA_SUBMISSIONS, "updated_at", "now()"],
  ];
  for (const [tabla, columna, valor] of defaults) {
    await s.query(
      `ALTER TABLE "${schema}"."${tabla}" ALTER COLUMN ${columna} SET DEFAULT ${valor}`,
      { transaction: t }
    );
  }

  // Estados permitidos, garantizados en base de datos y no solo en el modelo.
  await s.query(
    `DO $$
     BEGIN
       ALTER TABLE "${schema}"."${TABLA_SUBMISSIONS}"
         ADD CONSTRAINT form_submissions_status_chk
         CHECK (status IN ('pending','accepted','rejected'));
     EXCEPTION
       WHEN duplicate_object THEN NULL;
       WHEN duplicate_table  THEN NULL;
     END $$;`,
    { transaction: t }
  );
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: módulo Formularios\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // ── Pasada 1: crear en los tenants que tienen el módulo activo ────────────
  header("Pasada 1 — schemas con el módulo `formularios` activo (crear)");
  const { schemas: conModulo } = await byModule(s, "formularios");
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

  // ── Pasada 2: blindar allí donde la tabla YA existe, la creara quien la creara ─
  header("Pasada 2 — schemas con tabla `form_submissions` (índices y defaults)");
  const { schemas: conTabla } = await byTable(s, TABLA_SUBMISSIONS);
  if (conTabla.length === 0) log("· Ninguno.");
  for (const schema of conTabla) {
    try {
      await s.transaction(async (t) => {
        await blindar(s, schema, t);
      });
      log(`✓ ${schema}: índices, defaults y CHECK al día`);
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
