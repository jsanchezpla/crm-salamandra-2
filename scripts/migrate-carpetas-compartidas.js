/**
 * migrate-carpetas-compartidas.js — con quién está compartida una carpeta del
 * archivo (01/09/2026, Rodrigo).
 *
 * Crea `document_folder_members` (carpeta × persona del equipo) en cada schema
 * que tenga `document_folders`.
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Las carpetas creadas en Documentos tienen que poder ser vistas por quien se
 * quiera. Un selector de equipo.» Hasta hoy una carpeta era de su dueño o de
 * todo el centro, sin nada en medio.
 *
 * ── LO QUE ESTA MIGRACIÓN NO HACE, Y ES LO IMPORTANTE ──────────────────────
 * NO toca `document_folders.visibility`, que es un ENUM **de Postgres**. Añadir
 * un valor a un enum vivo en una migración de tenant es exactamente lo que ya
 * costó un arreglo (el tipo es propiedad del schema y las fotos doradas se
 * quedan atrás): la regla de la casa es VARCHAR + CHECK, y ni siquiera hace
 * falta aquí — la lista va aparte y `visibility` se queda como estaba. Un
 * cliente que no comparta ninguna carpeta se comporta EXACTAMENTE igual que
 * antes de esta tabla.
 *
 * ── POR QUÉ POR TABLA Y NO POR MÓDULO ──────────────────────────────────────
 * El modelo `DocumentFolderMember` se registra para TODOS los tenants
 * (`lib/db/tenantDb.js` no gatea por módulo) y el archivo lo consulta en cada
 * carga para saber qué carpetas ve quien mira. Misma regla que
 * `migrate-documentos-lecturas.js`: el módulo dice quién puede ENTRAR, no qué
 * forma tiene el schema (regla 12). `byTable` arrastra además las fotos doradas
 * de las demos.
 *
 * ── LAS FK, APARTE Y TOLERANDO EL FALLO ────────────────────────────────────
 * Las doradas (`crm_*_golden`) se copian SIN claves primarias, así que ahí
 * PostgreSQL rechaza el REFERENCES; con la FK dentro del CREATE TABLE, la
 * migración moriría en la primera y la tabla no llegaría a existir en ninguna.
 *
 * Sin backfill: ninguna carpeta nace compartida.
 *
 * Idempotente (IF NOT EXISTS en todo).
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-carpetas-compartidas.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-carpetas-compartidas.js
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

async function creaTabla(s, schema) {
  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."document_folder_members" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      folder_id UUID NOT NULL,
      team_member_id UUID NOT NULL,
      added_by_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Una persona, una fila: compartir dos veces la misma carpeta con la misma
  // persona no puede crear dos filas ni fallar.
  await s.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS document_folder_members_unique
       ON "${schema}"."document_folder_members" (folder_id, team_member_id)`
  );
  // «¿Qué carpetas me han compartido a mí?»: el camino de cada carga del archivo.
  await s.query(
    `CREATE INDEX IF NOT EXISTS document_folder_members_member_idx
       ON "${schema}"."document_folder_members" (team_member_id)`
  );

  await fkSuave(
    s,
    schema,
    `ALTER TABLE "${schema}"."document_folder_members"
       ADD CONSTRAINT document_folder_members_folder_fk
       FOREIGN KEY (folder_id) REFERENCES "${schema}"."document_folders"(id) ON DELETE CASCADE`,
    "FK a document_folders"
  );
  if (await tablaExiste(s, schema, "team_members")) {
    await fkSuave(
      s,
      schema,
      `ALTER TABLE "${schema}"."document_folder_members"
         ADD CONSTRAINT document_folder_members_team_member_fk
         FOREIGN KEY (team_member_id) REFERENCES "${schema}"."team_members"(id) ON DELETE CASCADE`,
      "FK a team_members"
    );
  }
  log(`✓ ${schema}.document_folder_members asegurada`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: carpetas del archivo compartidas con quien se quiera\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(sequelize, "document_folders");
  if (schemas.length === 0) {
    log("· Ningún schema con tabla document_folders.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schemas: ${schemas.join(", ")}`);

  for (const schema of schemas) {
    header(schema);
    try {
      await creaTabla(sequelize, schema);
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
