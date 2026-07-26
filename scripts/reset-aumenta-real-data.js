/**
 * reset-aumenta-real-data.js — deja el CRM de Aumenta LIMPIO para uso real.
 *
 * Aumenta pasa de escaparate con datos de ejemplo a CRM en producción real
 * (2026-07-24). Este script borra TODOS los datos de ejemplo de crm_aumenta,
 * con TRES excepciones (decisión de Rodrigo):
 *
 *   1. LEADS: son datos REALES → se conservan. Solo se les quitan los enlaces
 *      a registros que sí se borran (cliente convertido, proyecto, asignado).
 *   2. CONFIGURACIÓN: tipos de cita (event_types, availabilities), series de
 *      facturación (se resetea su contador a 1), ajustes de facturación y de
 *      pedidos, plantillas de proyecto.
 *   3. master: usuarios (login del admin), tenant, módulos y AUDIT LOG (la
 *      auditoría nunca se borra — regla de CLAUDE.md). Este script NO toca
 *      master en absoluto.
 *
 * SEGURIDAD:
 *   - Por defecto es DRY-RUN: ejecuta todo en una transacción, enseña cuántas
 *     filas borraría de cada tabla y hace ROLLBACK.
 *   - Solo borra de verdad con el flag --confirm.
 *   - Todo o nada: una sola transacción; cualquier error → ROLLBACK.
 *   - Solo actúa sobre el schema crm_aumenta (tenant one-off a propósito).
 *
 * Uso local:  node --env-file=.env.local scripts/reset-aumenta-real-data.js [--confirm]
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/reset-aumenta-real-data.js [--confirm]
 */

import { Sequelize } from "sequelize";

const SCHEMA = "crm_aumenta";
const CONFIRM = process.argv.includes("--confirm");

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

/**
 * Orden de borrado calculado a mano de las FK reales (hijos antes que padres).
 * Las tablas que NO están aquí se conservan: leads, event_types, availabilities,
 * invoice_series, tenant_billing_settings, order_settings, project_templates.
 */
const WIPE_ORDER = [
  // Clínica (hijos de patients/team_members)
  "notifications",
  "incidencias",
  "incentive_items",
  "performance_metrics",
  "clinical_reports",
  "clinic_sessions",
  "coordinations",
  // Facturación y pedidos (payments→invoices; orders.invoice_id→invoices)
  "payments",
  "stock_movements",
  "quotes",
  "recurring_invoices",
  "order_lines",
  "orders",
  "invoices",
  "costs",
  "rates",
  // Proyectos
  "task_assignees",
  "tasks",
  "milestones",
  "phases",
  "board_columns",
  "project_members",
  "projects",
  // Citas y calendario (bookings→patients, así que antes que patients)
  "bookings",
  "calendar_tasks",
  // Clientes y su órbita
  "client_attachments",
  "client_notes",
  "interactions",
  "client_contact_methods",
  "client_module_assignments",
  "contacts",
  "documents",
  "document_folders",
  "assets",
  "patients",
  "client_outbound_aliases",
  "clients",
  // Inventario
  "formulas",
  "inbound_batches",
  "inbound_products",
  "outbound_products",
  // Formación
  "course_enrollments",
  "quiz_attempts",
  "course_registrations",
  "company_courses",
  "courses",
  "training_users",
  "companies",
  "trainings",
  "training_sync_log",
  // Comunicaciones/soporte
  "messages",
  "tickets",
  // Equipo AL FINAL (media BD le apunta con FK)
  "team_member_modules",
  "team_members",
];

async function tableExists(s, t, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [SCHEMA, table], transaction: t }
  );
  return rows.length > 0;
}

