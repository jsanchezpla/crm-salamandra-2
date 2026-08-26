/**
 * migrate-informe-beca.js
 *
 * Añade el valor 'beca' al enum de tipos de informe clínico
 * (`enum_clinical_reports_report_type`) en cada schema que tenga la tabla.
 *
 * ── POR QUÉ (26/08/2026, lo pidió Aumenta) ─────────────────────────────────
 * Cada curso, las familias piden al centro un informe para la beca de apoyo
 * educativo (NEAE). Ese informe tiene su propia forma: la cabecera del PDF
 * lleva el servicio con el NOMBRE OFICIAL de la convocatoria («Reeducación del
 * lenguaje» en vez de logopedia; «Reeducación pedagógica y habilidades
 * sociales» en vez de psicología, terapia ocupacional o pedagogía), solo tres
 * apartados (motivo de consulta, objetivos y metodología) y la firma del
 * terapeuta. La regla vive en lib/clinica/beca.js; aquí solo se da de alta el
 * tipo en la base.
 *
 * Los apartados nuevos NO piden migración: `contentSections` es JSONB.
 *
 * Selecciona los schemas por EXISTENCIA de la tabla `clinical_reports`, no por
 * módulo (scripts/_schema-targets.js). `ADD VALUE IF NOT EXISTS` en AUTOCOMMIT
 * (sin transacción), como migrate-billing-rework.js: en PG un valor de enum
 * añadido dentro de una transacción no se puede usar en esa misma sesión, y en
 * PG <12 ni siquiera es transaccional. Idempotente: relanzarlo no hace nada.
 *
 * ⚠️ VA ANTES DEL DESPLIEGUE: el modelo pasa a declarar 'beca' en el ENUM y la
 * UI lo ofrece al crear; con el código por delante del valor, crear un informe
 * de beca reventaría con «invalid input value for enum».
 *
 * ⚠️ FOTOS DORADAS: los schemas `crm_demo*_golden` no están en master.tenants
 * y este script no los toca. Se les añade con
 *   EXTRA_SCHEMAS=crm_demo_golden,crm_demo_clinica_golden,... node scripts/migrate-informe-beca.js
 * o quedan pendientes de la siguiente foto (ya hay una tarea en el Registro por
 * la columna fiscal_snapshot del mismo día).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-informe-beca.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-informe-beca.js
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
  // AUTOCOMMIT a propósito (ver cabecera): nada de transaction() aquí.
  await s.query(
    `ALTER TYPE "${schema}"."enum_clinical_reports_report_type" ADD VALUE IF NOT EXISTS 'beca'`
  );
  const [[n]] = await s.query(
    `SELECT count(*)::int AS informes FROM "${schema}"."clinical_reports"`
  );
  return n;
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: el informe para la beca (NEAE) existe\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  header("Schemas con tabla `clinical_reports`...");
  const { schemas, skipped } = await byTable(sequelize, "clinical_reports");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla clinical_reports. Nada que hacer.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
  if (skipped.length) log(`· sin tabla clinical_reports, se omiten: ${skipped.join(", ")}`);

  header("Añadiendo el tipo 'beca' al enum...");
  for (const schema of schemas) {
    try {
      const n = await processSchema(sequelize, schema);
      log(`✓ ${schema}: tipo listo · ${n.informes} informe(s) existentes, ninguno tocado`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("   (solo añade el tipo al enum: no cambia ni una fila)\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
