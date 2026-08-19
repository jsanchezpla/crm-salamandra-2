/**
 * enable-outreach.js — Activa el módulo `outreach` para un tenant y deja su
 * schema listo (llama a ensure-tenant-schema.js al terminar).
 *
 * Para altas nuevas es preferible el genérico:
 *   node --env-file=.env.local scripts/enable-module.js <slug> outreach
 * Este se mantiene por compatibilidad con `npm run db:enable:outreach`.
 *
 * Uso: node --env-file=.env.local scripts/enable-outreach.js <slug>
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../lib/tenant/tenantResolver.js";

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

// Antes esto solo imprimía "siguiente paso: corre la migración" y quedaba en que
// alguien se acordara. No acordarse es justo lo que rompió schemas el
// 2026-07-21, así que ahora se dispara solo.
process.stdout.write("\n  ▶ Poniendo el schema al día...\n\n");
const r = spawnSync(
  process.execPath,
  [join(dirname(fileURLToPath(import.meta.url)), "ensure-tenant-schema.js"), slug, "--module", "outreach"],
  { env: process.env, stdio: "inherit" }
);
if (r.status !== 0) {
  process.stderr.write(
    `\n✗ Módulo habilitado, pero las migraciones fallaron. El schema de "${slug}" puede\n` +
      `  estar incompleto: revisa el error y relanza  node scripts/ensure-tenant-schema.js ${slug}\n\n`
  );
  process.exit(1);
}
process.stdout.write(`\n✓ Captación lista en "${slug}".\n\n`);
process.exit(0);
