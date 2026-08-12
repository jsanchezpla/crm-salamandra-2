/**
 * add-showcase-modules-demo.js — completa el ESCAPARATE: activa en el tenant
 * demo los módulos con página real que le faltaban (formularios, referidos,
 * documents). Los placeholders sin pantalla (ai/analytics/automations/
 * integrations/planning/support/sales/communications/client_portal) se quedan
 * fuera a propósito: en una demo pública un enlace a un 404 es vender humo.
 *
 * Idempotente (findOrCreate + update enabled). Solo toca master.tenant_modules
 * del slug demo; los datos del tenant no se tocan (la foto dorada no cambia).
 *
 * Uso local:  node --env-file=.env.local scripts/add-showcase-modules-demo.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/add-showcase-modules-demo.js
 */
import { getMasterModels } from "../lib/db/masterDb.js";

const SLUG = "demo";
// `referidos` estaba aquí y se cayó el 12/08/2026 con el módulo entero.
const MODULES = ["formularios", "documents"];

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  const { Tenant, TenantModule } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) { process.stderr.write(`✗ No existe el tenant ${SLUG}\n`); process.exit(1); }

  for (const moduleKey of MODULES) {
    const [row, created] = await TenantModule.findOrCreate({
      where: { tenantId: tenant.id, moduleKey },
      defaults: { enabled: true, version: "1.0.0" },
    });
    if (!created && !row.enabled) await row.update({ enabled: true });
    log(`✓ ${moduleKey} ${created ? "creado y activado" : row.enabled ? "ya activo / activado" : "activado"}`);
  }

  // No se importa invalidateTenantCache: el resolver arrastra next/server y no
  // carga en un script suelto. La caché del tenant expira sola en 60 s.
  log("Listo (la config del tenant se refresca sola en ≤60 s).");
  process.exit(0);
}

main().catch((e) => { process.stderr.write(`✗ Error: ${e.message}\n`); process.exit(1); });
