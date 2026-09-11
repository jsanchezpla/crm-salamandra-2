/**
 * migrate-ai-uso.js — crea `master.ai_uso`, la contabilidad de la IA
 * (11/09/2026): una fila por llamada a Claude o a Whisper, con tokens, coste
 * estimado y a qué acción del CRM correspondía.
 *
 * DE QUÉ NACE: Aumenta se quedó sin saldo de Anthropic a los diez días y no
 * había manera de saber en qué se había ido; `master.audit_logs` contaba
 * intentos, no tokens ni dinero. Ver `lib/ai/usoDeIA.js`.
 *
 * OJO: opera sobre el schema MASTER, no sobre los crm_* — por eso NO va en
 * CORE/MODULES (ese registro corre por-tenant) sino en ONE_OFF. Aditiva e
 * idempotente. El código que escribe en la tabla es best-effort: si la tabla
 * no está, avisa por consola y la llamada a la IA sigue igual, así que puede
 * correr antes o después del despliegue (mejor antes, para no perder filas).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-ai-uso.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-ai-uso.js
 */

import { Sequelize } from "sequelize";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });
  try { await s.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`); } catch { /* sin permiso */ }

  await s.query(`
    CREATE TABLE IF NOT EXISTS master.ai_uso (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id          UUID,
      user_id            UUID,
      proveedor          VARCHAR(20) NOT NULL,
      modelo             VARCHAR(80),
      accion             VARCHAR(200),
      input_tokens       INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens      INTEGER NOT NULL DEFAULT 0,
      segundos_audio     INTEGER NOT NULL DEFAULT 0,
      coste_usd          NUMERIC(10,6),
      ms                 INTEGER,
      parada             VARCHAR(40),
      cacheado           BOOLEAN NOT NULL DEFAULT false,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  process.stdout.write("✓ master.ai_uso\n");

  await s.query(`
    CREATE INDEX IF NOT EXISTS ai_uso_tenant_created_idx
    ON master.ai_uso (tenant_id, created_at DESC)
  `);
  process.stdout.write("✓ índice (tenant_id, created_at DESC)\n");

  await s.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
