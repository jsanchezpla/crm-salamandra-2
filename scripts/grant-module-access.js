/**
 * grant-module-access.js — dar (o quitar) acceso a un módulo a los usuarios de
 * un tenant.
 *
 * POR QUÉ EXISTE: activar un módulo con `enable-module.js` lo enciende para el
 * TENANT, pero cada usuario tiene además su propia lista `master.users
 * .module_access`. Si esa lista existe y no incluye la clave del módulo, la
 * persona ve la entrada en el menú y toda la API le responde 403 — un fallo
 * que parece un bug del módulo nuevo y no lo es. Hasta ahora esto se hacía a
 * mano con SQL, y por eso se olvidaba.
 *
 * Un usuario con `module_access` NULL o vacío NO se toca: eso significa "todos
 * los módulos del tenant", y meterle una lista se la restringiría.
 *
 * Uso:
 *   node scripts/grant-module-access.js <slug> <moduleKey>
 *   node scripts/grant-module-access.js <slug> <moduleKey> --revoke
 *   node scripts/grant-module-access.js <slug> <moduleKey> --dry-run
 *
 * Ejemplos:
 *   node --env-file=.env.local scripts/grant-module-access.js nutri_laura formularios
 *   docker exec crm-salamandra-app-1 node scripts/grant-module-access.js nutri_laura formularios
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  const [slug, moduleKey, ...flags] = process.argv.slice(2);
  const revocar = flags.includes("--revoke");
  const ensayo = flags.includes("--dry-run");

  if (!slug || !moduleKey) {
    process.stderr.write(
      "\nUso: node scripts/grant-module-access.js <slug> <moduleKey> [--revoke] [--dry-run]\n\n"
    );
    process.exit(1);
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(` Acceso al módulo "${moduleKey}" · tenant "${slug}"${ensayo ? " (ENSAYO)" : ""}\n`);
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug } });
  if (!tenant) {
    process.stderr.write(`✗ No existe el tenant "${slug}"\n`);
    process.exit(1);
  }

  // Aviso, no bloqueo: puede querer prepararse el acceso antes de activar.
  const modulo = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey } });
  if (!modulo || !modulo.enabled) {
    log(`⚠ Ojo: el módulo "${moduleKey}" NO está activo para este tenant.`);
    log(`  Actívalo con: node scripts/enable-module.js ${slug} ${moduleKey}`);
    log("");
  }

  const usuarios = await User.findAll({ where: { tenantId: tenant.id } });
  if (usuarios.length === 0) {
    log("· El tenant no tiene usuarios.");
    process.exit(0);
  }

  let tocados = 0;
  for (const u of usuarios) {
    const lista = Array.isArray(u.moduleAccess) ? u.moduleAccess : null;

    if (!lista || lista.length === 0) {
      log(`· ${u.email}: sin restricciones (ve todos los módulos) — no se toca`);
      continue;
    }

    const tiene = lista.includes(moduleKey);

    if (revocar) {
      if (!tiene) { log(`· ${u.email}: ya no lo tenía`); continue; }
      const nueva = lista.filter((k) => k !== moduleKey);
      if (!ensayo) await u.update({ moduleAccess: nueva });
      log(`✓ ${u.email}: RETIRADO "${moduleKey}" (${nueva.length} módulos)`);
      tocados++;
    } else {
      if (tiene) { log(`· ${u.email}: ya lo tenía`); continue; }
      const nueva = [...lista, moduleKey];
      if (!ensayo) await u.update({ moduleAccess: nueva });
      log(`✓ ${u.email}: AÑADIDO "${moduleKey}" (${nueva.length} módulos)`);
      tocados++;
    }
  }

  if (tocados > 0 && !ensayo) {
    invalidateTenantCache(slug);
    log("");
    log("Caché del tenant invalidada.");
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(` ${ensayo ? "Ensayo: se habrían tocado" : "Usuarios actualizados:"} ${tocados}\n`);
  process.stdout.write("══════════════════════════════════════════════════\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
