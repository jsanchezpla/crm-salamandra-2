/**
 * enviar-recordatorios.js — manda los recordatorios de las citas de mañana.
 *
 * Lo lanza un temporizador de systemd en el VPS UNA VEZ POR HORA (ver
 * scripts/deploy/crm-recordatorios.timer). La ventana de envío es ancha
 * (18-30h antes) y cada cita se marca al enviarse, así que correrlo de más no
 * duplica correos y correrlo de menos no deja a nadie sin avisar.
 *
 * Recorre los tenants ACTIVOS que tengan el módulo citas y lo hayan activado
 * en Configuración (`settings.citas.recordatorios`), que está APAGADO por
 * defecto: encenderlo hace que empiecen a salir correos a pacientes reales y
 * esa decisión es del cliente.
 *
 * Uso:
 *   node --env-file=.env.local scripts/enviar-recordatorios.js --simular
 *   docker exec crm-salamandra-app-1 node scripts/enviar-recordatorios.js
 *
 * Con --simular no manda nada: solo dice a cuántos escribiría. Útil para
 * comprobar la configuración de un cliente antes de encenderlo de verdad.
 */

import { getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { enviarRecordatoriosDeTenant, recordatoriosActivos } from "../lib/citas/recordatorios.js";

const SIMULAR = process.argv.includes("--simular");
const BASE_URL = process.env.APP_PUBLIC_URL || "https://crm.salamandrasolutions.com";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }

  const marca = new Date().toISOString();
  header(`Recordatorios de cita · ${marca}${SIMULAR ? " (SIMULACIÓN)" : ""}`);

  const { Tenant, TenantModule } = getMasterModels();
  const tenants = await Tenant.findAll({ where: { status: "active" } });

  let totalEnviados = 0;
  let totalFallidos = 0;

  for (const tenant of tenants) {
    if (!recordatoriosActivos(tenant)) continue;

    const tieneCitas = await TenantModule.findOne({
      where: { tenantId: tenant.id, moduleKey: "citas", enabled: true },
      attributes: ["id"],
    });
    if (!tieneCitas) {
      log(`${tenant.slug}: recordatorios activados pero sin módulo citas. Se salta.`);
      continue;
    }

    try {
      const { models } = getTenantDb(tenant.slug);
      const res = await enviarRecordatoriosDeTenant({
        tenant,
        tenantModels: models,
        slug: tenant.slug,
        baseUrl: BASE_URL,
        simular: SIMULAR,
      });
      totalEnviados += res.enviados;
      totalFallidos += res.fallidos;
      log(`${tenant.slug}: ${res.enviados} enviado(s)${res.fallidos ? `, ${res.fallidos} fallido(s)` : ""} de ${res.candidatas} cita(s) en ventana`);
    } catch (err) {
      log(`${tenant.slug}: ERROR ${err.message}`);
    }
  }

  header(`Total: ${totalEnviados} recordatorio(s)${totalFallidos ? `, ${totalFallidos} fallo(s)` : ""}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
