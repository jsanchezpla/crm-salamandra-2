/**
 * migrate-fichaje-module.js — tablas del módulo Fichaje (control horario).
 *
 * Crea `fichaje_imports` (el lote de Excel) y `fichajes` (el tramo trabajado),
 * en los schemas de los tenants con el módulo `fichaje` activo.
 *
 * ── EL ÍNDICE QUE IMPORTA ───────────────────────────────────────────────────
 * `fichajes_import_unico`: UNIQUE PARCIAL sobre
 * `(team_member_id, fecha, entrada_at, tipo) WHERE deleted_at IS NULL AND
 * origen = 'import'`.
 *
 * Está para que **la base de datos** impida que el mismo mes entre dos veces,
 * no solo la lógica. Volver a subir el Excel de marzo va a pasar —lo suben mal,
 * o llega corregido a mitad de mes— y un fichaje duplicado es una nómina mal
 * pagada. La lógica de reemplazo por periodo hace lo suyo; esto es la red de
 * debajo, para el día que la lógica falle.
 *
 * Es PARCIAL en las dos condiciones y las dos hacen falta:
 *   · `deleted_at IS NULL` — una fila dada de baja no debe bloquear que el dato
 *     vuelva a entrar en el siguiente volcado.
 *   · `origen = 'import'` — a mano SÍ se pueden meter dos tramos iguales el
 *     mismo día (dos entradas a la misma hora es raro, pero es asunto de quien
 *     lo escribe, no de un índice).
 *
 * `entrada_at` puede ser NULL (hay máquinas que solo dan el total del día) y en
 * Postgres dos NULL no chocan en un UNIQUE, así que ese caso lo cubre la lógica
 * de reemplazo por periodo, no el índice. Se dice aquí para que nadie dé por
 * hecho lo contrario.
 *
 * Idempotente y aditiva.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-fichaje-module.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-fichaje-module.js
 */

import { Sequelize } from "sequelize";
import { byModule, byTable, tableExists } from "./_schema-targets.js";

function log(m) { process.stdout.write(`  ${m}\n`); }
function header(m) { process.stdout.write(`\n▶ ${m}\n`); }

async function enumExists(s, schema, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_type tp JOIN pg_namespace n ON n.oid = tp.typnamespace
      WHERE tp.typname = :name AND n.nspname = :schema`,
    { replacements: { name, schema } }
  );
  return rows.length > 0;
}

async function indexExists(s, schema, name) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = :schema AND indexname = :name`,
    { replacements: { schema, name } }
  );
  return rows.length > 0;
}

