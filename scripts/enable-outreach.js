/**
 * enable-outreach.js — Activa el módulo `outreach` para un tenant.
 *
 * Debe ejecutarse ANTES de la migración: migrate-outreach-sprint-1.js sólo
 * crea tablas en los tenants que tienen el módulo habilitado (regla #12: la
 * lista de schemas se lee de master.tenants en runtime, nunca se hardcodea).
 *
 * Uso: node --env-file=.env.local scripts/enable-outreach.js <slug>
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

const slug = process.argv[2];
if (!slug) {
  process.stderr.write("\n✗ Falta el slug del tenant.\n  Uso: node --env-file=.env.local scripts/enable-outreach.js <slug>\n\n");
  process.exit(1);
}

getMasterDb();
const { Tenant, TenantModule } = getMasterModels();

const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) {
  process.stderr.write(`\n✗ No existe el tenant "${slug}"\n\n`);
  process.exit(1);
}

const [mod, created] = await TenantModule.findOrCreate({
  where: { tenantId: tenant.id, moduleKey: "outreach" },
  defaults: {
    tenantId: tenant.id,
    moduleKey: "outreach",
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
process.stdout.write(`\n✓ Módulo outreach ${created ? "creado" : "ya existía"} y habilitado para "${slug}" (${tenant.name})\n`);
process.stdout.write("  Siguiente paso: node --env-file=.env.local scripts/migrate-outreach-sprint-1.js\n\n");
process.exit(0);
