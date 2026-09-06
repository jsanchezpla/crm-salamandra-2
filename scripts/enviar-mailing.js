/**
 * enviar-mailing.js — avanza las campañas de mailing que están saliendo y
 * arranca las programadas cuya hora ha llegado.
 *
 * Lo lanza un temporizador de systemd en el VPS CADA MINUTO (ver
 * scripts/deploy/crm-mailing.timer), igual que los recordatorios de cita van
 * cada hora. Es la pieza que hace que el envío no dependa de que nadie tenga
 * el navegador abierto (plan del módulo, 2.4: «el envío no ocurre en una
 * petición web»).
 *
 * Qué hace, por cada tenant ACTIVO con el módulo `mailing`:
 *   0. Las SECUENCIAS activas (sprint 2): mete en su campaña automática a
 *      quien le toque hoy (alta, cumpleaños, sin cita) y la avanza.
 *   1. Las campañas `programada` con `programada_para <= ahora` se PREPARAN
 *      (audiencia → filas de mailing_sends) y pasan a `enviando`.
 *   2. Las campañas `enviando` avanzan por lotes hasta agotar el presupuesto
 *      de tiempo de esta pasada (50 s: la siguiente pasada llega en un
 *      minuto). Reanudar es seguro: UNIQUE (campaign_id, email) y filas
 *      reclamadas con FOR UPDATE SKIP LOCKED, así que puede coincidir con la
 *      pantalla sin duplicar a nadie.
 *
 * Correrlo de más no manda nada dos veces; correrlo de menos solo retrasa.
 *
 * Uso:
 *   node --env-file=.env.local scripts/enviar-mailing.js --simular
 *   docker exec crm-salamandra-app-1 node scripts/enviar-mailing.js
 *
 * Con --simular dice qué haría y no toca nada.
 */

import { getMasterModels } from "../lib/db/masterDb.js";
import { getTenantContextPorSlug } from "../lib/tenant/tenantResolver.js";
import { avanzarCampana, campanasPendientesDeEnvio, prepararCampana } from "../lib/mailing/envio.js";
import { procesarSecuencias } from "../lib/mailing/secuencias.js";
import { getTenantSesConfig } from "../lib/mailing/ses.js";
import { esSlugDemo } from "../lib/demo/demos.js";

const SIMULAR = process.argv.includes("--simular");
const PRESUPUESTO_MS = 50_000;

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const inicio = Date.now();
  header(`Mailing · ${new Date().toISOString()}${SIMULAR ? " (SIMULACIÓN)" : ""}`);

  const { Tenant, TenantModule } = getMasterModels();
  const filas = await TenantModule.findAll({ where: { moduleKey: "mailing", enabled: true }, attributes: ["tenantId"], raw: true });
  const tenants = filas.length
    ? await Tenant.findAll({ where: { id: filas.map((f) => f.tenantId), status: "active" }, order: [["slug", "ASC"]] })
    : [];

  let total = 0;
  for (const tenant of tenants) {
    // Las demos son públicas: nunca mandan nada, aunque alguien les pusiera claves.
    if (esSlugDemo(tenant.slug)) continue;
    let ctx;
    try {
      ctx = await getTenantContextPorSlug(tenant.slug);
    } catch (err) {
      log(`${tenant.slug}: sin contexto (${err.message})`);
      continue;
    }
    if (!getTenantSesConfig(ctx).configurado) continue;

    // ── 0. Secuencias ──
    if (!SIMULAR) {
      try {
        const r = await procesarSecuencias(ctx, { presupuestoMs: Math.max(5000, PRESUPUESTO_MS - (Date.now() - inicio) - 10000) });
        for (const x of r) {
          if (x.nuevos || x.enviados) log(`${tenant.slug}: secuencia «${x.nombre}» +${x.nuevos} nuevos, ${x.enviados} enviados`);
          total += x.enviados;
        }
      } catch (err) {
        log(`${tenant.slug}: ERROR en secuencias: ${err.message}`);
      }
    }

    let campanas;
    try {
      campanas = await campanasPendientesDeEnvio(ctx);
    } catch (err) {
      log(`${tenant.slug}: ERROR leyendo campañas: ${err.message}`);
      continue;
    }
    if (!campanas.length) continue;

    for (const campana of campanas) {
      if (Date.now() - inicio > PRESUPUESTO_MS) {
        log(`${tenant.slug}: presupuesto agotado, el resto en la siguiente pasada`);
        break;
      }
      try {
        if (campana.estado === "programada") {
          if (SIMULAR) {
            log(`${tenant.slug}: «${campana.nombre}» arrancaría ahora (programada para ${campana.programadaPara?.toISOString()})`);
            continue;
          }
          const p = await prepararCampana(ctx, campana);
          log(`${tenant.slug}: «${campana.nombre}» arrancada: ${p.total} destinatario(s)`);
        }
        if (SIMULAR) {
          log(`${tenant.slug}: «${campana.nombre}» avanzaría (enviados ${campana.enviados} de ${campana.totalDestinatarios})`);
          continue;
        }
        let ritmo = null;
        let vueltas = 0;
        // Lotes seguidos hasta terminar o agotar el presupuesto; el ritmo lo
        // marca la cuenta (se consulta una vez por campaña y pasada).
        while (Date.now() - inicio < PRESUPUESTO_MS && vueltas < 50) {
          vueltas++;
          const r = await avanzarCampana(ctx, campana, {
            lote: 100,
            ritmo,
            presupuestoMs: Math.max(1000, PRESUPUESTO_MS - (Date.now() - inicio)),
          });
          total += r.enviados;
          ritmo = ritmo ?? (r.ritmoUsado || null);
          if (r.terminada || r.pausada || r.pendientes === 0) {
            log(`${tenant.slug}: «${campana.nombre}» ${r.terminada ? "TERMINADA" : r.pausada ? "PAUSADA" : "sin pendientes"} (+${r.enviados} enviados, ${r.fallidos} fallidos)`);
            break;
          }
          if (r.procesados === 0) break;
          log(`${tenant.slug}: «${campana.nombre}» +${r.enviados} enviados, quedan ${r.pendientes}`);
        }
      } catch (err) {
        log(`${tenant.slug}: «${campana.nombre}» ERROR ${err.message}`);
        try {
          await campana.update({ estado: "pausada", ultimoError: String(err.message).slice(0, 500) });
        } catch {
          /* se verá en la siguiente pasada */
        }
      }
    }
  }

  header(`Total: ${total} correo(s) enviado(s) en ${Math.round((Date.now() - inicio) / 1000)} s`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
