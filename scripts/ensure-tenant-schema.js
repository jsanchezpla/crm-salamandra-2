/**
 * ensure-tenant-schema.js — pone al día el schema de un tenant.
 *
 * EL PROBLEMA QUE RESUELVE
 * Activar un módulo para un tenant es un cambio de DATOS (una fila en
 * master.tenant_modules), pero las tablas y columnas de ese módulo son
 * ESTRUCTURA. Hasta ahora nadie cerraba ese hueco: se activaba el módulo, el
 * schema se quedaba como estaba, y la primera lectura reventaba con 42703. Fue
 * lo que tumbó las reservas públicas de tunutrilaura.com y lo que encontramos el
 * 2026-07-21 en crm_salamandra_solutions.
 *
 * Este script es el disparador: mira qué módulos tiene el tenant, consulta el
 * mapa de scripts/_module-migrations.js y ejecuta las migraciones que le
 * corresponden, en el orden canónico.
 *
 * Todas las migraciones son idempotentes y recorren por dentro todos los tenants
 * (o todos los schemas con la tabla), así que ejecutarlas de más es inofensivo:
 * para los demás tenants son un no-op. Por eso este script se puede correr las
 * veces que haga falta.
 *
 * USO
 *   node --env-file=.env.local scripts/ensure-tenant-schema.js <slug>
 *   node --env-file=.env.local scripts/ensure-tenant-schema.js <slug> --module citas
 *   node --env-file=.env.local scripts/ensure-tenant-schema.js <slug> --dry-run
 *
 *   --module X   Añade X a los módulos detectados. Útil al llamarlo desde un
 *                script de alta ANTES de que la fila esté commiteada.
 *   --dry-run    Enseña qué ejecutaría, sin tocar nada.
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/ensure-tenant-schema.js <slug>
 */

import { Sequelize } from "sequelize";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationsFor, mapInconsistencies } from "./_module-migrations.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function log(m) { process.stdout.write(`  ${m}\n`); }
function header(m) { process.stdout.write(`\n▶ ${m}\n`); }

function parseArgs(argv) {
  const args = { slug: null, extraModules: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--module") args.extraModules.push(argv[++i]);
    else if (!a.startsWith("--") && !args.slug) args.slug = a;
  }
  return args;
}

async function tenantModules(s, slug) {
  const [rows] = await s.query(
    `SELECT t.status, tm.module_key
       FROM master.tenants t
       LEFT JOIN master.tenant_modules tm
              ON tm.tenant_id = t.id AND tm.enabled = TRUE
      WHERE t.slug = :slug`,
    { replacements: { slug } }
  );
  if (rows.length === 0) return null;
  return {
    status: rows[0].status,
    modules: rows.map((r) => r.module_key).filter(Boolean).sort(),
  };
}

function runMigration(name, slug) {
  const file = join(HERE, `${name}.js`);
  if (!existsSync(file)) return { name, ok: false, out: "el fichero no existe" };
  const r = spawnSync(process.execPath, [file], {
    /*
     * ⚠️ ACOTADO AL TENANT QUE SE PIDIÓ (11/08/2026).
     *
     * Hasta hoy aquí iba `process.env` a secas, y como las hijas se lanzan SIN
     * argumentos, cada migración decidía su propio alcance. Treinta y una de
     * las que dispara el alta se enumeran solas —«todos los tenants activos»—,
     * así que `ensure-tenant-schema.js aumenta` acababa entrando en el schema
     * de todos los demás clientes. Dar de alta a un cliente nuevo tocaba
     * Aumenta, con quince personas trabajando dentro.
     *
     * `ONLY_SCHEMAS` no es nueva: es la que ya entendía `_schema-targets.js` en
     * modo exclusivo. Las migraciones que usan ese helper quedan acotadas solo
     * con ponerla; las que se enumeran a mano pasan su lista por
     * `acotarSlugs()` de `_solo-este-tenant.js`.
     *
     * Si quien llama ya la traía puesta, manda la suya: acotar más es seguro,
     * y así `ONLY_SCHEMAS=... node scripts/ensure-tenant-schema.js` sigue
     * sirviendo para lo que servía.
     */
    env: { ...process.env, ONLY_SCHEMAS: process.env.ONLY_SCHEMAS || `crm_${slug}` },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  return { name, ok: r.status === 0, out };
}

async function main() {
  const { slug, extraModules, dryRun } = parseArgs(process.argv.slice(2));

  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  process.stdout.write(" ensure-tenant-schema — poner al día el schema de un tenant\n");
  process.stdout.write("══════════════════════════════════════════════════════\n");

  if (!slug) {
    process.stderr.write("\n✗ Falta el slug.\n  Uso: node scripts/ensure-tenant-schema.js <slug> [--module X] [--dry-run]\n\n");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  // Salud del mapa: si alguien añade una migración a MODULES y olvida ponerla en
  // ORDER, se ejecutaría en un orden arbitrario. Mejor avisar alto y claro.
  const { sinOrden, huerfanas } = mapInconsistencies();
  if (sinOrden.length) {
    process.stderr.write(`\n✗ Mapa incoherente: ${sinOrden.join(", ")} está(n) en MODULES/CORE pero no en ORDER.\n`);
    process.exit(1);
  }
  if (huerfanas.length) log(`⚠ En ORDER pero sin módulo asignado (no se ejecutan): ${huerfanas.join(", ")}`);

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const info = await tenantModules(s, slug);
  if (!info) {
    process.stderr.write(`\n✗ No existe el tenant "${slug}" en master.tenants\n`);
    await s.close();
    process.exit(1);
  }
  if (info.status !== "active") log(`⚠ El tenant está en estado "${info.status}", no "active".`);
  await s.close();

  const modules = [...new Set([...info.modules, ...extraModules])].sort();
  header(`Tenant: ${slug}  (schema crm_${slug})`);
  log(`Módulos activos: ${modules.length ? modules.join(", ") : "ninguno"}`);
  if (extraModules.length) log(`· forzados por --module: ${extraModules.join(", ")}`);

  const migraciones = migrationsFor(modules);
  header(`Migraciones a ejecutar: ${migraciones.length}`);
  migraciones.forEach((m, i) => log(`${String(i + 1).padStart(2)}. ${m}`));

  if (dryRun) {
    process.stdout.write("\n· --dry-run: no se ha ejecutado nada.\n\n");
    process.exit(0);
  }

  header("Ejecutando...");
  log(`(acotadas a crm_${slug}: ninguna toca el schema de otro cliente)`);
  const fallos = [];
  for (const m of migraciones) {
    const r = runMigration(m, slug);
    if (r.ok) {
      log(`✓ ${m}`);
    } else {
      log(`✗ ${m} — FALLO`);
      r.out.split("\n").slice(-8).forEach((l) => log(`    ${l}`));
      fallos.push(m);
    }
  }

  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  if (fallos.length) {
    process.stdout.write(` ✗ ${fallos.length} de ${migraciones.length} fallaron: ${fallos.join(", ")}\n`);
    process.stdout.write("══════════════════════════════════════════════════════\n\n");
    process.exit(1);
  }
  process.stdout.write(` ✓ Schema de "${slug}" al día (${migraciones.length} migraciones)\n`);
  process.stdout.write("══════════════════════════════════════════════════════\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
