/**
 * migrate-informe-asesoramiento.js
 *
 * Añade el valor 'asesoramiento' al enum de tipos de informe clínico
 * (`enum_clinical_reports_report_type`) en cada schema que tenga la tabla.
 *
 * ── POR QUÉ (04/09/2026, lo pidió Aumenta por Rodrigo) ─────────────────────
 * El centro ya da —y cobra— sesiones de asesoramiento, y el informe que sale
 * de ellas no es un evolutivo ni un alta ni una derivación: se guardaba como
 * «Evolutivo» y luego nadie lo distinguía en la lista. Con su tipo propio se
 * elige al crearlo, se ve de un vistazo en Informes y el PDF se titula
 * «Informe de asesoramiento» en la portada.
 *
 * Sus APARTADOS no se escriben en el código: los pone el centro con sus
 * plantillas (`lib/clinica/plantillas.js`), como el evolutivo y los demás. La
 * beca es la única excepción y lo es por un motivo que aquí no se da: allí los
 * apartados los manda la convocatoria del Ministerio.
 *
 * Los apartados nuevos NO piden migración: `contentSections` es JSONB.
 *
 * Selecciona los schemas por EXISTENCIA de la tabla `clinical_reports`, no por
 * módulo (scripts/_schema-targets.js). `ADD VALUE IF NOT EXISTS` en AUTOCOMMIT
 * (sin transacción), igual que migrate-informe-beca.js: en PG un valor de enum
 * añadido dentro de una transacción no se puede usar en esa misma sesión, y en
 * PG <12 ni siquiera es transaccional. Idempotente: relanzarlo no hace nada.
 *
 * ⚠️ VA ANTES DEL DESPLIEGUE: el modelo pasa a declarar 'asesoramiento' en el
 * ENUM y la UI lo ofrece al crear; con el código por delante del valor, crear
 * un informe de asesoramiento reventaría con «invalid input value for enum».
 *
 * FOTOS DORADAS: `byTable` las incluye desde el 29/08/2026, y ahí este script
 * imprime un `✗ no existe el tipo …` que es NORMAL y no hay que arreglar: la
 * columna `report_type` de `crm_demo_x_golden` apunta al enum del schema VIVO
 * (`udt_schema = crm_demo_x`), así que al añadirle el valor al vivo la foto
 * queda cubierta. Comprobado en local el 04/09/2026.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-informe-asesoramiento.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-informe-asesoramiento.js
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
    `ALTER TYPE "${schema}"."enum_clinical_reports_report_type" ADD VALUE IF NOT EXISTS 'asesoramiento'`
  );
  const [[n]] = await s.query(
    `SELECT count(*)::int AS informes FROM "${schema}"."clinical_reports"`
  );
  return n;
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: el informe de asesoramiento existe\n");
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

  header("Añadiendo el tipo 'asesoramiento' al enum...");
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
