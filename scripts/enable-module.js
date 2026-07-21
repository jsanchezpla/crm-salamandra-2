/**
 * enable-module.js — activa un módulo para un tenant Y DEJA SU SCHEMA LISTO.
 *
 * LA VÍA CORRECTA para dar de alta un módulo a un cliente. Sustituye a la
 * costumbre de escribir un script nuevo por cada alta (`add-training-module-demo.js`,
 * `add-leads-module-nutri-laura.js`, …): esos son parches de un solo uso, y en
 * cada uno hay que acordarse a mano de correr las migraciones. Acordarse falla:
 * eso es lo que provocó el incidente del 2026-07-21 (activar un módulo dejaba el
 * schema atrás y toda lectura reventaba con 42703).
 *
 * Aquí las dos mitades van juntas y en el orden correcto:
 *   1. Escribe la fila en master.tenant_modules (el cambio de DATOS).
 *   2. Lanza scripts/ensure-tenant-schema.js (el cambio de ESTRUCTURA).
 *
 * Es idempotente de punta a punta: si el módulo ya estaba, se limita a poner el
 * schema al día. Se puede repetir sin miedo.
 *
 * USO
 *   node --env-file=.env.local scripts/enable-module.js <slug> <moduleKey>
 *   node --env-file=.env.local scripts/enable-module.js <slug> <moduleKey> --dry-run
 *   node --env-file=.env.local scripts/enable-module.js <slug> <moduleKey> --skip-schema
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/enable-module.js <slug> <moduleKey>
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";
import { MODULE_KEYS } from "../lib/tenant/moduleKeys.js";
import { MODULES } from "./_module-migrations.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [slug, moduleKey] = argv.filter((a) => !a.startsWith("--"));

function die(msg) {
  process.stderr.write(`\n✗ ${msg}\n\n`);
  process.exit(1);
}

if (!slug || !moduleKey) {
  die("Faltan argumentos.\n  Uso: node --env-file=.env.local scripts/enable-module.js <slug> <moduleKey>");
}

getMasterDb();
const { Tenant, TenantModule } = getMasterModels();

const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

// `moduleKey` es un string libre sin enum ni FK (ver lib/tenant/moduleKeys.js):
// un typo como "document" crea una fila huérfana que no casa con nada y que
// nadie detecta hasta que el cliente se queja. Como MODULE_KEYS está a medias
// (solo DOCUMENTS, el resto es backlog), se cruzan tres fuentes de verdad. No se
// bloquea —un módulo nuevo tiene que poder estrenarse— pero se avisa fuerte y se
// exige --force, que es lo que distingue un módulo nuevo de un dedazo.
const enUso = await TenantModule.findAll({ attributes: ["moduleKey"], group: ["moduleKey"], raw: true });
const conocidos = new Set([
  ...Object.values(MODULE_KEYS),
  ...Object.keys(MODULES),
  ...enUso.map((r) => r.moduleKey),
]);
if (!conocidos.has(moduleKey)) {
  if (!flags.has("--force")) {
    die(
      `"${moduleKey}" no aparece en ningún sitio conocido: ¿es un typo?\n` +
        `  Conocidos: ${[...conocidos].sort().join(", ")}\n` +
        "  Si de verdad es un módulo nuevo, repite con --force."
    );
  }
  process.stdout.write(`\n  ⚠ "${moduleKey}" es desconocido y se acepta por --force.\n`);
}

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(` Alta de módulo "${moduleKey}" en "${slug}" (${tenant.name})\n`);
process.stdout.write("══════════════════════════════════════════════════════\n\n");

const migraciones = MODULES[moduleKey] || [];
if (migraciones.length === 0) {
  process.stdout.write(`  ⚠ El módulo "${moduleKey}" no tiene migraciones en el mapa\n`);
  process.stdout.write("    (scripts/_module-migrations.js). Si debería tenerlas, añádelas ahí.\n\n");
}

if (flags.has("--dry-run")) {
  process.stdout.write("  --dry-run: no se toca nada.\n");
  process.stdout.write(`  · Se habilitaría master.tenant_modules(${slug}, ${moduleKey})\n`);
  process.stdout.write(`  · Se ejecutaría ensure-tenant-schema.js ${slug}\n\n`);
  process.exit(0);
}

// ── 1. El cambio de DATOS ───────────────────────────────────────────────────
const [mod, created] = await TenantModule.findOrCreate({
  where: { tenantId: tenant.id, moduleKey },
  defaults: {
    tenantId: tenant.id,
    moduleKey,
    enabled: true,
    version: "1.0.0",
    schemaExtensions: {},
    logicOverrides: {},
    uiOverride: null,
    featureFlags: {},
  },
});
if (!created && !mod.enabled) await mod.update({ enabled: true });
invalidateTenantCache(slug);
process.stdout.write(`  ✓ Módulo ${created ? "creado" : "ya existía"} y habilitado\n`);

// ── 2. El cambio de ESTRUCTURA ──────────────────────────────────────────────
if (flags.has("--skip-schema")) {
  process.stdout.write("\n  ⚠ --skip-schema: NO se han corrido las migraciones.\n");
  process.stdout.write(`    Acuérdate de: node scripts/ensure-tenant-schema.js ${slug}\n\n`);
  process.exit(0);
}

process.stdout.write("\n  ▶ Poniendo el schema al día...\n\n");
const r = spawnSync(process.execPath, [join(HERE, "ensure-tenant-schema.js"), slug, "--module", moduleKey], {
  env: process.env,
  stdio: "inherit",
});

if (r.status !== 0) {
  process.stderr.write(
    "\n✗ El módulo quedó HABILITADO pero las migraciones fallaron.\n" +
      `  El schema de "${slug}" puede estar incompleto: revisa el error de arriba y\n` +
      `  vuelve a lanzar  node scripts/ensure-tenant-schema.js ${slug}\n\n`
  );
  process.exit(1);
}

process.stdout.write(`\n✓ "${moduleKey}" activo y schema de "${slug}" al día.\n\n`);
process.exit(0);
