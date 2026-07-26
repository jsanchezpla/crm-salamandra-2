/**
 * check-links.js — chequeo de salud de las conexiones cliente/equipo.
 *
 * Recorre cada schema de tenant y cuenta, por tabla, cuántos registros están
 * SUELTOS: sin cliente cuando deberían tenerlo, o sin miembro de equipo. Es la
 * red que faltaba: el problema de fondo no era que faltasen enlaces, sino que
 * NADA avisaba cuando algo se quedaba sin conectar (así estuvieron meses las
 * citas de Aumenta).
 *
 * SOLO LECTURA. No modifica nada. Pensado para lanzarlo de vez en cuando y ver
 * si algo se está despegando.
 *
 * Uso local:  node --env-file=.env.local scripts/check-links.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/check-links.js
 *   Un tenant:  ... scripts/check-links.js nutri_laura
 */

import { Sequelize } from "sequelize";

// tabla → { col, etiqueta, cond? }. `cond` acota qué filas DEBERÍAN tener el
// enlace (p. ej. solo las citas de verdad, no las pre-citas).
const CHECKS = [
  { tabla: "bookings", col: "client_id", que: "citas sin ficha de cliente" },
  { tabla: "documents", col: "client_id", que: "documentos sin cliente" },
  { tabla: "clinic_sessions", col: "client_id", que: "sesiones sin cliente" },
  { tabla: "clinical_reports", col: "client_id", que: "informes sin cliente" },
  { tabla: "coordinations", col: "client_id", que: "coordinaciones sin cliente" },
  { tabla: "plans", col: "team_member_id", que: "planes sin nutricionista", cond: "type = 'template'" },
  { tabla: "interactions", col: "team_member_id", que: "interacciones sin autor" },
  { tabla: "client_notes", col: "team_member_id", que: "notas sin autor" },
  { tabla: "form_submissions", col: "handled_by_team_id", que: "solicitudes atendidas sin equipo", cond: "status <> 'pending'" },
  { tabla: "patients", col: "client_id", que: "pacientes sin ficha de pagador" },
];

async function tablaExiste(s, schema, tabla) {
  const [[{ existe }]] = await s.query(
    `SELECT to_regclass('"${schema}"."${tabla}"') IS NOT NULL AS existe`
  );
  return existe;
}

async function tieneColumna(s, schema, tabla, col) {
  const [[{ hay }]] = await s.query(
    `SELECT count(*) > 0 AS hay FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = :tabla AND column_name = :col`,
    { replacements: { schema, tabla, col } }
  );
  return hay;
}

async function main() {
  const soloTenant = process.argv[2] || null;

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Chequeo de salud: conexiones cliente / equipo\n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const [schemasRows] = await s.query(
    `SELECT schema_name FROM information_schema.schemata
      WHERE schema_name LIKE 'crm_%' ORDER BY schema_name`
  );
  let schemas = schemasRows.map((r) => r.schema_name);
  if (soloTenant) schemas = schemas.filter((sc) => sc === `crm_${soloTenant}`);

  let totalSueltos = 0;

  for (const schema of schemas) {
    const hallazgos = [];
    for (const chk of CHECKS) {
      if (!(await tablaExiste(s, schema, chk.tabla))) continue;
      if (!(await tieneColumna(s, schema, chk.tabla, chk.col))) continue;

      const where = [`${chk.col} IS NULL`];
      if (chk.cond) where.push(chk.cond);
      const [[{ sueltos, total }]] = await s.query(
        `SELECT count(*) FILTER (WHERE ${where.join(" AND ")}) AS sueltos,
                count(*) AS total
           FROM "${schema}"."${chk.tabla}"`
      );
      const n = Number(sueltos) || 0;
      if (n > 0) {
        hallazgos.push(`  ⚠ ${n} de ${total} ${chk.que}`);
        totalSueltos += n;
      }
    }

    if (hallazgos.length === 0) {
      process.stdout.write(`\n▶ ${schema}\n  ✓ todo conectado\n`);
    } else {
      process.stdout.write(`\n▶ ${schema}\n${hallazgos.join("\n")}\n`);
    }
  }

  process.stdout.write("\n──────────────────────────────────────────────────\n");
  process.stdout.write(
    totalSueltos === 0
      ? " ✓ Nada suelto en ningún tenant.\n"
      : ` Total de registros sueltos: ${totalSueltos}\n   (histórico anterior a los enlaces; los nuevos nacen conectados)\n`
  );
  process.stdout.write("──────────────────────────────────────────────────\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
