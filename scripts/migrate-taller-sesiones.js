/**
 * migrate-taller-sesiones.js — el REGISTRO DE SESIÓN de un taller (01/09/2026,
 * Aumenta por Rodrigo).
 *
 * Dos cosas, en cada tenant con `clinica`:
 *   1. tabla `taller_sesiones`: una fila por sesión de taller, con el registro
 *      COMÚN del grupo por apartados.
 *   2. `clinic_sessions.taller_sesion_id` UUID NULL: de qué sesión de taller
 *      sale el registro de este paciente (null = sesión normal, que es lo que
 *      son las 22.045 de Aumenta).
 *
 * La tercera pieza —`team_blocks.taller_id`, qué taller se da en un tramo de la
 * agenda— va en `migrate-citas-bloqueo-taller.js` y NO aquí, aunque sea del
 * mismo encargo: `team_blocks` es del módulo `citas` y su modelo declara la
 * columna para todos, así que un centro con Citas y sin Clínica se quedaría sin
 * ella y cada lectura de su agenda daría 42703.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 * «Los talleres hay que ponerlos y dejarlos claros que ahora salen como
 * bloqueos y ya. […] Hay que poner que estos talleres puedan tener registro de
 * sesión y afecta a un grupo de pacientes.» En Aumenta son tres —HHSS, Grupo de
 * Apoyo y Mente Activa—: hora y media, ocho pacientes, y de lo que se hace
 * dentro no queda ni una línea en la historia de ninguno.
 *
 * El registro común vive en `taller_sesiones` y se COPIA a la sesión de cada
 * asistente; la nota individual de cada paciente vive solo en la suya. El
 * porqué completo, en `models/tenant/TallerSesion.model.js`.
 *
 * ── VA ANTES DEL DESPLIEGUE ─────────────────────────────────────────────────
 * Los MODELOS declaran `taller_sesion_id` y `taller_id`, así que Sequelize las
 * pide por nombre en cada SELECT: sin ellas, toda lectura de sesiones clínicas
 * y de bloqueos da 42703. Misma lección que las tres del 29/08/2026.
 *
 * Sin backfill: nada cambia para las sesiones y los bloqueos que ya existen.
 * Nacen a NULL, que es «esto no es de ningún taller», y se leen igual que ayer.
 *
 * Idempotente (IF NOT EXISTS en todo). Los schemas salen de `byModule`, que
 * arrastra también las FOTOS DORADAS de las demos: sin ellas, restaurar una
 * demo la devolvería sin estas columnas.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-taller-sesiones.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-taller-sesiones.js
 */

import { Sequelize } from "sequelize";
import { byModule } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function tableExists(s, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table] }
  );
  return rows.length > 0;
}

async function processSchema(s, schema) {
  // 1. La tabla. Necesita `talleres`, que crea migrate-talleres; el orden lo
  //    resuelve el analizador de _migration-order.js leyendo este SQL.
  if (!(await tableExists(s, schema, "talleres"))) {
    log(`✗ ${schema}: no existe talleres. Se salta el bloque entero.`);
    return;
  }

  await s.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."taller_sesiones" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      taller_id UUID NOT NULL,
      team_member_id UUID,
      session_date TIMESTAMPTZ NOT NULL,
      duration INTEGER,
      content_sections JSONB NOT NULL DEFAULT '{}'::jsonb,
      internal_notes TEXT,
      team_block_id UUID,
      status VARCHAR(20) NOT NULL DEFAULT 'registered',
      created_by_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  /*
   * La FK a `talleres` va DESPUÉS y tolerando el fallo (01/09/2026): las fotos
   * doradas de las demos (`crm_*_golden`) se copian SIN claves primarias, así
   * que ahí PostgreSQL rechaza el REFERENCES. Con la FK dentro del CREATE
   * TABLE, la migración moría en la primera dorada y la tabla no llegaba a
   * existir en ninguna: al reponer una demo se quedaba sin `taller_sesiones`.
   * Mismo patrón que `migrate-arqueo.js` y `migrate-arqueo-movimientos.js`.
   */
  try {
    await s.query(`
      ALTER TABLE "${schema}"."taller_sesiones"
        ADD CONSTRAINT taller_sesiones_taller_fk
        FOREIGN KEY (taller_id) REFERENCES "${schema}"."talleres"(id) ON DELETE CASCADE
    `);
  } catch (e) {
    if (!/ya existe|already exists/i.test(e.message)) {
      log(`· ${schema}: sin FK a talleres (${e.message.split("\n")[0]})`);
    }
  }

  /*
   * `status` es VARCHAR con CHECK y no un ENUM de Postgres, a propósito: un
   * enum de verdad obliga a un ALTER TYPE cada vez que se añada un estado, que
   * es justo lo que costó la migración del informe de beca (26/08/2026). El
   * modelo lo declara como ENUM de Sequelize, que valida en el lado de Node;
   * esto es el cinturón por debajo.
   */
  await s.query(`
    DO $$ BEGIN
      ALTER TABLE "${schema}"."taller_sesiones"
        ADD CONSTRAINT taller_sesiones_status_chk CHECK (status IN ('registered','published'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_sesiones_taller_fecha_idx
       ON "${schema}"."taller_sesiones" (taller_id, session_date)`
  );
  await s.query(
    `CREATE INDEX IF NOT EXISTS taller_sesiones_member_idx
       ON "${schema}"."taller_sesiones" (team_member_id)`
  );
  log(`✓ ${schema}.taller_sesiones asegurada`);

  // 2. El puntero desde la sesión de cada paciente.
  if (await tableExists(s, schema, "clinic_sessions")) {
    await s.query(
      `ALTER TABLE "${schema}"."clinic_sessions"
         ADD COLUMN IF NOT EXISTS taller_sesion_id UUID`
    );
    // El camino que se recorre al re-propagar el registro común: «las sesiones
    // de ESTA sesión de taller». Parcial, porque la inmensa mayoría son null.
    await s.query(
      `CREATE INDEX IF NOT EXISTS clinic_sessions_taller_sesion_idx
         ON "${schema}"."clinic_sessions" (taller_sesion_id)
         WHERE taller_sesion_id IS NOT NULL`
    );
    log(`✓ ${schema}.clinic_sessions: columna taller_sesion_id asegurada`);
  } else {
    log(`· ${schema}: sin clinic_sessions, se salta el puntero de la sesión`);
  }

}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: registro de sesión de los talleres\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const sequelize = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byModule(sequelize, ["clinica"]);
  if (schemas.length === 0) {
    log("· Ningún tenant con clinica activo.");
    await sequelize.close();
    process.exit(0);
  }
  log(`✓ ${schemas.length} schemas: ${schemas.join(", ")}`);

  for (const schema of schemas) {
    header(schema);
    await processSchema(sequelize, schema);
  }

  process.stdout.write("\n✓ Hecho\n\n");
  await sequelize.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
