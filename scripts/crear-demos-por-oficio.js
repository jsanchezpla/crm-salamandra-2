/**
 * crear-demos-por-oficio.js — deja montadas las demos de CLÍNICA, NUTRICIÓN y
 * AGENCIA (13/08/2026, recado de Jorge del 12/08 y decisión de Rodrigo).
 *
 * ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
 * Había UNA demo pública con veinte módulos encendidos a la vez, y era lo que
 * veía cualquiera que pulsara «Prueba una demo». Una nutricionista se encontraba
 * un centro de psicología con almacén; un centro clínico, un recetario. Ahora
 * cada oficio tiene la suya, con sus módulos y su color, y se salta de una a
 * otra desde las pestañas de arriba (components/layout/DemoTabs.jsx).
 *
 * QUÉ HACE, por cada demo de `lib/demo/demos.js` que tenga lista de módulos:
 *   1. La crea si no existe (schema, tablas, módulos, admin) o le ajusta los
 *      módulos si ya estaba. Idempotente: se puede relanzar.
 *   2. Vacía su schema y lo vuelve a sembrar con datos de ejemplo.
 *   3. Le da su marca (colores), que es lo que hace que se NOTE el salto.
 *   4. Rehace su foto dorada, que es lo que la deja impecable para el siguiente
 *      visitante.
 *
 * ⚠️ DESTRUCTIVO sobre esas tres cuentas: hace TRUNCATE de todas sus tablas.
 * NO toca `demo` (la general), que la reconstruye `rebuild-demo-showcase.js`.
 *
 * Los frenos son los mismos que los de ese script, y por el mismo motivo (este
 * sí puede correr en producción):
 *   · solo opera sobre slugs que estén en `lib/demo/demos.js` — o sea, sobre
 *     demos; pedirle el slug de un cliente no hace nada,
 *   · sin `--confirm` es DRY RUN: imprime el plan y no toca nada.
 *
 * Uso local:  node --env-file=.env.local scripts/crear-demos-por-oficio.js --confirm
 *             node --env-file=.env.local scripts/crear-demos-por-oficio.js demo_clinica --confirm
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/crear-demos-por-oficio.js --confirm
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";
import { DEMOS, demoPorSlug } from "../lib/demo/demos.js";
import { altaTenant, ponerSchemaAlDia } from "../lib/provisioning/altaTenant.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG_PEDIDO = args.find((a) => !a.startsWith("--")) ?? null;

/**
 * Marca de cada demo. No es decoración: al saltar de pestaña cambia el CRM
 * entero, y sin un cambio de color el visitante no sabe si ha pasado algo. El
 * color de la barra de pestañas sale de `--color-primary`, así que la propia
 * barra cambia con él.
 */
const MARCA = {
  demo_clinica: { primaryColor: "#1F4B63", secondaryColor: "#4E7C8F" },
  demo_nutricion: { primaryColor: "#2F6B3F", secondaryColor: "#6FA278" },
  demo_agencia: { primaryColor: "#3B3A5E", secondaryColor: "#6C6A9B" },
};

const NOMBRE = {
  demo_clinica: "Centro Demo · Clínica",
  demo_nutricion: "Consulta Demo · Nutrición",
  demo_agencia: "Agencia Demo",
};

/** Seeds propios de cada oficio, además del genérico. */
const SEEDS = {
  demo_clinica: [["seed-clinica-demo.js", (s) => [s]]],
  demo_nutricion: [],
  demo_agencia: [
    ["seed-outreach.js", (s) => [s]],
    ["seed-analiticas-demo.js", (s) => [`--tenant=${s}`]],
  ],
};

function log(m) { process.stdout.write(`  ${m}\n`); }
function header(m) { process.stdout.write(`\n▶ ${m}\n`); }