async function schemaExists(s, schema) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = :schema`,
    { replacements: { schema } }
  );
  return rows.length > 0;
}

const ENUMS = {
  enum_fichajes_tipo: `('trabajo','pausa','ausencia','festivo')`,
  enum_fichajes_origen: `('import','manual','corregido')`,
  enum_fichaje_imports_status: `('applied','superseded','reverted')`,
};

async function crear(s, schema) {
  for (const [name, valores] of Object.entries(ENUMS)) {
    if (await enumExists(s, schema, name)) continue;
    await s.query(`CREATE TYPE "${schema}"."${name}" AS ENUM ${valores}`);
    log(`✓ ${schema}: enum ${name}`);
  }

  if (!(await tableExists(s, schema, "fichaje_imports"))) {
    await s.query(`
      CREATE TABLE "${schema}"."fichaje_imports" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        periodo VARCHAR(7) NOT NULL,
        file_name VARCHAR(255),
        file_hash VARCHAR(64),
        parser VARCHAR(60),
        rows_total INTEGER NOT NULL DEFAULT 0,
        rows_ok INTEGER NOT NULL DEFAULT 0,
        rows_error INTEGER NOT NULL DEFAULT 0,
        status "${schema}"."enum_fichaje_imports_status" NOT NULL DEFAULT 'applied',
        imported_by_team_id UUID,
        imported_by_user_id UUID,
        applied_at TIMESTAMPTZ,
        reverted_at TIMESTAMPTZ,
        resumen JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fichaje_imports_periodo_chk CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
      )`);
    log(`✓ ${schema}.fichaje_imports: tabla creada`);
  }

  if (!(await tableExists(s, schema, "fichajes"))) {
    await s.query(`
      CREATE TABLE "${schema}"."fichajes" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_member_id UUID NOT NULL REFERENCES "${schema}"."team_members"(id) ON DELETE RESTRICT,
        fecha DATE NOT NULL,
        entrada_at TIME,
        salida_at TIME,
        entrada_prevista_at TIME,
        salida_prevista_at TIME,
        minutos INTEGER NOT NULL,
        minutos_previstos INTEGER,
        minutos_original INTEGER,
        tipo "${schema}"."enum_fichajes_tipo" NOT NULL DEFAULT 'trabajo',
        origen "${schema}"."enum_fichajes_origen" NOT NULL DEFAULT 'import',
        import_id UUID REFERENCES "${schema}"."fichaje_imports"(id) ON DELETE SET NULL,
        hoja_excel VARCHAR(120),
        fila_excel INTEGER,
        nota TEXT,
        corregido_por_team_id UUID,
        corregido_at TIMESTAMPTZ,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fichajes_minutos_chk CHECK (minutos >= 0 AND minutos <= 1440)
      )`);
    log(`✓ ${schema}.fichajes: tabla creada`);
  }
}

async function blindar(s, schema) {
  const idx = [
    { n: "fichajes_persona_fecha_idx", t: "fichajes", c: "(team_member_id, fecha)" },
    { n: "fichajes_fecha_idx", t: "fichajes", c: "(fecha)" },
    { n: "fichajes_import_idx", t: "fichajes", c: "(import_id)" },
    { n: "fichaje_imports_periodo_idx", t: "fichaje_imports", c: "(periodo)" },
    { n: "fichaje_imports_hash_idx", t: "fichaje_imports", c: "(file_hash)" },
  ];
  for (const { n, t, c } of idx) {
    if (!(await tableExists(s, schema, t))) continue;
    if (await indexExists(s, schema, n)) continue;
    await s.query(`CREATE INDEX "${n}" ON "${schema}"."${t}" ${c}`);
    log(`✓ ${schema}: index ${n}`);
  }

  // El cerrojo de la cabecera.
  if ((await tableExists(s, schema, "fichajes")) && !(await indexExists(s, schema, "fichajes_import_unico"))) {
    try {
      await s.query(
        `CREATE UNIQUE INDEX "fichajes_import_unico"
           ON "${schema}"."fichajes" (team_member_id, fecha, entrada_at, tipo)
         WHERE deleted_at IS NULL AND origen = 'import'`
      );
      log(`✓ ${schema}: index UNICO fichajes_import_unico`);
    } catch (err) {
      // 23505: ya hay duplicados dentro. No se fuerza ni se borra: se avisa, y
      // lo arregla una persona mirando qué mes se volcó dos veces.
      const code = err?.parent?.code || err?.original?.code;
      if (code !== "23505") throw err;
      log(`⚠ ${schema}: HAY FICHAJES DUPLICADOS, el índice único no se ha podido crear.`);
      log(`  Revisa qué periodo se volcó dos veces antes de fiarte de los totales.`);
    }
  }
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: módulo Fichaje (control horario)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  header("Pasada 1 — crear (schemas con el módulo `fichaje`)");
  const { schemas: conModulo } = await byModule(s, "fichaje");
  if (conModulo.length === 0) log("· Ningún tenant con fichaje todavía.");
  for (const schema of conModulo) {
    if (!(await schemaExists(s, schema))) { log(`✗ ${schema}: no existe, se salta`); continue; }
    // `fichajes` apunta a `team_members`: sin el módulo Equipo no hay a quién
    // atribuir una jornada. El catálogo ya lo exige (`requiere: ["team"]`),
    // pero un alta a mano puede saltárselo.
    if (!(await tableExists(s, schema, "team_members"))) {
      log(`✗ ${schema}: sin tabla team_members (le falta el módulo Equipo). Se salta.`);
      continue;
    }
    try {
      await crear(s, schema);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  header("Pasada 2 — blindar (schemas que ya tienen las tablas)");
  const { schemas: conTabla } = await byTable(s, "fichajes");
  if (conTabla.length === 0) log("· Ningún schema con `fichajes` todavía.");
  for (const schema of conTabla) {
    try {
      await blindar(s, schema);
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n✓ Migración completada\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
