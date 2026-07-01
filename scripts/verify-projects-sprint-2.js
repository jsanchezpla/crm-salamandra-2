/**
 * verify-projects-sprint-2.js — Script de verificación post-migración.
 *
 * Ejecuta 8 queries de comprobación contra la BD configurada en
 * DATABASE_URL (típicamente .env.local). Reporta resultados con
 * ✅/⚠️/❌ y una tabla resumen final.
 *
 * Uso:
 *   node --env-file=.env.local scripts/verify-projects-sprint-2.js
 *
 * Script de un solo uso — NO añadir a package.json.
 */

import { Sequelize } from "sequelize";

const out = (s = "") => process.stdout.write(s + "\n");
const inl = (s) => process.stdout.write(s);

const RESULTS = []; // [{ id, label, status, note }]

function record(id, label, status, note = "") {
  RESULTS.push({ id, label, status, note });
}

function statusIcon(s) {
  return s === "ok" ? "✅" : s === "warn" ? "⚠️ " : "❌";
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
    "  | " + cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join(" | ") + " |";
  out(sep);
  out(fmt(headers));
  out(sep);
  for (const r of rows) out(fmt(r));
  out(sep);
}

// ─── Queries ────────────────────────────────────────────────────────────────

async function q1_tableExists(s) {
  out("\n══ Query 1 — Tabla task_assignees existe en ambos schemas");
  const [rows] = await s.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name = 'task_assignees'
    ORDER BY table_schema
  `);
  printTable(rows.map((r) => [r.table_schema, r.table_name]), ["table_schema", "table_name"]);

  const schemas = new Set(rows.map((r) => r.table_schema));
  const expected = ["crm_aumenta", "crm_demo"];
  const missing = expected.filter((s) => !schemas.has(s));
  if (rows.length === 2 && missing.length === 0) {
    record("Q1", "task_assignees existe (crm_aumenta + crm_demo)", "ok", `${rows.length} filas`);
  } else if (missing.length === 0) {
    record("Q1", "task_assignees existe (extra schemas)", "warn", `${rows.length} filas (esperado 2)`);
  } else {
    record("Q1", "task_assignees existe", "fail", `faltan: ${missing.join(", ")}`);
  }
}

async function q2_structure(s) {
  out("\n══ Query 2 — Estructura de task_assignees en crm_demo");
  const [rows] = await s.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'crm_demo' AND table_name = 'task_assignees'
    ORDER BY ordinal_position
  `);
  printTable(
    rows.map((r) => [r.column_name, r.data_type, r.is_nullable, r.column_default ?? "—"]),
    ["column_name", "data_type", "nullable", "default"]
  );

  const expected = {
    id: "uuid",
    task_id: "uuid",
    team_member_id: "uuid",
    assigned_at: "timestamp with time zone",
    created_at: "timestamp with time zone",
    updated_at: "timestamp with time zone",
  };
  const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
  const missing = Object.keys(expected).filter((c) => !byName[c]);
  const typeMismatch = Object.entries(expected).filter(
    ([c, dt]) => byName[c] && byName[c].data_type !== dt
  );
  if (missing.length === 0 && typeMismatch.length === 0) {
    record("Q2", "task_assignees columnas + tipos", "ok", `${rows.length} columnas`);
  } else {
    const detail = [
      missing.length ? `faltan: ${missing.join(", ")}` : "",
      typeMismatch.length
        ? `tipo incorrecto: ${typeMismatch.map(([c, dt]) => `${c} (esperado ${dt}, real ${byName[c].data_type})`).join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");
    record("Q2", "task_assignees columnas + tipos", "fail", detail);
  }
}

async function q3_constraints(s) {
  out("\n══ Query 3 — Constraints de task_assignees en crm_demo");
  const [rows] = await s.query(`
    SELECT conname, contype, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'crm_demo'
      AND conrelid = (
        SELECT oid FROM pg_class
        WHERE relname = 'task_assignees' AND relnamespace = n.oid
      )
    ORDER BY contype, conname
  `);
  printTable(
    rows.map((r) => [r.conname, r.contype, r.definition]),
    ["conname", "contype", "definition"]
  );

  const hasPk = rows.some((r) => r.contype === "p");
  const fkTask = rows.find(
    (r) => r.contype === "f" && r.definition.includes("task_id") && r.definition.includes("REFERENCES")
  );
  const fkCascade = fkTask && /ON DELETE CASCADE/i.test(fkTask.definition);
  const uniq = rows.find(
    (r) => r.contype === "u" && r.conname === "task_assignees_unique"
  );
  const uniqOk =
    uniq && /\(task_id, team_member_id\)/i.test(uniq.definition);

  const checks = [
    [hasPk, "PK"],
    [!!fkTask, "FK task_id"],
    [fkCascade, "FK ON DELETE CASCADE"],
    [!!uniq, "UNIQUE task_assignees_unique"],
    [uniqOk, "UNIQUE columnas (task_id, team_member_id)"],
  ];
  const fail = checks.filter(([ok]) => !ok).map(([, l]) => l);
  if (fail.length === 0) {
    record("Q3", "Constraints task_assignees", "ok", `${rows.length} constraints`);
  } else {
    record("Q3", "Constraints task_assignees", "fail", `falta: ${fail.join(", ")}`);
  }
}

async function q4_indexes(s) {
  out("\n══ Query 4 — Índices nuevos en tasks + task_assignees");
  const [rows] = await s.query(`
    SELECT schemaname, tablename, indexname, indexdef
    FROM pg_indexes
    WHERE indexname IN (
      'tasks_project_column_order_idx',
      'tasks_assignee_idx',
      'tasks_phase_idx',
      'tasks_milestone_idx',
      'task_assignees_team_member_idx'
    )
    ORDER BY schemaname, indexname
  `);
  printTable(
    rows.map((r) => [r.schemaname, r.tablename, r.indexname]),
    ["schema", "table", "indexname"]
  );

  // Detalle de indexdef (solo crm_demo para no inundar)
  out("  — Definiciones (crm_demo):");
  for (const r of rows.filter((x) => x.schemaname === "crm_demo")) {
    out(`    · ${r.indexname}`);
    out(`        ${r.indexdef}`);
  }

  // Verificar parcial WHERE en los 3 partial idx
  const partialOk = ["tasks_assignee_idx", "tasks_phase_idx", "tasks_milestone_idx"].every((name) =>
    rows
      .filter((r) => r.indexname === name)
      .every((r) => /WHERE\s+\(.*IS NOT NULL\)/i.test(r.indexdef))
  );

  if (rows.length === 10 && partialOk) {
    record("Q4", "Índices Sprint 2 (5 idx × 2 tenants, parciales OK)", "ok", `${rows.length} filas`);
  } else if (rows.length === 10) {
    record("Q4", "Índices Sprint 2 (parciales sin WHERE)", "warn", "los partial idx no llevan IS NOT NULL");
  } else {
    record("Q4", "Índices Sprint 2", "fail", `esperado 10 filas, obtenido ${rows.length}`);
  }
}

async function q5_fk_board_column(s) {
  out("\n══ Query 5 — FK física tasks.board_column_id");
  const [rows] = await s.query(`
    SELECT n.nspname AS schema, conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE conname = 'tasks_board_column_fk'
    ORDER BY 1
  `);
  printTable(
    rows.map((r) => [r.schema, r.conname, r.definition]),
    ["schema", "conname", "definition"]
  );

  const allOk =
    rows.length === 2 &&
    rows.every(
      (r) =>
        /board_column_id/i.test(r.definition) &&
        /REFERENCES.*board_columns\(id\)/i.test(r.definition) &&
        /ON DELETE SET NULL/i.test(r.definition)
    );
  if (allOk) {
    record("Q5", "FK tasks_board_column_fk (ON DELETE SET NULL)", "ok", `${rows.length} schemas`);
  } else if (rows.length === 2) {
    record("Q5", "FK tasks_board_column_fk presente pero definición rara", "warn", "revisar pg_get_constraintdef");
  } else {
    record("Q5", "FK tasks_board_column_fk", "fail", `esperado 2 filas, obtenido ${rows.length}`);
  }
}

async function q6_rowcounts(s) {
  out("\n══ Query 6 — Conteo de filas en task_assignees");
  const [rows] = await s.query(`
    SELECT 'crm_aumenta' AS schema, COUNT(*)::int AS n FROM crm_aumenta.task_assignees
    UNION ALL
    SELECT 'crm_demo' AS schema, COUNT(*)::int AS n FROM crm_demo.task_assignees
  `);
  printTable(rows.map((r) => [r.schema, r.n]), ["schema", "count"]);
  const total = rows.reduce((acc, r) => acc + r.n, 0);
  // El backfill del migrate dijo 0 — esperado 0 en ambos. Si hay filas extra,
  // probablemente vienen del seed o de pruebas previas — apuntamos como warn,
  // no fail.
  if (total === 0) {
    record("Q6", "task_assignees vacías (backfill=0 confirmado)", "ok", "0 filas en ambos");
  } else {
    record("Q6", "task_assignees con filas (post-seed o pruebas)", "warn", `total=${total}`);
  }
}

async function q7_unique_partial_projects_code(s) {
  out("\n══ Query 7 — UNIQUE PARCIAL projects.code");
  const [rows] = await s.query(`
    SELECT schemaname AS schema, indexname, indexdef
    FROM pg_indexes
    WHERE indexname LIKE '%projects_code%'
    ORDER BY schemaname, indexname
  `);
  printTable(
    rows.map((r) => [r.schema, r.indexname, r.indexdef]),
    ["schema", "indexname", "indexdef"]
  );

  // Solo verificamos los 2 schemas con módulo projects activo
  const relevant = rows.filter((r) => ["crm_aumenta", "crm_demo"].includes(r.schema));
  const allPartial =
    relevant.length === 2 &&
    relevant.every(
      (r) => /UNIQUE/i.test(r.indexdef) && /WHERE\s+\(?code IS NOT NULL\)?/i.test(r.indexdef)
    );
  if (allPartial) {
    record("Q7", "UNIQUE PARCIAL projects.code (crm_aumenta + crm_demo)", "ok", `${relevant.length}/2`);
  } else if (relevant.length === 2) {
    record(
      "Q7",
      "Index projects.code presente pero NO parcial",
      "warn",
      "índice existe sin WHERE code IS NOT NULL — revisar"
    );
  } else {
    record("Q7", "UNIQUE PARCIAL projects.code", "fail", `obtenido ${relevant.length}/2`);
  }
}

async function q8_orphans(s) {
  out("\n══ Query 8 — Defensa: tasks con board_column_id huérfano");
  const queries = [
    {
      schema: "crm_aumenta",
      sql: `
        SELECT COUNT(*)::int AS n
        FROM crm_aumenta.tasks t
        WHERE t.board_column_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM crm_aumenta.board_columns bc WHERE bc.id = t.board_column_id)
      `,
    },
    {
      schema: "crm_demo",
      sql: `
        SELECT COUNT(*)::int AS n
        FROM crm_demo.tasks t
        WHERE t.board_column_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM crm_demo.board_columns bc WHERE bc.id = t.board_column_id)
      `,
    },
  ];
  const counts = [];
  for (const q of queries) {
    const [rows] = await s.query(q.sql);
    counts.push([q.schema, rows[0]?.n ?? 0]);
  }
  printTable(counts, ["schema", "tasks_huerfanas"]);

  const total = counts.reduce((acc, [, n]) => acc + n, 0);
  if (total === 0) {
    record("Q8", "Sin tasks huérfanas (FK aplicada limpia)", "ok", "0 en ambos");
  } else {
    record("Q8", "Tasks huérfanas detectadas", "fail", `total=${total}`);
  }
}

// ─── Resumen ────────────────────────────────────────────────────────────────

function printSummary() {
  out("\n══════════════════════════════════════════════════════════════════════");
  out("  RESUMEN VERIFICACIÓN");
  out("══════════════════════════════════════════════════════════════════════");
  const widths = [4, 60, 30];
  const sep = "  +" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const fmt = (cells) =>
    "  | " + cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join(" | ") + " |";
  out(sep);
  out(fmt(["ID", "Check", "Detalle"]));
  out(sep);
  for (const r of RESULTS) {
    out(fmt([`${statusIcon(r.status)} ${r.id}`, r.label, r.note]));
  }
  out(sep);

  const ok = RESULTS.filter((r) => r.status === "ok").length;
  const warn = RESULTS.filter((r) => r.status === "warn").length;
  const fail = RESULTS.filter((r) => r.status === "fail").length;
  out(`\n  ✅ ${ok} ok   ⚠️  ${warn} warn   ❌ ${fail} fail   (total ${RESULTS.length})`);
  return fail === 0;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  out("\n════════════════════════════════════════════════════════");
  out(" Verificación: Proyectos Sprint 2 (Kanban)             ");
  out("════════════════════════════════════════════════════════");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  try {
    const [v] = await sequelize.query("SHOW server_version");
    out(`  PostgreSQL: ${v[0]?.server_version ?? "?"}`);

    await q1_tableExists(sequelize);
    await q2_structure(sequelize);
    await q3_constraints(sequelize);
    await q4_indexes(sequelize);
    await q5_fk_board_column(sequelize);
    await q6_rowcounts(sequelize);
    await q7_unique_partial_projects_code(sequelize);
    await q8_orphans(sequelize);

    const ok = printSummary();
    await sequelize.close();
    process.exit(ok ? 0 : 1);
  } catch (err) {
    await sequelize.close();
    process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
    process.exit(2);
  }
}

main();