async function count(s, t, table) {
  const [rows] = await s.query(`SELECT count(*)::int AS n FROM "${SCHEMA}"."${table}"`, { transaction: t });
  return rows[0].n;
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════════════\n");
  process.stdout.write(` Reset Aumenta → CRM real ${CONFIRM ? "(EJECUCIÓN REAL)" : "(DRY-RUN, no borra nada)"}\n`);
  process.stdout.write("════════════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // Sanity: el tenant y su schema deben existir.
  const [[tenant]] = await s.query(`SELECT id FROM master.tenants WHERE slug = 'aumenta' AND status = 'active'`);
  if (!tenant) {
    process.stderr.write("✗ Tenant 'aumenta' no existe o no está activo. Nada que hacer.\n");
    await s.close();
    process.exit(1);
  }

  // CERROJO: este script era del ARRANQUE (2026-07-24), cuando todo eran datos
  // de ejemplo. Si ya existen los logins del equipo real (nombre_aumenta),
  // Aumenta está EN USO y volver a ejecutarlo arrasaría datos reales (equipo,
  // pacientes, citas…). Se niega incluso con --confirm; solo se puede forzar
  // con FORCE_RESET_AUMENTA=1, a conciencia.
  const [[{ n: realUsers }]] = await s.query(
    `SELECT count(*)::int AS n FROM master.users u
      WHERE u.tenant_id = '${tenant.id}' AND u.email LIKE '%\\_aumenta' ESCAPE '\\'`
  );
  if (realUsers > 0 && process.env.FORCE_RESET_AUMENTA !== "1") {
    process.stderr.write(
      `✗ CERROJO: hay ${realUsers} usuarios del equipo real (nombre_aumenta) — Aumenta ya está en uso real.\n` +
      `  Este script era del arranque; re-ejecutarlo borraría datos REALES.\n` +
      `  Si de verdad quieres resetear, exporta FORCE_RESET_AUMENTA=1.\n`
    );
    await s.close();
    process.exit(1);
  }

  let leadsBefore = 0;
  let leadsAfter = 0;
  const report = [];

  try {
    await s.transaction(async (t) => {
      leadsBefore = await count(s, t, "leads");

      header("1) Desenganchar leads de los registros que se borran");
      const [, updated] = await s.query(
        `UPDATE "${SCHEMA}"."leads"
            SET client_id = NULL, assigned_to = NULL, converted_project_id = NULL
          WHERE client_id IS NOT NULL OR assigned_to IS NOT NULL OR converted_project_id IS NOT NULL`,
        { transaction: t }
      );
      log(`leads desenganchados: ${updated?.rowCount ?? 0} filas actualizadas (los leads NO se borran)`);

      header("2) Borrado de datos de ejemplo (hijos → padres)");
      for (const table of WIPE_ORDER) {
        if (!(await tableExists(s, t, table))) {
          report.push({ table, deleted: "no existe" });
          continue;
        }
        const n = await count(s, t, table);
        if (n > 0) await s.query(`DELETE FROM "${SCHEMA}"."${table}"`, { transaction: t });
        report.push({ table, deleted: n });
        log(`${n > 0 ? "✓" : "·"} ${table}: ${n} filas`);
      }

      header("3) Resetear numeración de las series de factura (config se queda)");
      if (await tableExists(s, t, "invoice_series")) {
        const [, r] = await s.query(
          `UPDATE "${SCHEMA}"."invoice_series" SET next_number = 1 WHERE next_number <> 1`,
          { transaction: t }
        );
        log(`invoice_series: contador a 1 (${r?.rowCount ?? 0} series tocadas)`);
      }

      leadsAfter = await count(s, t, "leads");
      if (leadsAfter !== leadsBefore) {
        throw new Error(`GUARDIA: los leads han cambiado (${leadsBefore} → ${leadsAfter}). ROLLBACK.`);
      }

      if (!CONFIRM) {
        throw new Error("__DRY_RUN__"); // fuerza ROLLBACK; no es un error real
      }
    });
  } catch (err) {
    if (err.message === "__DRY_RUN__") {
      header("DRY-RUN completado — TODO se ha revertido (ROLLBACK)");
      log(`leads que se conservarían: ${leadsBefore}`);
      log("Para ejecutar de verdad: añade --confirm");
      await s.close();
      process.exit(0);
    }
    process.stderr.write(`\n✗ Error (se ha hecho ROLLBACK, no se borró nada): ${err.message}\n`);
    await s.close();
    process.exit(1);
  }

  header("✓ Limpieza COMPLETADA y confirmada");
  log(`leads conservados: ${leadsAfter} (antes: ${leadsBefore})`);
  const totalDeleted = report.reduce((acc, r) => acc + (typeof r.deleted === "number" ? r.deleted : 0), 0);
  log(`filas borradas en total: ${totalDeleted}`);
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
