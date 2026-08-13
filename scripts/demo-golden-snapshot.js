/**
 * demo-golden-snapshot.js — congela el estado ACTUAL de las demos como "foto
 * dorada" (schema `crm_{slug}_golden`, copia solo-datos de `crm_{slug}`).
 *
 * Es la mitad de las demos auto-restaurables: con la foto hecha, cada recarga
 * dura del dashboard de una demo la restaura desde su foto
 * (lib/demo/resetDemo.js). Sin foto, el reset queda dormido y la demo se
 * comporta como siempre.
 *
 * Cuándo re-ejecutarlo: SIEMPRE que cambies a propósito los datos de una demo
 * (seeds nuevos, rebuild del escaparate...) — si no, la recarga los revierte —
 * y después de un sprint que añada columnas, o esos campos saldrán vacíos en el
 * escaparate.
 *
 * Uso local:  node --env-file=.env.local scripts/demo-golden-snapshot.js
 *             node --env-file=.env.local scripts/demo-golden-snapshot.js demo_clinica
 *             node --env-file=.env.local scripts/demo-golden-snapshot.js --comprobar
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/demo-golden-snapshot.js
 *
 * Sin argumento actúa sobre TODAS las demos que existan (lib/demo/demos.js).
 *
 * ── POR QUÉ ADEMÁS COMPRUEBA (13/08/2026) ───────────────────────────────────
 * La foto de la demo llevaba desde el 10/08 rota y en silencio, y el motivo era
 * de tipos, no de datos: `crm_demo_golden` tenía un enum PROPIO
 * (`enum_bookings_payment_status`, 5 valores) mientras el vivo tenía 9. Postgres
 * no convierte solo entre dos enums distintos, así que el INSERT del restore
 * reventaba, la transacción se deshacía entera y el `catch` —que existe para que
 * un fallo aquí no tumbe el dashboard— se lo tragaba. La demo seguía en pie,
 * sucia, sin un solo error visible: exactamente el fallo que nadie encuentra.
 *
 * La foto que saca este script NO tiene ese problema: `CREATE TABLE AS TABLE`
 * copia los datos y REUTILIZA los tipos del schema vivo (comprobado el
 * 13/08/2026), así que ampliar un enum con `ALTER TYPE ... ADD VALUE` —que es
 * como lo hacen las migraciones— llega a la foto solo. El tipo propio de la foto
 * vieja era un resto de otra época.
 *
 * Aun así se comprueba y se dice en voz alta, porque el día que una migración
 * SUSTITUYA un tipo en vez de ampliarlo, esto vuelve, y volvería igual de mudo:
 *   · tipos propios en la foto  → tienen que ser CERO;
 *   · columnas que el vivo tiene y la foto no → salen vacías en el escaparate.
 */

import { Sequelize } from "sequelize";
import { DEMOS, schemaDorado } from "../lib/demo/demos.js";

