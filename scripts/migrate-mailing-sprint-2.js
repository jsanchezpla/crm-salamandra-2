/**
 * migrate-mailing-sprint-2.js — el sprint 2 del módulo Mailing (06/09/2026):
 * secuencias por eventos del CRM, A/B de asunto y envío escalonado.
 *
 * Sobre las tablas del sprint 1 (migrate-mailing-sprint-1):
 *   mailing_campaigns  + asunto_b, ab_porcentaje, ab_espera_horas, ab_ganador,
 *                        ab_decidido_at (A/B de asunto), ritmo_por_hora (envío
 *                        escalonado), tipo, sequence_id, periodo (las campañas
 *                        AUTOMÁTICAS que genera una secuencia: una por periodo)
 *   mailing_sends      + variante ('a' | 'b' | NULL)
 * Y una tabla nueva:
 *   mailing_sequences  las secuencias: evento, días, hora, contenido, activa
 *
 * `byModule` (regla #12), transacción por tenant, aditiva e idempotente
 * (comprueba cada columna antes de añadirla). En un schema sin las tablas del
 * sprint 1 no hace nada: las crea la otra migración y el orden lo deduce
 * `_migration-order.js` del propio SQL (ALTER sobre lo que la 1 crea).
 *
 * Uso:
 *   npm run db:migrate:mailing-2          (local)
 *   docker exec crm-salamandra-app-1 node scripts/migrate-mailing-sprint-2.js   (VPS)
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
async function columnExists(s, t, schema, table, column) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    { bind: [schema, table, column], transaction: t }
  );
  return rows.length > 0;
}
async function ensureUuidFn(s) {
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }
  try { await s.query(`SELECT gen_random_uuid()`); return true; } catch { return false; }
}
async function addColumn(s, t, schema, table, column, ddl, r) {
  if (await columnExists(s, t, schema, table, column)) {
    r[`${table}.${column}`] = "ya existía";
    return;
  }
  await s.query(`ALTER TABLE "${schema}"."${table}" ADD COLUMN ${column} ${ddl}`, { transaction: t });
  r[`${table}.${column}`] = "añadida";
}

async function processSchemaInTx(s, t, schema, uuidDefault) {
  const r = { tenant: schema.replace(/^crm_/, "") };
  if (!(await tableExists(s, t, schema, "mailing_campaigns"))) {
    r.aviso = "sin tablas del sprint 1: nada que hacer";
    return r;
  }
  const idCol = `id UUID PRIMARY KEY${uuidDefault ? " DEFAULT gen_random_uuid()" : ""}`;

  // ── Secuencias ────────────────────────────────────────────────────────────
  if (!(await tableExists(s, t, schema, "mailing_sequences"))) {
    await s.query(
      `CREATE TABLE "${schema}"."mailing_sequences" (
        ${idCol},
        nombre VARCHAR(160) NOT NULL,
        evento VARCHAR(30) NOT NULL,
        activa BOOLEAN NOT NULL DEFAULT false,
        activada_desde TIMESTAMPTZ,
        dias INTEGER NOT NULL DEFAULT 1,
        hora INTEGER NOT NULL DEFAULT 10,
        asunto VARCHAR(200),
        preheader VARCHAR(200),
        bloques JSONB NOT NULL DEFAULT '[]'::jsonb,
        reply_to VARCHAR(255),
        created_by VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      { transaction: t }
    );
    r.mailing_sequences = "creada";
  } else {
    r.mailing_sequences = "ya existía";
  }
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_sequences_activa_idx" ON "${schema}"."mailing_sequences" (activa, evento)`, { transaction: t });

  // ── Campañas: A/B, ritmo y el enlace con su secuencia ─────────────────────
  await addColumn(s, t, schema, "mailing_campaigns", "asunto_b", "VARCHAR(200)", r);
  await addColumn(s, t, schema, "mailing_campaigns", "ab_porcentaje", "INTEGER", r);
  await addColumn(s, t, schema, "mailing_campaigns", "ab_espera_horas", "INTEGER", r);
  await addColumn(s, t, schema, "mailing_campaigns", "ab_ganador", "VARCHAR(1)", r);
  await addColumn(s, t, schema, "mailing_campaigns", "ab_decidido_at", "TIMESTAMPTZ", r);
  await addColumn(s, t, schema, "mailing_campaigns", "ritmo_por_hora", "INTEGER", r);
  await addColumn(s, t, schema, "mailing_campaigns", "tipo", "VARCHAR(20) NOT NULL DEFAULT 'campana'", r);
  await addColumn(s, t, schema, "mailing_campaigns", "sequence_id", `UUID REFERENCES "${schema}"."mailing_sequences"(id) ON DELETE CASCADE`, r);
  await addColumn(s, t, schema, "mailing_campaigns", "periodo", "VARCHAR(20)", r);
  // Una campaña automática por secuencia y periodo: es lo que impide que dos
  // pasadas del temporizador a la vez creen dos contenedores para el mismo día.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "mailing_campaigns_sequence_periodo_uq" ON "${schema}"."mailing_campaigns" (sequence_id, periodo) WHERE sequence_id IS NOT NULL`,
    { transaction: t }
  );
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_campaigns_tipo_idx" ON "${schema}"."mailing_campaigns" (tipo)`, { transaction: t });

  // ── Envíos: la variante del A/B, y un índice para el ritmo por hora ──────
  await addColumn(s, t, schema, "mailing_sends", "variante", "VARCHAR(1)", r);
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_sends_campaign_enviado_idx" ON "${schema}"."mailing_sends" (campaign_id, enviado_at)`, { transaction: t });
  await s.query(`CREATE INDEX IF NOT EXISTS "mailing_sends_origen_idx" ON "${schema}"."mailing_sends" (origen_id)`, { transaction: t });

  return r;
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: módulo Mailing (sprint 2) — secuencias, A/B y ritmo\n");
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

  let hechos = 0;
  for (const schema of schemas) {
    header(`Schema ${schema}`);
    try {
      const r = await s.transaction((t) => processSchemaInTx(s, t, schema, uuidDefault));
      for (const [k, v] of Object.entries(r)) if (k !== "tenant") log(`${/creada|añadida/.test(v) ? "✓" : "·"} ${k}: ${v}`);
      hechos++;
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write(`\n✓ Migración completada en ${hechos} de ${schemas.length} schema(s)\n\n`);
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
