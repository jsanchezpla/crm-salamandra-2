/**
 * migrate-invoice-fiscal-snapshot.js
 *
 * Añade a facturación:
 *   - invoices.fiscal_snapshot (JSONB, nullable) — a quién se le emitió esta
 *     factura, CONGELADO el día que se emitió: razón social, NIF/CIF,
 *     dirección, CP, ciudad y país.
 *
 * ── POR QUÉ (26/08/2026) ───────────────────────────────────────────────────
 * Hasta hoy una factura no guardaba ni un dato fiscal propio: el nombre, el NIF
 * y la dirección que salen impresos se leían de la ficha del cliente CADA VEZ
 * que se generaba el PDF o el libro de IVA. O sea que corregir el NIF de una
 * familia cambiaba, hacia atrás y en silencio, todas sus facturas ya emitidas:
 * el PDF que se reimprimiera diría algo distinto del que se entregó, y el libro
 * de IVA de un ejercicio cerrado cambiaría al mirarlo. En Aumenta son 14.243
 * facturas emitidas colgando de la ficha actual.
 *
 * ⚠️ NULLABLE Y SIN RELLENAR, A PROPÓSITO. Las facturas que ya existen se
 * quedan sin foto y siguen leyendo del cliente vivo, como hasta hoy. Rellenarlas
 * con los datos de HOY sería peor que no tener foto: estamparía como «lo que
 * decía la factura de 2022» algo que quizá se corrigió en 2025, y encima con
 * apariencia de dato bueno. La foto solo la pone quien la puede saber: la
 * emisión.
 *
 * Selecciona los schemas por EXISTENCIA de la tabla `invoices`, no por módulo
 * (ver scripts/_schema-targets.js). Idempotente (ADD COLUMN IF NOT EXISTS), por
 * schema independiente. Nombre snake_case = el que generaría sequelize.sync().
 *
 * ⚠️ VA ANTES DEL DESPLIEGUE: el modelo pasa a declarar `fiscalSnapshot`, y
 * Sequelize pide las columnas por nombre, así que el código nuevo por delante de
 * la columna daría 42703 en cada lectura de factura.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-invoice-fiscal-snapshot.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-invoice-fiscal-snapshot.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

async function processSchema(s, schema) {
  await s.transaction(async (t) => {
    await s.query(
      `ALTER TABLE "${schema}"."invoices"
         ADD COLUMN IF NOT EXISTS fiscal_snapshot JSONB`,
      { transaction: t }
    );
  });
  const [[n]] = await s.query(
    `SELECT count(*)::int AS total, count(fiscal_snapshot)::int AS con_foto
       FROM "${schema}"."invoices"`
  );
  return n;
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: la factura guarda a quién se le emitió\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  header("Schemas con tabla `invoices`...");
  const { schemas, skipped } = await byTable(sequelize, "invoices");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla invoices. Nada que hacer.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla invoices, se omiten: ${skipped.join(", ")}`);

  header("Añadiendo la columna...");
  for (const schema of schemas) {
    try {
      const n = await processSchema(sequelize, schema);
      log(`✓ ${schema}: columna lista · ${n.total} factura(s), ${n.con_foto} con foto`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("   (las facturas viejas se quedan SIN foto a propósito:\n");
  process.stdout.write("    siguen leyendo del cliente, como hasta hoy)\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
