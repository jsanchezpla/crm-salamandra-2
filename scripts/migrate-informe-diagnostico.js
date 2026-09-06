/**
 * migrate-informe-diagnostico.js
 *
 * Añade el valor 'diagnostico' al enum de tipos de informe clínico
 * (`enum_clinical_reports_report_type`) en cada schema que tenga la tabla.
 *
 * ── POR QUÉ (05/09/2026, AV-0045 de Aumenta; Rodrigo: «haz ambos») ────────
 * El centro hace valoraciones diagnósticas con un guion fijo —anamnesis,
 * pruebas administradas con sus puntuaciones, integración clínica, conclusión
 * con DSM-5-TR y CIE-11, plan de intervención— y las escribía como «Evolutivo»
 * con apartados sueltos. Con su tipo propio se elige al crearlo, sale con su
 * plantilla de 25 apartados puesta (`lib/clinica/pruebasDiagnosticas.js`) y
 * con el bloque de pruebas, y el PDF se titula «Informe de valoración
 * diagnóstica».
 *
 * La plantilla y el catálogo de pruebas NO piden migración: la plantilla es de
 * fábrica en el código y lo escrito va en `contentSections` (JSONB).
 *
 * Mismo patrón que migrate-informe-asesoramiento.js: schemas por EXISTENCIA de
 * la tabla, `ADD VALUE IF NOT EXISTS` en AUTOCOMMIT, idempotente.
 *
 * ⚠️ VA ANTES DEL DESPLIEGUE: el modelo pasa a declarar 'diagnostico' en el
 * ENUM y la UI lo ofrece al crear; con el código por delante del valor, crear
 * uno reventaría con «invalid input value for enum».
 *
 * FOTOS DORADAS: el `✗ no existe el tipo …` de `crm_demo_x_golden` es NORMAL
 * (su columna apunta al enum del schema vivo). Ver migrate-informe-asesoramiento.js.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-informe-diagnostico.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-informe-diagnostico.js
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
    `ALTER TYPE "${schema}"."enum_clinical_reports_report_type" ADD VALUE IF NOT EXISTS 'diagnostico'`
  );
  const [[n]] = await s.query(
    `SELECT count(*)::int AS informes FROM "${schema}"."clinical_reports"`
  );
  return n;
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: el informe de valoración diagnóstica existe\n");
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

  header("Añadiendo el tipo 'diagnostico' al enum...");
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