function runScript(script, scriptArgs = []) {
  log(`▷ ${script} ${scriptArgs.join(" ")} ...`);
  const res = spawnSync(process.execPath, [join(__dirname, script), ...scriptArgs], {
    stdio: "inherit",
    cwd: join(__dirname, ".."),
    env: process.env,
  });
  // No lanza: un seed de adorno que falle no puede dejar la demo a medias sin
  // foto dorada, que es lo único que de verdad importa. Se dice y se sigue.
  if (res.status !== 0) log(`⚠ ${script} terminó con código ${res.status} — la demo sigue`);
}

async function truncateAll(seq, schema) {
  const [rows] = await seq.query(
    `SELECT table_name AS tn FROM information_schema.tables
      WHERE table_schema = '${schema}' AND table_type = 'BASE TABLE'`
  );
  const tables = rows.map((r) => r.tn);
  if (!tables.length) { log("· sin tablas que truncar"); return; }
  const list = tables.map((t) => `"${schema}"."${t}"`).join(", ");
  await seq.query(`SET session_replication_role = replica`);
  try {
    await seq.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    log(`✓ TRUNCATE de ${tables.length} tablas`);
  } finally {
    await seq.query(`SET session_replication_role = DEFAULT`);
  }
}

async function recreateSeries(seq, schema) {
  const year = new Date().getFullYear();
  // id explícito: la tabla no tiene default en BD (Sequelize genera el UUID en JS).
  for (const [code, name, prefix, isDefault, kind] of [
    ["F", "Facturas ordinarias", "F", true, "normal"],
    ["R", "Facturas rectificativas", "R", false, "rectificative"],
  ]) {
    await seq.query(
      `INSERT INTO "${schema}"."invoice_series" (id,code,name,prefix,year,next_number,is_default,kind,created_at,updated_at)
       VALUES ('${randomUUID()}','${code}','${name}','${prefix}',${year},1,${isDefault},'${kind}',NOW(),NOW())
       ON CONFLICT (code) DO NOTHING`
    );
  }
  log("✓ series de facturación F y R");
}

async function montar(demo) {
  const { slug, modulos } = demo;
  const schema = `crm_${slug}`;
  const { Tenant, TenantModule, User } = getMasterModels();

  let tenant = await Tenant.findOne({ where: { slug } });

  // ── 1. Alta o ajuste ──────────────────────────────────────────────────────
  if (!tenant) {
    header(`${slug}: no existe — creándola entera`);
    const res = await altaTenant({
      nombre: NOMBRE[slug] ?? slug,
      slug,
      modulos,
      adminEmail: `admin@${slug}.salamandra`,
      brand: MARCA[slug] ?? {},
      // `free`: `master.tenants.plan` es un enum cerrado (free/starter/pro/
      // enterprise) y no hay ningún «demo». El plan no gatea nada —se quitó de
      // Custodia el 12/08 por eso mismo—, pero un valor inventado revienta el
      // alta entera con un 22P02.
      plan: "free",
    });
    if (res.error) throw new Error(res.error);
    for (const h of res.hechos ?? []) log(`✓ ${h}`);
    for (const a of res.avisos ?? []) log(`⚠ ${a}`);
    // La contraseña no se enseña ni se guarda: a una demo se entra por el botón
    // público, que no pide ninguna (app/api/auth/demo/route.js). Si algún día
    // hiciera falta entrar con contraseña, se resetea con
    // scripts/reset-tenant-admin-password.js.
    tenant = await Tenant.findOne({ where: { slug } });
  } else {
    header(`${slug}: ya existe — ajustando módulos y marca`);
    const filas = await TenantModule.findAll({ where: { tenantId: tenant.id } });
    for (const clave of modulos) {
      const fila = filas.find((f) => f.moduleKey === clave);
      if (fila) await fila.update({ enabled: true });
      else await TenantModule.create({ tenantId: tenant.id, moduleKey: clave, enabled: true, version: "1.0.0" });
    }
    for (const f of filas) {
      if (!modulos.includes(f.moduleKey) && f.enabled) {
        await f.update({ enabled: false });
        log(`· ${f.moduleKey} → apagado (no es de este oficio)`);
      }
    }
    await tenant.update({
      status: "active",
      settings: { ...(tenant.settings ?? {}), brand: { ...(tenant.settings?.brand ?? {}), ...(MARCA[slug] ?? {}) } },
    });
    log(`✓ ${modulos.length} módulos activos`);
    const puesta = await ponerSchemaAlDia(slug, modulos);
    log(puesta.ok ? "✓ schema al día" : `⚠ migraciones: ${puesta.motivo}`);
  }

  // Los admin de la demo ven TODOS los módulos: sin esto, `users.module_access`
  // esconde en el menú lo que el tenant sí tiene contratado (la segunda puerta
  // del CLAUDE.md).
  const [nAccess] = await User.update(
    { moduleAccess: ["all"] },
    { where: { tenantId: tenant.id, role: ["admin", "superadmin"] } }
  );
  log(`✓ acceso a todos los módulos para ${nAccess} admin(s)`);

  // ── 2. Tablas y vaciado ───────────────────────────────────────────────────
  const { sequelize } = getTenantDb(slug);
  await sequelize.sync();
  await truncateAll(sequelize, schema);
  if (modulos.includes("billing")) await recreateSeries(sequelize, schema);

  invalidateTenantCache(slug);
  await closeAllConnections();

  // ── 3. Datos de ejemplo ───────────────────────────────────────────────────
  header(`${slug}: sembrando datos de ejemplo`);
  runScript("seed-sandbox-data.js", [slug]);
  for (const [script, argsDe] of SEEDS[slug] ?? []) runScript(script, argsDe(slug));
}

