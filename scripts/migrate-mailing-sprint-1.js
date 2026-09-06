/**
 * migrate-mailing-sprint-1.js — crea las tablas del módulo Mailing (email
 * marketing por Amazon SES) en los tenants que tienen el módulo `mailing`
 * ACTIVO en master.tenant_modules.
 *
 * Siete tablas (plan del módulo, 23/08/2026, apartado 2.1):
 *   mailing_contacts      correos sueltos (los que no son de ninguna ficha)
 *   mailing_segments      grupos de destinatarios definidos por reglas
 *   mailing_campaigns     el correo: asunto, preheader, bloques, estado
 *   mailing_sends         una fila por destinatario y campaña (UNIQUE)
 *   mailing_suppressions  de aquí no sale nadie nunca más
 *   mailing_templates     firmas y campañas guardadas como plantilla
 *   mailing_events        cada clic y cada apertura
 *
 * Patrón: `byModule` (regla #12: lee los schemas de master en tiempo de
 * ejecución, sin filtrar por status; una demo con el módulo arrastra su foto
 * dorada), transacción POR TENANT, idempotente (IF NOT EXISTS + comprobaciones)
 * y aditiva. Sin FK a otras tablas del CRM: `origen_id` de mailing_sends es
 * referencia blanda (la ficha o el contacto pueden borrarse y el histórico del
 * envío tiene que quedarse).
 *
 * Uso:
 *   npm run db:migrate:mailing          (local)
 *   docker exec crm-salamandra-app-1 node scripts/migrate-mailing-sprint-1.js   (VPS)
 */

import { Sequelize } from "sequelize";
import { byModule } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}

async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}

async function crearSiFalta(s, t, schema, tabla, sql, r) {
  if (await tableExists(s, t, schema, tabla)) {
    r[tabla] = "ya existía";
    return;
  }
  await s.query(sql, { transaction: t });
  r[tabla] = "creada";
}

