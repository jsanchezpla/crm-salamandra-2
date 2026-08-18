/**
 * rebuild-demo-showcase.js — Reconstruye el tenant `demo` como ESCAPARATE de ventas.
 *
 * Borra los datos actuales del demo y lo deja con TODOS los módulos funcionales
 * activos (sin override, salvo leads si se pide con --leads-aumenta), y lo llena
 * de datos de muestra en cada módulo. El demo es un tenant de demostración para
 * enseñar el CRM a clientes; NO tiene datos reales.
 *
 * ⚠️ DESTRUCTIVO: hace TRUNCATE de TODAS las tablas de crm_demo.
 *
 * A diferencia de reset-demo-tenant.js (bloqueado en prod), este SÍ puede correr
 * en producción — por eso el candado no es NODE_ENV, sino:
 *   · solo opera sobre el slug "demo" (hardcodeado),
 *   · sin --confirm es DRY RUN (imprime el plan y no toca nada).
 *
 * Uso local:  node --env-file=.env.local scripts/rebuild-demo-showcase.js --confirm
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/rebuild-demo-showcase.js --confirm
 *
 * Nota leads: la UI de leads del demo la decide el SLUG en
 * app/(dashboard)/leads/page.jsx, NO el campo tenant_modules.uiOverride. Desde
 * el 18/08/2026 la demo no tiene override: usa el módulo base (el de aumenta
 * parametrizado, con el embudo por defecto). Por eso aquí no se toca override
 * de leads; lo que hace que se vea completa es que el seed llena sus campos
 * (motivo, servicio, curso, taller, mensaje, tipo_usuario).
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

const SLUG = "demo";
const SCHEMA = `crm_${SLUG}`;
const CONFIRM = process.argv.includes("--confirm");
const __dirname = dirname(fileURLToPath(import.meta.url));

// Todos los módulos con página real, sin override (leads según flag). Se omiten
// los placeholders del sidebar sin pantalla (support, planning,
// analytics, ai, automations, integrations) y `sales` (duplica a leads).
// 2026-07-27: + formularios, referidos y documents (ya tienen página real).
const MODULES = [
  // 2026-08-10: fuera "cuestionarios" — dejó de ser un módulo, ahora es una
  // pantalla de Formación y viaja con `training`.
  "clients", "leads", "projects", "billing", "team", "inventory", "training",
  "calendar", "citas", "orders",
  "pacientes", "clinica", "nutricion", "outreach",
  // 2026-08-12: fuera "referidos" — el módulo se retiró entero.
  "formularios", "documents",
];

function log(m) { process.stdout.write(`  ${m}\n`); }
function header(m) { process.stdout.write(`\n▶ ${m}\n`); }

async function truncateAll(seq) {
  const [rows] = await seq.query(
    `SELECT table_name AS tn FROM information_schema.tables
     WHERE table_schema = '${SCHEMA}' AND table_type = 'BASE TABLE'`
  );
  const tables = rows.map((r) => r.tn);
  if (tables.length === 0) { log("· sin tablas que truncar"); return; }
  const list = tables.map((t) => `"${SCHEMA}"."${t}"`).join(", ");
  await seq.query(`SET session_replication_role = replica`);
  try {
    await seq.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    log(`✓ TRUNCATE de ${tables.length} tablas`);
  } finally {
    await seq.query(`SET session_replication_role = DEFAULT`);
  }
}

async function recreateSeries(seq) {
  const year = new Date().getFullYear();
  // id explícito: la tabla no tiene default en BD (Sequelize genera el UUID en JS).
  await seq.query(
    `INSERT INTO "${SCHEMA}"."invoice_series" (id,code,name,prefix,year,next_number,is_default,kind,created_at,updated_at)
     VALUES ('${randomUUID()}','F','Facturas ordinarias','F',${year},1,true,'normal',NOW(),NOW()) ON CONFLICT (code) DO NOTHING`
  );
  await seq.query(
    `INSERT INTO "${SCHEMA}"."invoice_series" (id,code,name,prefix,year,next_number,is_default,kind,created_at,updated_at)
     VALUES ('${randomUUID()}','R','Facturas rectificativas','R',${year},1,false,'rectificative',NOW(),NOW()) ON CONFLICT (code) DO NOTHING`
  );
  log("✓ series de facturación F y R");
}

function runScript(script, args = []) {
  log(`▷ ${script} ${args.join(" ")} ...`);
  const res = spawnSync(process.execPath, [join(__dirname, script), ...args], {
    stdio: "inherit",
    cwd: join(__dirname, ".."),
    env: process.env,
  });
  if (res.status !== 0) throw new Error(`${script} falló (código ${res.status})`);
}

function printPlan() {
  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" RECONSTRUIR demo (escaparate) — PLAN (DRY RUN)\n");
  process.stdout.write("══════════════════════════════════════════════════════════\n\n");
  process.stdout.write(`  1. Activar ${MODULES.length} módulos: ${MODULES.join(", ")}\n`);
  process.stdout.write(`     · se DESACTIVAN los módulos del demo que no estén en esa lista\n`);
  process.stdout.write(`  2. sync(): crear las tablas que falten en ${SCHEMA}\n`);
  process.stdout.write(`  3. TRUNCATE de TODAS las tablas de ${SCHEMA} (borra los datos actuales)\n`);
  process.stdout.write(`  4. Recrear series de facturación F y R\n`);
  process.stdout.write(`  5. Sembrar datos de muestra en todos los módulos (+ Captación)\n\n`);
  process.stdout.write("  Nada tocado. Para ejecutar de verdad: añade --confirm\n\n");
}

async function main() {
  if (SLUG !== "demo") throw new Error("Este script SOLO opera sobre el tenant 'demo'");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no configurada");

  if (!CONFIRM) { printPlan(); process.exit(0); }

  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" RECONSTRUIR demo (escaparate) — EJECUCIÓN\n");
  process.stdout.write("══════════════════════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, TenantModule, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error("Tenant 'demo' no encontrado en master.tenants");

  // 1) Módulos: activar el set (leads con su override), desactivar los que sobren.
  header("Configurando módulos...");
  for (const moduleKey of MODULES) {
    const [mod, created] = await TenantModule.findOrCreate({
      where: { tenantId: tenant.id, moduleKey },
      defaults: {
        tenantId: tenant.id, moduleKey, enabled: true, version: "1.0.0",
        schemaExtensions: {}, logicOverrides: {}, uiOverride: null, featureFlags: {},
      },
    });
    if (!created) await mod.update({ enabled: true, uiOverride: null, logicOverrides: {}, schemaExtensions: {}, featureFlags: {} });
    log(`${created ? "✓" : "·"} ${moduleKey}`);
  }
  for (const m of await TenantModule.findAll({ where: { tenantId: tenant.id } })) {
    if (!MODULES.includes(m.moduleKey) && m.enabled) {
      await m.update({ enabled: false });
      log(`· ${m.moduleKey} → desactivado (no está en el escaparate)`);
    }
  }

  // Acceso: el/los admin del demo ven TODOS los módulos (incluida Captación).
  const [nAccess] = await User.update(
    { moduleAccess: ["all"] },
    { where: { tenantId: tenant.id, role: ["admin", "superadmin"] } }
  );
  log(`✓ acceso "todos los módulos" para ${nAccess} usuario(s) admin del demo`);

  // 2) Tablas: sync crea las que falten para los módulos recién activados.
  header(`Creando tablas que falten en ${SCHEMA} (sync)...`);
  const { sequelize } = getTenantDb(SLUG);
  await sequelize.sync();
  log("✓ sync completado");

  // 3) Vaciar
  header(`Vaciando ${SCHEMA} (TRUNCATE)...`);
  await truncateAll(sequelize);

  // 4) Filas críticas
  header("Recreando filas críticas...");
  await recreateSeries(sequelize);

  invalidateTenantCache(SLUG);
  await closeAllConnections();

  // 5) Datos de muestra (cada seed abre su propia conexión)
  header("Sembrando datos de muestra en todos los módulos...");
  runScript("seed-sandbox-data.js", [SLUG]); // clientes, equipo, leads, billing, citas, clínica, nutrición…
  runScript("seed-outreach.js", [SLUG]); // Captación: líneas de negocio + leads de muestra

  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Demo reconstruido como escaparate.\n");
  process.stdout.write(`   Módulos activos: ${MODULES.length}\n`);
  process.stdout.write("══════════════════════════════════════════════════════════\n\n");
  process.exit(0);
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  try { await closeAllConnections(); } catch { /* noop */ }
  process.exit(1);
});