const args = process.argv.slice(2);
const SOLO_COMPROBAR = args.includes("--comprobar");
const SLUG_PEDIDO = args.find((a) => !a.startsWith("--")) ?? null;

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function titulo(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const existeSchema = async (s, nombre) => {
  const [r] = await s.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = :nombre`,
    { replacements: { nombre } }
  );
  return r.length > 0;
};

/**
 * Lo que puede hacer que una restauración se abandone o salga pobre.
 * Devuelve { tiposPropios, columnasQueFaltan, tablasQueFaltan }.
 */
async function diagnosticar(s, schema, golden) {
  // 1. Tipos enum que la foto tiene como SUYOS. Cualquier número distinto de 0
  //    significa que sus columnas no casan con las del schema vivo.
  const [tipos] = await s.query(
    `SELECT t.typname AS tipo, count(e.enumlabel)::int AS valores
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       LEFT JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = :golden AND t.typtype = 'e'
      GROUP BY 1 ORDER BY 1`,
    { replacements: { golden } }
  );

  // 2. Columnas que existen en el vivo y NO en la foto: no rompen el restore
  //    (solo se copian las comunes) pero salen con su valor por defecto, o sea
  //    vacías en el escaparate.
  const [columnas] = await s.query(
    `SELECT d.table_name AS tabla, d.column_name AS columna
       FROM information_schema.columns d
       JOIN information_schema.tables dt
         ON dt.table_schema = d.table_schema AND dt.table_name = d.table_name
        AND dt.table_type = 'BASE TABLE'
      WHERE d.table_schema = :schema
        AND EXISTS (SELECT 1 FROM information_schema.tables g
                     WHERE g.table_schema = :golden AND g.table_name = d.table_name)
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns g
                         WHERE g.table_schema = :golden AND g.table_name = d.table_name
                           AND g.column_name = d.column_name)
      ORDER BY 1, 2`,
    { replacements: { schema, golden } }
  );

  const [tablas] = await s.query(
    `SELECT d.table_name AS tabla
       FROM information_schema.tables d
      WHERE d.table_schema = :schema AND d.table_type = 'BASE TABLE'
        AND NOT EXISTS (SELECT 1 FROM information_schema.tables g
                         WHERE g.table_schema = :golden AND g.table_name = d.table_name)
      ORDER BY 1`,
    { replacements: { schema, golden } }
  );

  return { tiposPropios: tipos, columnasQueFaltan: columnas, tablasQueFaltan: tablas };
}

function contarProblemas(d) {
  return d.tiposPropios.length + d.columnasQueFaltan.length + d.tablasQueFaltan.length;
}

function pintarDiagnostico(d) {
  if (d.tiposPropios.length) {
    log(`✗ ${d.tiposPropios.length} tipo(s) enum PROPIOS de la foto — el restore se abandonará:`);
    for (const t of d.tiposPropios) log(`     ${t.tipo} (${t.valores} valores)`);
  }
  if (d.tablasQueFaltan.length) {
    log(`⚠ ${d.tablasQueFaltan.length} tabla(s) que la foto no tiene: ${d.tablasQueFaltan.map((t) => t.tabla).join(", ")}`);
  }
  if (d.columnasQueFaltan.length) {
    const porTabla = new Map();
    for (const c of d.columnasQueFaltan) {
      if (!porTabla.has(c.tabla)) porTabla.set(c.tabla, []);
      porTabla.get(c.tabla).push(c.columna);
    }
    log(`⚠ ${d.columnasQueFaltan.length} columna(s) que la foto no tiene (saldrán vacías en el escaparate):`);
    for (const [tabla, cols] of porTabla) log(`     ${tabla}: ${cols.join(", ")}`);
  }
  if (!contarProblemas(d)) log("✓ la foto casa con el schema vivo");
}

async function fotografiar(s, slug) {
  const schema = `crm_${slug}`;
  const golden = schemaDorado(slug);

  if (!(await existeSchema(s, schema))) {
    log(`· ${slug}: no existe ${schema} en esta base de datos, salto`);
    return { saltado: true };
  }

  if (SOLO_COMPROBAR) {
    if (!(await existeSchema(s, golden))) {
      log(`✗ ${slug}: NO tiene foto dorada — la restauración está dormida`);
      return { problemas: 1 };
    }
    const d = await diagnosticar(s, schema, golden);
    pintarDiagnostico(d);
    return { problemas: contarProblemas(d) };
  }

  const [tablas] = await s.query(
    `SELECT table_name AS tn FROM information_schema.tables
      WHERE table_schema = :schema AND table_type = 'BASE TABLE' ORDER BY table_name`,
    { replacements: { schema } }
  );

  await s.query(`DROP SCHEMA IF EXISTS "${golden}" CASCADE`);
  await s.query(`CREATE SCHEMA "${golden}"`);

  let total = 0;
  for (const { tn } of tablas) {
    await s.query(`CREATE TABLE "${golden}"."${tn}" AS TABLE "${schema}"."${tn}"`);
    const [[{ n }]] = await s.query(`SELECT count(*)::int AS n FROM "${golden}"."${tn}"`);
    total += n;
  }
  await s.query(`CREATE TABLE "${golden}"."_snapshot_meta" AS SELECT now() AS created_at`);

  log(`✓ ${slug}: ${tablas.length} tablas congeladas, ${total} filas`);

  // Y se comprueba lo que se acaba de hacer, sin fiarse de que no haya petado.
  const d = await diagnosticar(s, schema, golden);
  if (contarProblemas(d)) pintarDiagnostico(d);
  return { problemas: contarProblemas(d) };
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(
    SOLO_COMPROBAR
      ? " Comprobar las fotos doradas de las demos\n"
      : " Foto dorada de las demos (crm_X → crm_X_golden)\n"
  );
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const slugs = SLUG_PEDIDO ? [SLUG_PEDIDO] : DEMOS.map((d) => d.slug);
  const conocidos = new Set(DEMOS.map((d) => d.slug));
  for (const slug of slugs) {
    if (!conocidos.has(slug)) {
      process.stderr.write(
        `\n✗ "${slug}" no es una demo. Las que hay: ${[...conocidos].join(", ")}.\n` +
          `  Si es una demo nueva, añádela a lib/demo/demos.js primero.\n\n`
      );
      process.exit(1);
    }
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  let problemas = 0;
  try {
    for (const slug of slugs) {
      titulo(slug);
      const r = await fotografiar(s, slug);
      problemas += r.problemas ?? 0;
    }
  } finally {
    await s.close();
  }

  if (problemas) {
    process.stdout.write(`\n ⚠ ${problemas} cosa(s) que revisar (arriba).\n\n`);
    process.exit(SOLO_COMPROBAR ? 1 : 0);
  }
  process.stdout.write(
    SOLO_COMPROBAR ? "\n ✓ Todas las fotos casan\n\n" : "\n ✓ Fotos doradas listas\n\n"
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  process.exit(1);
});
