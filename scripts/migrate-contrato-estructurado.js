/**
 * migrate-contrato-estructurado.js
 *
 * El contrato del portal deja de ser «un PDF y un garabato».
 *
 * Hasta hoy firmar en el área privada era dibujar una raya: no se le pedía
 * NINGÚN dato a quien firmaba. El contrato de tunutrilaura pide ocho (nombre,
 * DNI, domicilio, correo, teléfono, fecha de nacimiento, localidad y fecha de
 * la firma) y sus tres anexos dicen literalmente que «se firman de forma
 * independiente al documento principal», así que hace falta una aceptación por
 * anexo. Y encima hay un segundo documento —el consentimiento parental— que
 * solo aplica cuando la destinataria es menor.
 *
 * Qué hace:
 *   1. Crea `contract_templates`: el clausulado vive en BASE DE DATOS, por
 *      cliente. En el código no puede estar: el módulo lo comparten Aumenta y
 *      Laura, y el clausulado de TCA de Laura le saldría a Aumenta en su portal.
 *   2. Amplía `contract_signatures` con lo que se declaró, lo que se aceptó y
 *      el PDF generado.
 *   3. REHACE el índice único: era (client_id, guardian_id) y con dos
 *      documentos el segundo chocaba con el primero. Pasa a llevar
 *      `template_key`, para que el mismo tutor pueda firmar los dos.
 *
 * Las firmas que ya existen se quedan como `template_key = 'simple'`: el
 * contrato de siempre, el de Aumenta, que sigue funcionando igual.
 *
 * Ni un solo slug a mano: las dos pasadas leen `master.tenants` en tiempo de
 * ejecución. Aditiva e idempotente: se puede lanzar cien veces.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-contrato-estructurado.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-contrato-estructurado.js
 */

import { Sequelize } from "sequelize";
import { byModule, byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const PLANTILLAS = "contract_templates";
const FIRMAS = "contract_signatures";

async function crearPlantillas(s, schema, t) {
  await s.query(
    `CREATE TABLE IF NOT EXISTS "${schema}"."${PLANTILLAS}" (
       id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       key                     VARCHAR(50) NOT NULL,
       title                   VARCHAR(200) NOT NULL,
       intro                   TEXT,
       fields                  JSONB NOT NULL DEFAULT '[]'::jsonb,
       blocks                  JSONB NOT NULL DEFAULT '[]'::jsonb,
       footer                  VARCHAR(300),
       only_minors             BOOLEAN NOT NULL DEFAULT false,
       second_signature_label  VARCHAR(200),
       active                  BOOLEAN NOT NULL DEFAULT true,
       version                 INTEGER NOT NULL DEFAULT 1,
       created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction: t }
  );
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS contract_templates_key_unique
       ON "${schema}"."${PLANTILLAS}" (key)`,
    { transaction: t }
  );
}

async function ampliarFirmas(s, schema, t) {
  // 1) La columna que identifica QUÉ se firmó. Se añade sin NOT NULL para no
  //    reventar con las filas que ya hay, se rellenan, y luego se blinda.
  await s.query(
    `ALTER TABLE "${schema}"."${FIRMAS}"
       ADD COLUMN IF NOT EXISTS template_key           VARCHAR(50),
       ADD COLUMN IF NOT EXISTS template_version       INTEGER,
       ADD COLUMN IF NOT EXISTS signer_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
       ADD COLUMN IF NOT EXISTS acceptances            JSONB NOT NULL DEFAULT '[]'::jsonb,
       ADD COLUMN IF NOT EXISTS second_signature_path  VARCHAR(500),
       ADD COLUMN IF NOT EXISTS document_id            UUID`,
    { transaction: t }
  );

  // 2) Lo firmado antes del 04/08/2026 es el contrato de siempre.
  await s.query(
    `UPDATE "${schema}"."${FIRMAS}" SET template_key = 'simple' WHERE template_key IS NULL`,
    { transaction: t }
  );
  await s.query(
    `ALTER TABLE "${schema}"."${FIRMAS}"
       ALTER COLUMN template_key SET DEFAULT 'simple',
       ALTER COLUMN template_key SET NOT NULL`,
    { transaction: t }
  );

  // 3) El índice único, ahora con el documento dentro. El NOT NULL de arriba es
  //    imprescindible: en Postgres dos NULL no colisionan, así que con la
  //    columna nullable el índice dejaría colar firmas duplicadas del mismo
  //    documento — justo lo que tiene que impedir.
  await s.query(`DROP INDEX IF EXISTS "${schema}".contract_signatures_unique`, { transaction: t });
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS contract_signatures_unique
       ON "${schema}"."${FIRMAS}" (client_id, guardian_id, template_key)`,
    { transaction: t }
  );

  // Borrar el PDF generado NO borra la firma: la firma vale por los datos, el
  // clausulado y la traza que guarda la propia fila, no por el fichero.
  await s.query(
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = '${schema}' AND table_name = 'documents')
          AND NOT EXISTS (SELECT 1 FROM pg_constraint
                           WHERE conname = 'contract_signatures_document_fk'
                             AND connamespace = '${schema}'::regnamespace)
       THEN
         ALTER TABLE "${schema}"."${FIRMAS}"
           ADD CONSTRAINT contract_signatures_document_fk
           FOREIGN KEY (document_id) REFERENCES "${schema}"."documents"(id)
           ON DELETE SET NULL;
       END IF;
     END $$;`,
    { transaction: t }
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Contrato del portal: datos, anexos y consentimiento\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  header("Pasada 1 — schemas con el módulo `citas` activo (crear plantillas)");
  const { schemas: conModulo } = await byModule(s, "citas");
  if (conModulo.length === 0) log("· Ninguno todavía. Se creará cuando algún tenant tenga citas.");
  for (const schema of conModulo) {
    try {
      await s.transaction(async (t) => { await crearPlantillas(s, schema, t); });
      log(`✓ ${schema}: tabla de plantillas creada o ya existente`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  header(`Pasada 2 — schemas con \`${FIRMAS}\` (columnas nuevas e índice único)`);
  const { schemas: conTabla } = await byTable(s, FIRMAS);
  if (conTabla.length === 0) log("· Ninguno.");
  for (const schema of conTabla) {
    try {
      await s.transaction(async (t) => { await ampliarFirmas(s, schema, t); });
      log(`✓ ${schema}: firmas ampliadas e índice rehecho`);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Migración completada\n");
  process.stdout.write("   El clausulado se carga aparte, por cliente:\n");
  process.stdout.write("   node scripts/seed-contrato-tunutrilaura.js\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
