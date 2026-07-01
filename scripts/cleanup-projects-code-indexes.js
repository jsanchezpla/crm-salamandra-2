/**
 * cleanup-projects-code-indexes.js — borra índices duplicados
 * projects_code_key* acumulados por sync({alter:true}) cuando el modelo
 * Project.code declaraba unique: true (ya arreglado en Sprint 2 Proyectos
 * a unique: false en models/tenant/Project.model.js).
 *
 * Política:
 *   - Solo borra índices que matchean EXACTAMENTE `^projects_code_key[0-9]*$`.
 *   - NUNCA toca `projects_code_unique` (el índice CORRECTO con WHERE parcial).
 *   - NUNCA toca el PK `projects_pkey`.
 *   - Idempotente: re-ejecutar tras cleanup reporta "0 índices detectados".
 *   - Una sola transacción global; si algo falla, ROLLBACK completo.
 *
 * Guard de producción: aborta si DATABASE_URL contiene "prod" / "production"
 * en el host o el nombre de la BD. Para ejecutar en producción habría que
 * adaptarlo manualmente tras backup BD (ver backlog Sprint 3 en
 * docs/modules/projects.md).
 *
 * Uso (LOCAL):
 *   node --env-file=.env.local scripts/cleanup-projects-code-indexes.js
 *
 * Script de un solo uso — NO añadir al package.json.
 */

import { Sequelize } from "sequelize";

const INDEX_PATTERN = /^projects_code_key[0-9]*$/;
const out = (s = "") => process.stdout.write(s + "\n");

function parseUrlInfo(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || "",
      port: u.port || "",
      database: (u.pathname || "").replace(/^\//, ""),
      user: u.username || "",
    };
  } catch {
    return { host: "?", port: "?", database: "?", user: "?" };
  }
}

function isProdLooking(url) {
  if (!url) return true; // ausencia → tratamos como sospechoso, mejor abortar
  const u = parseUrlInfo(url);
  const haystack = `${u.host} ${u.database}`.toLowerCase();
  return /prod/i.test(haystack);
}

