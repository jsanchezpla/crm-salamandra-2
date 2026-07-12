/**
 * setup-outreach.js — Despliegue completo del módulo Outreach (captación) en uno
 * o varios tenants, en UN SOLO comando. Orquesta, en orden, los scripts ya
 * existentes y probados (no duplica DDL):
 *
 *   1. enable-outreach.js <slug>          activa el módulo en master.tenant_modules
 *   2. migrate-outreach-sprint-1.js       crea las 5 tablas outreach_*
 *   3. migrate-outreach-google-usage.js   contador Google Places en outreach_settings
 *   4. migrate-outreach-convert.js        campos de conversión a cliente en outreach_leads
 *   5. migrate-outreach-website-text.js   website VARCHAR(255) → TEXT (URLs largas)
 *   6. seed-outreach.js <slug>            (solo con --seed) datos de muestra
 *
 * Las 3 migraciones leen la lista de tenants con `outreach` activo desde
 * master.tenant_modules en runtime (regla #12): por eso basta con enable + migrar.
 * Todo es idempotente — se puede relanzar sin romper nada.
 *
 * No hardcodea slugs ni --env-file: hereda DATABASE_URL del proceso padre y se la
 * pasa a los hijos. Así el MISMO script vale para local y para el VPS.
 *
 * Uso local (PowerShell):
 *   node --env-file=.env.local scripts/setup-outreach.js <slug> [slug2...] [--seed]
 *
 * Uso VPS (dentro del contenedor, la env de producción ya está cargada):
 *   docker exec crm-salamandra-app-1 node scripts/setup-outreach.js <slug> [--seed]
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const seed = args.includes("--seed");
const slugs = args.filter((a) => !a.startsWith("--"));

if (slugs.length === 0) {
  process.stderr.write(
    "\n✗ Falta al menos un slug de tenant.\n" +
      "  Uso: node --env-file=.env.local scripts/setup-outreach.js <slug> [slug2...] [--seed]\n\n"
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  process.stderr.write(
    "\n✗ DATABASE_URL no configurada.\n" +
      "  En local añade --env-file=.env.local; en el VPS ejecútalo dentro del contenedor.\n\n"
  );
  process.exit(1);
}

function run(script, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(scriptsDir, script), ...scriptArgs], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} salió con código ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  process.stdout.write("\n╔════════════════════════════════════════════════╗\n");
  process.stdout.write("║  Setup Outreach — despliegue completo            ║\n");
  process.stdout.write("╚════════════════════════════════════════════════╝\n");
  process.stdout.write(`  Tenants: ${slugs.join(", ")}${seed ? "  (+ seed de muestra)" : ""}\n`);

  // 1) Activar el módulo en cada tenant indicado (idempotente)
  for (const slug of slugs) {
    await run("enable-outreach.js", [slug]);
  }

  // 2) Migraciones — leen los tenants con outreach activo desde master en runtime
  await run("migrate-outreach-sprint-1.js");
  await run("migrate-outreach-google-usage.js");
  await run("migrate-outreach-convert.js");
  await run("migrate-outreach-website-text.js");

  // 3) Datos de muestra (opcional, --seed)
  if (seed) {
    for (const slug of slugs) {
      await run("seed-outreach.js", [slug]);
    }
  }

  process.stdout.write(`\n✓ Outreach listo en: ${slugs.join(", ")}\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Setup abortado: ${err.message}\n\n`);
  process.exit(1);
});
