/**
 * migrate-patients-terapeutas.js
 *
 * Crea `patient_therapists`: la lista de quién lleva a cada paciente, ahora que
 * pueden ser varios (Lau, Aumenta, 14/08/2026 — «en los pacientes que tienen dos
 * terapias, cómo meter a los 2 terapeutas»).
 *
 *   - Tabla nueva por schema que TENGA `patients`.
 *   - UNIQUE (patient_id, team_member_id): una persona, una fila.
 *   - Índice por team_member_id: «¿qué pacientes lleva esta persona?».
 *   - FK a patients ON DELETE CASCADE y a team_members ON DELETE CASCADE.
 *
 * ⚠️ NO RELLENA NADA. Es estructura pura: aditiva, idempotente y sin tocar una
 * sola fila. `patients.main_therapist_id` se queda donde está y sigue siendo el
 * terapeuta de referencia; un paciente sin filas aquí se lee como «tiene al de
 * la columna» (`lib/clinica/terapeutas.js`). Por eso esto se puede correr antes
 * o después del despliegue sin que nadie note nada.
 *
 * Copiar los 560 terapeutas que ya hay a la tabla nueva es OTRA cosa, es un
 * cambio de datos y va en `backfill-patients-terapeutas.js`, con su ensayo.
 *
 * ── POR QUÉ ASEGURA LAS FK APARTE ──────────────────────────────────────────
 *
 * Porque `CREATE TABLE IF NOT EXISTS` no basta. El alta de un cliente nuevo
 * (`lib/provisioning/altaTenant.js`) monta el schema con `sequelize.sync()`, y
 * sync crea la tabla a partir del modelo: sin claves ajenas, porque el modelo no
 * declara asociaciones. Un tenant dado de alta después de este despliegue —o una
 * demo rehecha— tendría la tabla sin una sola FK y nadie se enteraría hasta que
 * un borrado dejara filas huérfanas. Así que la migración no decide solo por
 * «¿existe la tabla?»: exista o no, comprueba las dos FK y las pone si faltan.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-patients-terapeutas.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-patients-terapeutas.js
 */

import { Sequelize } from "sequelize";
import { byTable, tableExists } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

/** Pone una FK si no la hay. `duplicate_object` = ya estaba: no es un error. */
async function asegurarFk(s, schema, nombre, columna, tablaDestino) {
  await s.query(
    `DO $$ BEGIN
       ALTER TABLE "${schema}"."patient_therapists"
         ADD CONSTRAINT ${nombre}
         FOREIGN KEY (${columna}) REFERENCES "${schema}"."${tablaDestino}"(id) ON DELETE CASCADE;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
       WHEN undefined_table  THEN NULL;
       WHEN undefined_column THEN NULL;
     END $$;`
  );
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: varios terapeutas por paciente\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // Por EXISTENCIA de tabla y leyendo los slugs de master.tenants: un tenant
  // puede tener el módulo y el schema a medias (incidente del 21/07/2026), y las
  // fotos doradas no son tenants, así que quedan fuera solas.
  const { schemas, skipped } = await byTable(s, "patients");
  if (schemas.length === 0) log("· Ningún schema con tabla patients.");
  if (skipped.length) log(`· Se saltan ${skipped.length} sin patients: ${skipped.join(", ")}`);

  let creadas = 0;
  let yaEstaban = 0;
  for (const schema of schemas) {
    try {
      const existiaAntes = await tableExists(s, schema, "patient_therapists");

      await s.query(
        `CREATE TABLE IF NOT EXISTS "${schema}"."patient_therapists" (
           id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           patient_id     UUID NOT NULL,
           team_member_id UUID NOT NULL,
           specialty      VARCHAR(40),
           assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
           created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
           updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
         )`
      );

      // Los índices y las FK van SIEMPRE, no solo cuando se acaba de crear: si
      // la tabla la puso `sequelize.sync()` en un alta, viene sin ellos.
      await s.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS patient_therapists_unique
           ON "${schema}"."patient_therapists" (patient_id, team_member_id)`
      );
      await s.query(
        `CREATE INDEX IF NOT EXISTS patient_therapists_team_idx
           ON "${schema}"."patient_therapists" (team_member_id)`
      );
      await asegurarFk(s, schema, "patient_therapists_patient_id_fkey", "patient_id", "patients");
      if (await tableExists(s, schema, "team_members")) {
        await asegurarFk(s, schema, "patient_therapists_team_member_id_fkey", "team_member_id", "team_members");
      }

      // `sync()` no pone estos DEFAULT (los genera Sequelize en JS). Sin ellos,
      // el relleno por SQL y cualquier INSERT crudo fallarían.
      await s.query(
        `ALTER TABLE "${schema}"."patient_therapists"
           ALTER COLUMN id SET DEFAULT gen_random_uuid()`
      );
      await s.query(
        `ALTER TABLE "${schema}"."patient_therapists"
           ALTER COLUMN assigned_at SET DEFAULT now()`
      );

      if (existiaAntes) { yaEstaban++; log(`✓ ${schema}: ya estaba — índices y FK repasados`); }
      else { creadas++; log(`✓ ${schema}: patient_therapists creada`); }
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write(`\n ✓ Migración completada — ${creadas} creada(s), ${yaEstaban} repasada(s)\n`);
  process.stdout.write("   No se ha tocado ni una fila. Copiar los terapeutas que ya hay\n");
  process.stdout.write("   a la tabla nueva es aparte: backfill-patients-terapeutas.js\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