function plan(demos) {
  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" DEMOS POR OFICIO — PLAN (DRY RUN)\n");
  process.stdout.write("══════════════════════════════════════════════════════════\n\n");
  for (const d of demos) {
    process.stdout.write(`  ${d.slug}  «${NOMBRE[d.slug] ?? d.slug}»\n`);
    process.stdout.write(`     ${d.modulos.length} módulos: ${d.modulos.join(", ")}\n`);
    process.stdout.write(`     se crea si no existe, se VACÍA y se siembra de nuevo\n\n`);
  }
  process.stdout.write("  Después: foto dorada de cada una (demo-golden-snapshot.js)\n");
  process.stdout.write("  Nada tocado. Para ejecutar de verdad: añade --confirm\n\n");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no configurada");

  // El freno: solo se puede pedir una DEMO. Un slug de cliente no existe aquí.
  let objetivo = DEMOS.filter((d) => Array.isArray(d.modulos) && d.modulos.length);
  if (SLUG_PEDIDO) {
    const d = demoPorSlug(SLUG_PEDIDO);
    if (!d) throw new Error(`"${SLUG_PEDIDO}" no es una demo (ver lib/demo/demos.js)`);
    if (!Array.isArray(d.modulos)) {
      throw new Error(
        `"${SLUG_PEDIDO}" es la demo general: sus módulos los manda scripts/rebuild-demo-showcase.js`
      );
    }
    objetivo = [d];
  }

  if (!CONFIRM) { plan(objetivo); process.exit(0); }

  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(" DEMOS POR OFICIO — EJECUCIÓN\n");
  process.stdout.write("══════════════════════════════════════════════════════════\n");

  getMasterDb();
  for (const d of objetivo) await montar(d);

  // ── 4. La foto dorada, sin la que nada de esto se limpia solo ─────────────
  header("Rehaciendo las fotos doradas");
  for (const d of objetivo) runScript("demo-golden-snapshot.js", [d.slug]);

  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write(` ✓ ${objetivo.length} demo(s) listas: ${objetivo.map((d) => d.slug).join(", ")}\n`);
  process.stdout.write("══════════════════════════════════════════════════════════\n\n");
  process.exit(0);
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  try { await closeAllConnections(); } catch { /* noop */ }
  process.exit(1);
});
