/**
 * migrate-documentos-lecturas.js — el documento que HAY QUE LEER, y el bloqueo
 * al que va aparejado (01/09/2026, Rodrigo).
 *
 * Dos piezas del mismo encargo, en cada schema que tenga `documents`:
 *
 *   1. `documents.team_block_id` UUID NULL — el tramo de la agenda al que está
 *      aparejado el documento («el miércoles 2, en la Reunión de equipo de
 *      12:00 a 13:00»). FK a `team_blocks` ON DELETE **SET NULL**: borrar el
 *      bloqueo quita la pareja, jamás el documento — el acta sigue en el
 *      archivo y puede estar pedida en lectura.
 *   2. tabla `document_reads` — una fila por (documento, persona): a quién se
 *      le pidió leerlo y cuándo lo leyó. FK a `documents` y a `team_members`
 *      ON DELETE **CASCADE**: sin documento no hay nada que leer, y quien deja
 *      el centro no le debe una lectura a nadie.
 *
 * ── POR QUÉ POR TABLA `documents` Y NO POR MÓDULO ──────────────────────────
 * Porque el MODELO `Document` declara `team_block_id` para TODOS los tenants
 * (`lib/db/tenantDb.js` registra los modelos sin gatear por módulo), así que
 * Sequelize la pide por nombre en CUALQUIER SELECT del archivo central: sin la
 * columna, la primera lectura de documentos da 42703, tenga el cliente Citas o
 * no. Es la misma regla que costó el arreglo del 01/09/2026 en
 * `migrate-citas-categorias-bloqueo.js` y la nota de CORE en
 * `_module-migrations.js`: el módulo dice quién puede ENTRAR, no qué forma
 * tiene el schema (regla 12).
 *
 * La TABLA `document_reads` va por el mismo conjunto y por la misma razón: el
 * modelo `DocumentRead` está registrado para todos, y la portada la consulta en
 * cada carga. `byTable` arrastra además las FOTOS DORADAS de las demos: sin
 * ellas, restaurar una demo la devolvería sin esto.
 *
 * ── VA ANTES DEL DESPLIEGUE ─────────────────────────────────────────────────
 * Por lo de arriba: el modelo pide la columna en cada SELECT de documentos.
 *
 * ── LAS FK VAN APARTE Y TOLERANDO EL FALLO ─────────────────────────────────
 * Las fotos doradas (`crm_*_golden`) se copian SIN claves primarias, así que
 * ahí PostgreSQL rechaza el REFERENCES. Con la FK dentro del CREATE TABLE, la
 * migración moriría en la primera dorada y la tabla no llegaría a existir en
 * ninguna (lección de `migrate-taller-sesiones.js`, 01/09/2026).
 *
 * Sin backfill: nada cambia para lo que ya está subido. Los documentos nacen
 * sin bloqueo y sin lecturas pedidas, que es exactamente lo que son hoy.
 *
 * Idempotente (IF NOT EXISTS en todo).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-documentos-lecturas.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-documentos-lecturas.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tablaExiste(s, schema, tabla) {
  const [[{ existe }]] = await s.query(
    `SELECT to_regclass('"${schema}"."${tabla}"') IS NOT NULL AS existe`
  );
  return existe;
}

/**
 * Añade una FK tolerando que no se pueda (dorada sin PK, tabla destino
 * ausente). Devuelve si la restricción quedó puesta, para que el resumen no
 * cante una FK que no existe.
 */
async function fkSuave(s, schema, sql, etiqueta) {
  try {
    await s.query(sql);
    return true;
  } catch (e) {
    if (/ya existe|already exists|duplicate/i.test(e.message)) return true;
    log(`· ${schema}: sin ${etiqueta} (${e.message.split("\n")[0]})`);
    return false;
  }
}

async function elBloqueoDelDocumento(s, schema) {
  await s.query(`ALTER TABLE "${schema}"."documents" ADD COLUMN IF NOT EXISTS team_block_id UUID`);
  // El camino que se recorre al abrir un bloqueo: «los documentos de ESTE
  // tramo». Parcial, porque la inmensa mayoría de los documentos no cuelgan
  // de ninguno.
  await s.query(
    `CREATE INDEX IF NOT EXISTS documents_team_block_idx
       ON "${schema}"."documents" (team_block_id)
       WHERE team_block_id IS NOT NULL`
  );
  if (await tablaExiste(s, schema, "team_blocks")) {
    const puesta = await fkSuave(
      s,
      schema,
      `DO $$ BEGIN
         ALTER TABLE "${schema}"."documents"
           ADD CONSTRAINT documents_team_block_id_fkey
           FOREIGN KEY (team_block_id) REFERENCES "${schema}"."team_blocks"(id) ON DELETE SET NULL;
       EXCEPTION
         WHEN duplicate_object THEN NULL;
         WHEN undefined_table  THEN NULL;
         WHEN undefined_column THEN NULL;
       END $$;`,
      "FK a team_blocks"
    );
    log(`✓ ${schema}: documents.team_block_id listo${puesta ? " + FK a team_blocks" : " (sin FK)"}`);
  } else {
    log(`✓ ${schema}: documents.team_block_id listo (sin team_blocks — sin FK)`);
  }
}

async function laTablaDeLecturas(s, schema) {
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."document_reads" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL,
      team_member_id UUID NOT NULL,
      assigned_by_id UUID,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Una persona, una fila. Pedir dos veces la misma lectura no puede crear dos
  // avisos ni borrar el acuse del primero.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS document_reads_unique
       ON "${schema}"."document_reads" (document_id, team_member_id)`
  );
  // «Lo que me falta por leer»: el camino de la portada y de la bandeja.
  await s.query(
    `CREATE INDEX IF NOT EXISTS document_reads_pendientes_idx
       ON "${schema}"."document_reads" (team_member_id)
       WHERE read_at IS NULL`
  );

  await fkSuave(
    s,
    schema,
    `ALTER TABLE "${schema}"."document_reads"
       ADD CONSTRAINT document_reads_document_fk
       FOREIGN KEY (document_id) REFERENCES "${schema}"."documents"(id) ON DELETE CASCADE`,
    "FK a documents"
  );
  if (await tablaExiste(s, schema, "team_members")) {
    await fkSuave(
      s,
      schema,
      `ALTER TABLE "${schema}"."document_reads"
         ADD CONSTRAINT document_reads_team_member_fk
         FOREIGN KEY (team_member_id) REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE`,
      "FK a team_members"
    );
  }
  log(`✓ ${schema}.document_reads asegurada`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: documentos con lectura pedida y aparejados a un bloqueo\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(sequelize, "documents");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla documents.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schemas: ${schemas.join(", ")}`);

  for (const schema of schemas) {
    header(schema);
    try {
      await elBloqueoDelDocumento(sequelize, schema);
      await laTablaDeLecturas(sequelize, schema);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Hecho\n\n");
  await sequelize.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