async function processSchemaInTx(s, t, schema, uuidDefault) {
  const r = { tenant: schema.replace(/^crm_/, "") };
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;

  await crearSiFalta(s, t, schema, "mailing_contacts", `
    CREATE TABLE "${schema}"."mailing_contacts" (
      ${idCol},
      email VARCHAR(255) NOT NULL,
      nombre VARCHAR(160),
      origen VARCHAR(40) NOT NULL DEFAULT 'manual',
      consentimiento JSONB NOT NULL DEFAULT '{}'::jsonb,
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      confirmado_at TIMESTAMPTZ,
      confirmacion_enviada_at TIMESTAMPTZ,
      notas TEXT,
      created_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`, r);
  await s.query(`CREATE UNIQUE INDEX IF NOT EXISTS "mailing_contacts_email_uq" ON "${schema}"."mailing_contacts" (email)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_contacts_estado_idx" ON "${schema}"."mailing_contacts" (estado)`, { transaction: t });

  await crearSiFalta(s, t, schema, "mailing_segments", `
    CREATE TABLE "${schema}"."mailing_segments" (
      ${idCol},
      nombre VARCHAR(120) NOT NULL,
      descripcion TEXT,
      reglas JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`, r);
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_segments_nombre_idx" ON "${schema}"."mailing_segments" (nombre)`, { transaction: t });

  await crearSiFalta(s, t, schema, "mailing_campaigns", `
    CREATE TABLE "${schema}"."mailing_campaigns" (
      ${idCol},
      nombre VARCHAR(160) NOT NULL,
      asunto VARCHAR(200),
      preheader VARCHAR(200),
      bloques JSONB NOT NULL DEFAULT '[]'::jsonb,
      audiencia VARCHAR(20) NOT NULL DEFAULT 'todos',
      segment_id UUID REFERENCES "${schema}"."mailing_segments"(id) ON DELETE SET NULL,
      reply_to VARCHAR(255),
      estado VARCHAR(20) NOT NULL DEFAULT 'borrador',
      programada_para TIMESTAMPTZ,
      empezada_at TIMESTAMPTZ,
      terminada_at TIMESTAMPTZ,
      total_destinatarios INTEGER NOT NULL DEFAULT 0,
      enviados INTEGER NOT NULL DEFAULT 0,
      fallidos INTEGER NOT NULL DEFAULT 0,
      suprimidos INTEGER NOT NULL DEFAULT 0,
      ultimo_error TEXT,
      created_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`, r);
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_campaigns_estado_idx" ON "${schema}"."mailing_campaigns" (estado)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_campaigns_programada_idx" ON "${schema}"."mailing_campaigns" (programada_para)`, { transaction: t });

  await crearSiFalta(s, t, schema, "mailing_sends", `
    CREATE TABLE "${schema}"."mailing_sends" (
      ${idCol},
      campaign_id UUID NOT NULL REFERENCES "${schema}"."mailing_campaigns"(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      nombre VARCHAR(160),
      origen VARCHAR(20) NOT NULL DEFAULT 'cliente',
      origen_id UUID,
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      intentos INTEGER NOT NULL DEFAULT 0,
      ses_message_id VARCHAR(120),
      error TEXT,
      enviado_at TIMESTAMPTZ,
      abierto_at TIMESTAMPTZ,
      primer_clic_at TIMESTAMPTZ,
      aperturas INTEGER NOT NULL DEFAULT 0,
      clics INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`, r);
  await s.query(`CREATE UNIQUE INDEX IF NOT EXISTS "mailing_sends_campaign_email_uq" ON "${schema}"."mailing_sends" (campaign_id, email)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_sends_campaign_estado_idx" ON "${schema}"."mailing_sends" (campaign_id, estado)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_sends_ses_message_id_idx" ON "${schema}"."mailing_sends" (ses_message_id)`, { transaction: t });

  await crearSiFalta(s, t, schema, "mailing_suppressions", `
    CREATE TABLE "${schema}"."mailing_suppressions" (
      ${idCol},
      email VARCHAR(255) NOT NULL,
      motivo VARCHAR(20) NOT NULL,
      detalle TEXT,
      campaign_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`, r);
  await s.query(`CREATE UNIQUE INDEX IF NOT EXISTS "mailing_suppressions_email_uq" ON "${schema}"."mailing_suppressions" (email)`, { transaction: t });

  await crearSiFalta(s, t, schema, "mailing_templates", `
    CREATE TABLE "${schema}"."mailing_templates" (
      ${idCol},
      nombre VARCHAR(120) NOT NULL,
      tipo VARCHAR(20) NOT NULL DEFAULT 'campana',
      asunto VARCHAR(200),
      preheader VARCHAR(200),
      bloques JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`, r);
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_templates_tipo_idx" ON "${schema}"."mailing_templates" (tipo)`, { transaction: t });

  await crearSiFalta(s, t, schema, "mailing_events", `
    CREATE TABLE "${schema}"."mailing_events" (
      ${idCol},
      send_id UUID NOT NULL REFERENCES "${schema}"."mailing_sends"(id) ON DELETE CASCADE,
      campaign_id UUID NOT NULL,
      tipo VARCHAR(20) NOT NULL,
      url TEXT,
      indice INTEGER,
      user_agent VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`, r);
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_events_campaign_tipo_idx" ON "${schema}"."mailing_events" (campaign_id, tipo)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_events_send_idx" ON "${schema}"."mailing_events" (send_id)`, { transaction: t });

  return r;
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: módulo Mailing (sprint 1) — siete tablas\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const uuidDefault = await ensureUuidFn(s);

  const { schemas } = await byModule(s, "mailing");
  if (schemas.length === 0) {
    log("· Ningún tenant tiene el módulo `mailing` activo. Nada que hacer.");
    await s.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schema(s): ${schemas.join(", ")}`);

  const resultados = [];
  for (const schema of schemas) {
    header(`Schema ${schema}`);
    try {
      const r = await s.transaction((t) => processSchemaInTx(s, t, schema, uuidDefault));
      for (const [tabla, estado] of Object.entries(r)) if (tabla !== "tenant") log(`${estado === "creada" ? "✓" : "·"} ${tabla}: ${estado}`);
      resultados.push(r);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write(`\n✓ Migración completada en ${resultados.length} de ${schemas.length} schema(s)\n\n`);
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
