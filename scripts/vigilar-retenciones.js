/**
 * vigilar-retenciones.js — vigila el dinero retenido en las tarjetas.
 *
 * Lo lanza un temporizador de systemd en el VPS UNA VEZ POR HORA (mismo patrón
 * que scripts/enviar-recordatorios.js). Hace dos cosas:
 *
 *   1. AVISA a la profesional de las retenciones que van a caducar (a 36 h y
 *      otra vez a 6 h). Una retención caducada es una cita que ya no se puede
 *      cobrar online.
 *   2. RECONCILIA las que ya han caducado: le pregunta a Stripe por el estado
 *      real y lo deja escrito. Sin esto, el CRM seguiría enseñando "Retenido,
 *      sin cobrar" sobre un dinero que ya no existe — y ella pulsaría
 *      "Confirmar y cobrar" esperando un ingreso y se encontraría un error.
 *
 * Correrlo de más no duplica avisos (van deduplicados contra la propia tabla de
 * notificaciones) y correrlo de menos no rompe nada: solo retrasa el aviso.
 *
 * NO cancela ninguna cita. Que el dinero se evapore no significa que la persona
 * deje de querer su hora.
 *
 * Uso:
 *   node --env-file=.env.local scripts/vigilar-retenciones.js --simular
 *   docker exec crm-salamandra-app-1 node scripts/vigilar-retenciones.js
 *
 * Con --simular no escribe ni avisa: solo dice cuántas tocaría.
 */

import { getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { vigilarRetencionesDeTenant } from "../lib/citas/caducidadRetencion.js";

const SIMULAR = process.argv.includes("--simular");

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }

  header(`Retenciones de tarjeta · ${new Date().toISOString()}${SIMULAR ? " (SIMULACIÓN)" : ""}`);

  const { Tenant, TenantModule } = getMasterModels();
  const tenants = await Tenant.findAll({ where: { status: "active" } });

  let totalAvisadas = 0;
  let totalReconciliadas = 0;

  for (const tenant of tenants) {
    const tieneCitas = await TenantModule.findOne({
      where: { tenantId: tenant.id, moduleKey: "citas", enabled: true },
      attributes: ["id"],
    });
    if (!tieneCitas) continue;

    try {
      const { models } = getTenantDb(tenant.slug);
      // Contexto mínimo: lo que necesitan `getStripe` (settings del tenant) y
      // las consultas (modelos). No se usa el resolver de tenant porque
      // arrastra next/server y no carga en un script suelto.
      const ctx = { slug: tenant.slug, tenant, tenantModels: models };
      const res = await vigilarRetencionesDeTenant(ctx, { simular: SIMULAR });

      if (res.motivo) continue; // sin stripe o sin tablas: nada que vigilar
      totalAvisadas += res.avisadas;
      totalReconciliadas += res.reconciliadas;

      if (res.revisadas > 0) {
        log(
          `${tenant.slug}: ${res.revisadas} retención(es) en ventana — ` +
          `${res.avisadas} aviso(s), ${res.reconciliadas} reconciliada(s)`
        );
      }
    } catch (err) {
      log(`${tenant.slug}: ERROR ${err.message}`);
    }
  }

  header(
    `Total: ${totalAvisadas} aviso(s), ${totalReconciliadas} retención(es) reconciliada(s)`
  );
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
