/**
 * enable-documents-all-tenants.js — Activa el módulo `documents` en TODOS los
 * tenants activos (el módulo es genérico, aplica a todos).
 *
 * Debe ejecutarse ANTES de migrate-documents-sprint-1.js (la migración solo
 * crea tablas en tenants con el módulo habilitado — regla #12).
 *
 * Uso:
 *   npm run db:enable:documents        (local)
 *   npm run db:enable:documents:prod   (VPS — ver docs/modules/documents.md)
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";
import { MODULE_KEYS } from "../lib/tenant/moduleKeys.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Enable: módulo documents en TODOS los tenants activos\n");
  process.stdout.write("════════════════════════════════════════════════════\n\n");

  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  const tenants = await Tenant.findAll({ where: { status: "active" }, order: [["slug", "ASC"]] });
  if (tenants.length === 0) {
    log("· No hay tenants activos. Nada que hacer.");
    process.exit(0);
  }

  let createdCount = 0;
  let enabledCount = 0;
  for (const tenant of tenants) {
    const [mod, created] = await TenantModule.findOrCreate({
      where: { tenantId: tenant.id, moduleKey: MODULE_KEYS.DOCUMENTS },
      defaults: {
        tenantId: tenant.id,
        moduleKey: MODULE_KEYS.DOCUMENTS,
        enabled: true,
        version: "1.0.0",
        schemaExtensions: {},
        logicOverrides: {},
        uiOverride: null,
        featureFlags: {},
      },
    });
    let state;
    if (created) {
      createdCount++;
      state = "creado + habilitado";
    } else if (!mod.enabled) {
      await mod.update({ enabled: true });
      enabledCount++;
      state = "re-habilitado";
    } else {
      state = "ya habilitado";
    }
    invalidateTenantCache(tenant.slug);
    log(`✓ ${tenant.slug.padEnd(16)} → ${state}`);
  }

  process.stdout.write(
    `\n✓ Hecho. ${tenants.length} tenants (${createdCount} nuevos, ${enabledCount} re-habilitados).\n` +
      "  Siguiente paso: node --env-file=.env.local scripts/migrate-documents-sprint-1.js\n\n"
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  process.exit(1);
});
