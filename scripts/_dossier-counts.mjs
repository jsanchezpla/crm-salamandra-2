// Solo lectura: cuenta filas por tabla del schema crm_sandbox para cuadrar el dossier.
// Uso: node --env-file=.env.local scripts/_dossier-counts.mjs
import { Sequelize } from "sequelize";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
const sequelize = new Sequelize(url, { logging: false });
const SCHEMA = "crm_sandbox";

// Lista todas las tablas del schema y cuenta filas de cada una.
const [tables] = await sequelize.query(
  `SELECT tablename AS table_name FROM pg_tables WHERE schemaname = '${SCHEMA}' ORDER BY tablename`
);
console.log("Tablas encontradas:", tables.length);

const rows = {};
for (const { table_name } of tables) {
  try {
    const [[{ n }]] = await sequelize.query(
      `SELECT COUNT(*)::int AS n FROM "${SCHEMA}"."${table_name}"`
    );
    rows[table_name] = n;
  } catch (e) {
    rows[table_name] = `ERR ${e.message}`;
  }
}

// Imprime solo tablas con datos primero, luego vacías.
const withData = Object.entries(rows).filter(([, n]) => typeof n === "number" && n > 0).sort((a, b) => b[1] - a[1]);
const empty = Object.entries(rows).filter(([, n]) => n === 0).map(([t]) => t);

console.log("\n=== TABLAS CON DATOS (crm_sandbox) ===");
for (const [t, n] of withData) console.log(String(n).padStart(5), t);
console.log("\n=== TABLAS VACÍAS ===");
console.log(empty.join(", ") || "(ninguna)");

await sequelize.close();
