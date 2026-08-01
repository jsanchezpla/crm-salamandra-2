/**
 * migrate-client-communication-prefs.js — consentimiento de COMUNICACIONES de
 * la familia (01/08/2026).
 *
 * Añade `clients.communication_prefs` (JSONB): por qué canales quiere la
 * familia que se le escriba y si acepta novedades del centro, con la traza de
 * CUÁNDO y DESDE DÓNDE lo aceptó.
 *
 * ── POR QUÉ EN EL CLIENTE Y NO EN EL PACIENTE ───────────────────────────────
 * Los consentimientos que ya había (`patients.consents`: imágenes, publicidad,
 * WhatsApp) son del NIÑO: hablan de qué se puede hacer con él. Este es de quien
 * RECIBE los mensajes, que es la familia — y el área privada es de la familia,
 * no del paciente. Con dos hermanos en el centro, el teléfono es uno y la
 * respuesta es una: guardarlo por paciente obligaría a preguntar dos veces lo
 * mismo y a decidir qué hacer si contestan distinto.
 *
 * `patients.consents.whatsapp` se mantiene y sigue mandando cuando existe: un
 * NO explícito de la ficha del paciente veta igual (lo comprueba
 * lib/citas/avisosWhatsapp.js). Esta columna es la que rellena la familia.
 *
 * Aditiva y idempotente: ADD COLUMN IF NOT EXISTS sobre los schemas que tengan
 * tabla `clients`. Se puede relanzar sin miedo.
 *
 * Uso:
 *   node --env-file=.env.local scripts/migrate-client-communication-prefs.js
 *   docker exec crm-salamandra-app-1 node scripts/migrate-client-communication-prefs.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: consentimiento de comunicaciones de la familia\n");
  process.stdout.write("══════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  try {
    header("Buscando schemas con tabla `clients`…");
    const { schemas, skipped } = await byTable(s, "clients");
    if (schemas.length === 0) {
      log("· Ningún schema tiene tabla clients. Nada que hacer.");
      await s.close();
      return;
    }
    log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
    if (skipped.length) log(`· sin tabla clients, se omiten: ${skipped.join(", ")}`);

    header("Añadiendo columna…");
    await s.transaction(async (t) => {
      for (const schema of schemas) {
        await s.query(
          `ALTER TABLE "${schema}"."clients" ADD COLUMN IF NOT EXISTS "communication_prefs" JSONB NOT NULL DEFAULT '{}'::jsonb`,
          { transaction: t }
        );
        log(`✓ ${schema}.clients.communication_prefs`);
      }
    });

    header("Comprobación final…");
    let fallos = 0;
    for (const schema of schemas) {
      const [rows] = await s.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'clients' AND column_name = 'communication_prefs'`,
        { bind: [schema] }
      );
      if (rows.length === 0) {
        log(`✗ ${schema}: la columna NO está`);
        fallos++;
      }
    }
    if (fallos > 0) {
      process.stderr.write(`\n✗ ${fallos} schemas sin la columna. NO desplegar.\n\n`);
      await s.close();
      process.exit(1);
    }
    log("✓ todo en su sitio");
    process.stdout.write("\n✓ Migración completada\n\n");
    await s.close();
  } catch (err) {
    process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
    await s.close();
    process.exit(1);
  }
}

main();