async function listSchemas(sequelize) {
  const [rows] = await sequelize.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'crm_%'
    ORDER BY schema_name
  `);
  return rows.map((r) => r.schema_name);
}

async function findBasuraIndexes(sequelize, schema) {
  // Devuelve los índices basura con metadato sobre si están respaldando una
  // UNIQUE constraint (caso típico — Sequelize crea ADD CONSTRAINT que genera
  // el índice automáticamente). Si tienen constraint, hay que borrar la
  // constraint con ALTER TABLE; si no, basta DROP INDEX.
  const [rows] = await sequelize.query(
    `
    SELECT
      pi.indexname,
      EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = $1
          AND c.conname = pi.indexname
          AND c.contype = 'u'
      ) AS is_constraint
    FROM pg_indexes pi
    WHERE pi.schemaname = $1
      AND pi.tablename = 'projects'
      AND pi.indexname ~ '^projects_code_key[0-9]*$'
    ORDER BY pi.indexname
  `,
    { bind: [schema] }
  );
  return rows
    .filter((r) => INDEX_PATTERN.test(r.indexname))
    .map((r) => ({ name: r.indexname, isConstraint: r.is_constraint }));
}

async function verifyPost(sequelize) {
  const [rows] = await sequelize.query(`
    SELECT n.nspname AS schema, indexname, indexdef
    FROM pg_indexes
    JOIN pg_namespace n ON n.nspname = pg_indexes.schemaname
    WHERE pg_indexes.schemaname LIKE 'crm_%'
      AND tablename = 'projects'
      AND indexname LIKE '%code%'
    ORDER BY 1, 2
  `);
  return rows;
}

function printTable(rows, headers) {
  if (rows.length === 0) {
    out("    (sin filas)");
    return;
  }
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length))
  );
  const sep = "  +" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const fmt = (cells) =>
    "  | " +
    cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join(" | ") +
    " |";
  out(sep);
  out(fmt(headers));
  out(sep);
  for (const r of rows) out(fmt(r));
  out(sep);
}

async function main() {
  out("\n════════════════════════════════════════════════════════");
  out(" Cleanup índices duplicados projects.code (LOCAL ONLY)  ");
  out("════════════════════════════════════════════════════════");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const info = parseUrlInfo(process.env.DATABASE_URL);
  out(`  Conexión: ${info.user}@${info.host}:${info.port}/${info.database}`);

  if (isProdLooking(process.env.DATABASE_URL)) {
    process.stderr.write(
      "\n⚠️  ESTE SCRIPT ES PARA LOCAL. Si quieres ejecutarlo en producción,\n" +
        "    hazlo MANUALMENTE tras backup BD.\n" +
        `    DATABASE_URL apunta a host '${info.host}' / db '${info.database}'.\n` +
        "    Aborto.\n"
    );
    process.exit(2);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  try {
    const [v] = await sequelize.query("SHOW server_version");
    out(`  PostgreSQL: ${v[0]?.server_version ?? "?"}`);

    out("\n▶ Listando schemas crm_*...");
    const schemas = await listSchemas(sequelize);
    out(`  ✓ ${schemas.length} schemas: ${schemas.join(", ")}`);

    out("\n▶ Inventario de índices a borrar (patrón ^projects_code_key[0-9]*$)...");
    const plan = []; // [{ schema, indexes }]
    for (const schema of schemas) {
      const idx = await findBasuraIndexes(sequelize, schema);
      plan.push({ schema, indexes: idx });
    }
    printTable(
      plan.map((p) => [
        p.schema,
        p.indexes.length,
        p.indexes
          .map((i) => `${i.name}${i.isConstraint ? "(C)" : ""}`)
          .join(", ") || "—",
      ]),
      ["schema", "count", "indexes (C=constraint)"]
    );

    const total = plan.reduce((acc, p) => acc + p.indexes.length, 0);

    if (total === 0) {
      out("\n  · 0 índices detectados — nada que borrar (idempotencia confirmada).");
    } else {
      out(`\n▶ Borrando ${total} índices/constraints en una transacción global...`);
      await sequelize.transaction(async (t) => {
        for (const { schema, indexes } of plan) {
          for (const item of indexes) {
            const name = item.name;
            // Triple defensa: regex, blacklist explícita y patrón de nuevo.
            if (!INDEX_PATTERN.test(name)) {
              throw new Error(`Índice ${name} no matchea el patrón — abort`);
            }
            if (name === "projects_code_unique" || name === "projects_pkey") {
              throw new Error(`Índice ${name} es intocable — abort`);
            }
            if (item.isConstraint) {
              // Postgres impide DROP INDEX si el índice respalda una
              // constraint; hay que borrar la constraint y el índice cae con
              // ella. Defensive IF EXISTS por si otra TX la borró antes.
              await sequelize.query(
                `ALTER TABLE "${schema}"."projects" DROP CONSTRAINT IF EXISTS "${name}"`,
                { transaction: t }
              );
              out(`  ✓ DROP CONSTRAINT ${schema}.projects.${name}`);
            } else {
              await sequelize.query(
                `DROP INDEX IF EXISTS "${schema}"."${name}"`,
                { transaction: t }
              );
              out(`  ✓ DROP INDEX ${schema}.${name}`);
            }
          }
        }
      });
      out("  ✓ Transacción COMMIT");
    }

    out("\n▶ Verificación post-cleanup (índices code en projects)...");
    const after = await verifyPost(sequelize);
    printTable(
      after.map((r) => [r.schema, r.indexname, r.indexdef]),
      ["schema", "indexname", "indexdef"]
    );

    // Estado "limpio" por schema:
    //   - exactamente `projects_code_unique` (los que ejecutaron Sprint 1
    //     migrate-projects-sprint-1.js), O
    //   - sin índices code (schemas sin módulo projects activo, p.ej.
    //     retorika que solo tenía residuos de sync alter).
    const bySchema = new Map();
    for (const r of after) {
      const arr = bySchema.get(r.schema) ?? [];
      arr.push(r.indexname);
      bySchema.set(r.schema, arr);
    }
    const allSchemas = await listSchemas(sequelize);
    const warnings = [];
    for (const schema of allSchemas) {
      const names = bySchema.get(schema) ?? [];
      const onlyUnique =
        names.length === 1 && names[0] === "projects_code_unique";
      const empty = names.length === 0;
      if (!(onlyUnique || empty)) {
        warnings.push(`${schema}: ${names.join(", ")}`);
      }
    }

    out("\n════════════════════════════════════════════════════════");
    if (total === 0 && warnings.length === 0) {
      out(" ✓ Nada que limpiar. BD ya estaba limpia.              ");
    } else if (warnings.length === 0) {
      out(` ✓ Cleanup completado: ${total} índices borrados.         `);
    } else {
      out(` ⚠ Cleanup parcial. Schemas con residuo:                `);
      for (const w of warnings) out(`     · ${w}`);
    }
    out("════════════════════════════════════════════════════════\n");

    await sequelize.close();
    process.exit(warnings.length === 0 ? 0 : 1);
  } catch (err) {
    await sequelize.close();
    process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
    process.exit(3);
  }
}

main();
