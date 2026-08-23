/**
 * retirar-modulo-cuestionarios.js — ONE_OFF, 10/08/2026.
 *
 * QUÉ HACE
 * Apaga (`enabled = false`) las filas sobrantes de `master.tenant_modules` con
 * `module_key = 'cuestionarios'`. Nada más.
 *
 * POR QUÉ
 * Cuestionarios dejó de ser un módulo: sus siete endpoints piden `training` y
 * la clave salió del catálogo. Quedan dos filas encendidas (aumenta y demo) que
 * ya no significan nada, y `lib/provisioning/cicloVida.js:143` responde 422 a
 * una clave que no está en el catálogo. Es decir: mientras esas filas sigan
 * activas, editar los módulos de esos dos clientes desde el back-office puede
 * dar error.
 *
 * NO BORRA NADA. Ni la fila —se apaga, que es reversible con un UPDATE— ni por
 * supuesto la tabla `quiz_attempts`, donde Retorika guarda 526 intentos reales.
 * Los dos tenants afectados tienen `training`, así que siguen viendo
 * /formacion/cuestionarios exactamente igual que hoy.
 *
 * SECO POR DEFECTO. Sin `--aplicar` solo enseña lo que haría.
 *
 *   node --env-file=.env.local scripts/retirar-modulo-cuestionarios.js
 *   node --env-file=.env.local scripts/retirar-modulo-cuestionarios.js --aplicar
 *
 * En producción, dentro del contenedor:
 *   docker exec crm-salamandra-app-1 node scripts/retirar-modulo-cuestionarios.js
 */

import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";

const CLAVE = "cuestionarios";
const APLICAR = process.argv.includes("--aplicar");

const db = getMasterDb();
db.options.logging = false;
const { Tenant, TenantModule } = getMasterModels();

process.stdout.write("\n" + "═".repeat(72) + "\n");
process.stdout.write(`  Retirar el módulo '${CLAVE}'  ${APLICAR ? "· APLICANDO" : "· EN SECO (no escribe)"}\n`);
process.stdout.write("═".repeat(72) + "\n\n");

const filas = await TenantModule.findAll({ where: { moduleKey: CLAVE } });

if (!filas.length) {
  process.stdout.write("  No hay ninguna fila con esa clave. Nada que hacer.\n\n");
  await db.close();
  process.exit(0);
}

// Se comprueba UNO A UNO que el tenant tenga Formación: sin ella, apagar esta
// fila sí le quitaría la pantalla, y entonces esto no sería inocuo.
let bloqueado = false;
const aTocar = [];

for (const fila of filas) {
  const tenant = await Tenant.findByPk(fila.tenantId);
  const slug = tenant?.slug ?? `(tenant ${fila.tenantId})`;

  const training = await TenantModule.findOne({
    where: { tenantId: fila.tenantId, moduleKey: "training" },
  });
  const tieneFormacion = Boolean(training?.enabled);

  process.stdout.write(`  ${slug.padEnd(24)} ${CLAVE}=${fila.enabled ? "activo" : "apagado"}`);
  process.stdout.write(`   training=${tieneFormacion ? "activo ✓" : "NO ✗"}\n`);

  if (!fila.enabled) {
    process.stdout.write("      ↳ ya estaba apagado, se deja como está\n");
    continue;
  }
  if (!tieneFormacion) {
    process.stdout.write("      ⛔ NO tiene Formación: apagarlo le quitaría la pantalla. NO se toca.\n");
    bloqueado = true;
    continue;
  }
  aTocar.push({ fila, slug });
}

process.stdout.write("\n" + "─".repeat(72) + "\n");

if (!aTocar.length) {
  process.stdout.write("  No hay nada que apagar.\n\n");
  await db.close();
  process.exit(bloqueado ? 1 : 0);
}

process.stdout.write(`  Se apagarían ${aTocar.length} fila(s): ${aTocar.map((x) => x.slug).join(", ")}\n`);
process.stdout.write("  Para deshacerlo:\n");
for (const { fila, slug } of aTocar) {
  process.stdout.write(
    `    UPDATE master.tenant_modules SET enabled = true WHERE id = '${fila.id}';  -- ${slug}\n`
  );
}
process.stdout.write("─".repeat(72) + "\n\n");

if (!APLICAR) {
  process.stdout.write("  EN SECO: no se ha escrito nada. Repite con --aplicar.\n\n");
  await db.close();
  process.exit(0);
}

for (const { fila, slug } of aTocar) {
  await fila.update({ enabled: false });
  process.stdout.write(`  ✓ ${slug}: '${CLAVE}' apagado\n`);
}

process.stdout.write("\n  Hecho. `quiz_attempts` no se ha tocado en ningún tenant.\n\n");

await db.close();
