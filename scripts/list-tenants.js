// @vivo — Herramienta de inspección genérica, solo lectura: lista todos los tenants con estado y módulos activos. (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * list-tenants.js — Lista TODOS los tenants con sus módulos activos (SOLO LECTURA).
 *
 * No modifica nada; seguro en producción.
 *
 * Uso local:  node --env-file=.env.local scripts/list-tenants.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/list-tenants.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

getMasterDb();
const { Tenant, TenantModule } = getMasterModels();

const tenants = await Tenant.findAll({ order: [["slug", "ASC"]] });

process.stdout.write(`\n${tenants.length} tenants en este entorno:\n`);
process.stdout.write("──────────────────────────────────────────────────────────\n");

for (const t of tenants) {
  const mods = await TenantModule.findAll({
    where: { tenantId: t.id, enabled: true },
    attributes: ["moduleKey"],
    order: [["moduleKey", "ASC"]],
  });
  const keys = mods.map((m) => m.moduleKey).join(", ") || "(ninguno)";
  process.stdout.write(`\n  ${t.slug}  [${t.status}]  —  ${t.name}\n`);
  process.stdout.write(`    módulos: ${keys}\n`);
}

process.stdout.write("\n");
process.exit(0);
