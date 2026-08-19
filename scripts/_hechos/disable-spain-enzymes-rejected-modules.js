/**
 * disable-spain-enzymes-rejected-modules.js
 *
 * Spain Enzymes ha rechazado tres módulos: orders (Pedidos),
 * billing (Facturación) e inventory (Inventario). Este script los
 * desactiva sin borrar nada de código:
 *
 * 1. Marca `enabled = false` en `master.tenant_modules` para
 *    orders, billing e inventory del tenant spain_enzymes.
 *    Mantiene la fila para conservar `schemaExtensions`,
 *    `logicOverrides`, `featureFlags` por si se reactiva en
 *    el futuro.
 *
 * 2. Quita "orders", "billing" e "inventory" del array
 *    `moduleAccess` de TODOS los usuarios del tenant
 *    (admin y demás roles).
 *
 * NO toca:
 *  - Tablas/datos del schema `crm_spain_enzymes` (eso lo hace
 *    `clear-spain-enzymes-data.js`).
 *  - Modelos Sequelize, endpoints, componentes React.
 *  - Otros módulos del tenant (clients, leads, ...).
 *
 * Idempotente: se puede ejecutar varias veces sin efecto secundario.
 *
 * Uso local:  node scripts/disable-spain-enzymes-rejected-modules.js
 * Uso VPS:    docker compose exec app node scripts/disable-spain-enzymes-rejected-modules.js
 */

import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { closeAllConnections } from "../../lib/db/tenantDb.js";

const SLUG = "spain_enzymes";
const MODULES_TO_DISABLE = ["orders", "billing", "inventory"];

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Spain Enzymes — Desactivar módulos     \n");
  process.stdout.write(`  orders, billing, inventory             \n`);
  process.stdout.write("════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  header("Verificando tenant spain_enzymes...");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`\n✗ Tenant ${SLUG} no encontrado en master.tenants.\n`);
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  header("Desactivando módulos en master.tenant_modules...");
  let modulesDisabled = 0;
  let modulesAlreadyOff = 0;
  let modulesMissing = 0;
  for (const key of MODULES_TO_DISABLE) {
    const row = await TenantModule.findOne({
      where: { tenantId: tenant.id, moduleKey: key },
    });
    if (!row) {
      log(`  · ${key.padEnd(10)} no estaba registrado — nada que hacer`);
      modulesMissing++;
      continue;
    }
    if (row.enabled === false) {
      log(`  · ${key.padEnd(10)} ya estaba desactivado`);
      modulesAlreadyOff++;
      continue;
    }
    await row.update({ enabled: false });
    log(`  ✓ ${key.padEnd(10)} desactivado`);
    modulesDisabled++;
  }

  header("Quitando módulos de moduleAccess de los usuarios...");
  const users = await User.findAll({ where: { tenantId: tenant.id } });
  if (users.length === 0) {
    log("· No hay usuarios en este tenant");
  }
  let usersUpdated = 0;
  for (const user of users) {
    const access = Array.isArray(user.moduleAccess) ? user.moduleAccess : [];
    const cleaned = access.filter((m) => !MODULES_TO_DISABLE.includes(m));
    if (cleaned.length === access.length) {
      log(`  · ${user.email} ya no tenía acceso a ninguno`);
      continue;
    }
    const removed = access.filter((m) => MODULES_TO_DISABLE.includes(m));
    await user.update({ moduleAccess: cleaned });
    log(`  ✓ ${user.email}: removidos [${removed.join(", ")}]`);
    usersUpdated++;
  }

  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Resumen                                 \n");
  process.stdout.write("════════════════════════════════════════\n");
  log(`Tenant:              ${tenant.name}`);
  log(`Módulos desactivados: ${modulesDisabled}`);
  log(`Ya estaban off:      ${modulesAlreadyOff}`);
  log(`No registrados:      ${modulesMissing}`);
  log(`Usuarios depurados:  ${usersUpdated} / ${users.length}`);
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(" Importante: invalidar caché del tenant. \n");
  process.stdout.write(" Reiniciar la app o esperar 60s (TTL del \n");
  process.stdout.write(" caché de tenant context).               \n");
  process.stdout.write("════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
