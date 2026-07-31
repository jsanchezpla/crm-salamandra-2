/**
 * capturar-visitas-web.js — copia a la base de datos del CRM lo que Cloudflare
 * tenga de visitas de la web, para poder enseñar histórico largo.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Cloudflare Web Analytics conserva **7 días** (medido en producción el
 * 2026-07-31; ver MAX_DIAS_RUM). Pasada esa ventana el dato no se puede
 * recuperar de ninguna manera. Así que para tener meses, trimestres o años hay
 * que ir copiándolo mientras está disponible. Esto es esa copia.
 *
 * ── Cómo se comporta ───────────────────────────────────────────────────────
 *
 * · Recorre los tenants con el módulo `analytics` activo leyendo
 *   `master.tenants` en tiempo de ejecución (regla 12: nada de slugs a mano).
 * · De cada uno pide a Cloudflare los últimos N días (7 por defecto) y hace
 *   UPSERT día a día. Es IDEMPOTENTE: repetir la pasada corrige y no duplica.
 * · Al pedir 7 días cada día, la captura aguanta que el cron falle varios días
 *   seguidos: mientras no se pierdan 7 pasadas consecutivas, el hueco se rellena
 *   solo en la siguiente. Esa holgura es a propósito.
 * · Un tenant que falle (token caducado, Cloudflare caído) NO corta a los demás:
 *   se anota y se sigue. El código de salida es 1 si falló alguno, para que el
 *   cron lo pueda detectar.
 * · **El día en curso se guarda igual, aunque esté a medias**, y al día
 *   siguiente la pasada lo vuelve a escribir ya completo. Por eso el upsert
 *   sobreescribe en vez de sumar: sumar duplicaría las visitas de hoy en cada
 *   ejecución.
 *
 * Uso local:  node --env-file=.env.local scripts/capturar-visitas-web.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/capturar-visitas-web.js
 * Opciones:   --dias=N   cuántos días atrás pedir (tope: MAX_DIAS_RUM)
 *             --tenant=slug   solo ese tenant
 *             --dry-run  enseña lo que guardaría, sin escribir
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { consultarRum, MAX_DIAS_RUM } from "../lib/analytics/cloudflareRum.js";
import { getTenantCloudflareConfig } from "../lib/analytics/cloudflareConfig.js";

const args = process.argv.slice(2);
const flag = (nombre) => args.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1] ?? null;
const DRY = args.includes("--dry-run");
const SOLO_TENANT = flag("tenant");
const DIAS = Math.min(Number(flag("dias") ?? MAX_DIAS_RUM), MAX_DIAS_RUM);

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

function iso(d) { return d.toISOString().slice(0, 10); }

function rangoDeFechas(dias) {
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setUTCDate(desde.getUTCDate() - (dias - 1));
  return { desde: iso(desde), hasta: iso(hoy) };
}

/**
 * Convierte la respuesta de Cloudflare en filas (fecha, dimension, valor).
 *
 * OJO con lo que Cloudflare NO da: los desgloses (países, páginas, referrers…)
 * vienen agregados de TODO el rango, no partidos por día. Solo la serie temporal
 * viene por día. Por eso los desgloses se guardan atribuidos al ÚLTIMO día del
 * rango consultado y la captura se lanza a diario con rango corto: así cada
 * pasada aporta el desglose de un día y el histórico se construye día a día.
 *
 * Consecuencia práctica: si se lanza con --dias=7 sobre una base vacía, los
 * desgloses de esos 7 días quedan todos apilados en el último. Los totales
 * diarios (dimensión `total`) sí son correctos día a día porque salen de la
 * serie. Es la razón de que el cron sea DIARIO y no semanal.
 */
function filasDesde(rum, hasta) {
  const filas = [];

  for (const punto of rum.serie ?? []) {
    filas.push({
      fecha: punto.fecha,
      dimension: "total",
      valor: "",
      visitas: punto.visitas ?? 0,
      vistas: punto.vistas ?? 0,
    });
  }

  const desgloses = [
    ["pais", (rum.paises ?? []).map((p) => ({ valor: p.codigo, visitas: p.visitas, vistas: p.vistas }))],
    ["pagina", rum.paginas ?? []],
    ["referrer", rum.referrers ?? []],
    ["dispositivo", rum.dispositivos ?? []],
    ["navegador", rum.navegadores ?? []],
  ];

  for (const [dimension, items] of desgloses) {
    for (const item of items) {
      // Los desgloses de cloudflareRum vienen como { clave, visitas, vistas };
      // los países, como { codigo, ... } (ya normalizado a ISO-2).
      const valor = String(item.clave ?? item.valor ?? "").slice(0, 255);
      if (!valor) continue;
      filas.push({
        fecha: hasta,
        dimension,
        valor,
        visitas: item.visitas ?? 0,
        vistas: item.vistas ?? 0,
      });
    }
  }

  return filas;
}

async function capturarTenant(tenant) {
  const config = getTenantCloudflareConfig({ tenant });
  if (!config.configured) {
    log(`· ${tenant.slug}: sin credenciales de Cloudflare, se salta`);
    return { saltado: true };
  }

  const { desde, hasta } = rangoDeFechas(DIAS);
  const rum = await consultarRum({
    token: config.token,
    accountId: config.accountId,
    siteTag: config.siteTag,
    desde,
    hasta,
  });

  const filas = filasDesde(rum, hasta);
  if (!filas.length) {
    log(`· ${tenant.slug}: Cloudflare no devolvió nada para ${desde} → ${hasta}`);
    return { filas: 0 };
  }

  if (DRY) {
    const totales = filas.filter((f) => f.dimension === "total");
    log(`· ${tenant.slug}: ${filas.length} filas (${totales.length} días) — dry-run, no se escribe`);
    return { filas: filas.length, dry: true };
  }

  const { models } = getTenantDb(tenant.slug);
  const { WebVisitDaily } = models;

  // Upsert por el índice único (fecha, dimension, valor). Sobreescribe: el día
  // en curso se vuelve a escribir completo en la pasada siguiente.
  await WebVisitDaily.bulkCreate(filas, {
    updateOnDuplicate: ["visitas", "vistas", "updatedAt"],
  });

  const dias = new Set(filas.map((f) => f.fecha)).size;
  log(`✓ ${tenant.slug}: ${filas.length} filas guardadas (${dias} día(s), ${desde} → ${hasta})`);
  return { filas: filas.length };
}

async function main() {
  const { Tenant, TenantModule } = getMasterModels();

  const modulos = await TenantModule.findAll({ where: { moduleKey: "analytics", enabled: true } });
  const ids = modulos.map((m) => m.tenantId);
  let tenants = ids.length ? await Tenant.findAll({ where: { id: ids, status: "active" } }) : [];

  if (SOLO_TENANT) tenants = tenants.filter((t) => t.slug === SOLO_TENANT);

  header(`Captura de visitas web — ${tenants.length} tenant(s) con analytics activo`);
  if (!tenants.length) {
    log("Ningún tenant con el módulo activo. Nada que hacer.");
    return 0;
  }

  let fallos = 0;
  for (const tenant of tenants) {
    try {
      await capturarTenant(tenant.toJSON());
    } catch (err) {
      // Un tenant roto no puede dejar sin histórico a los demás.
      fallos += 1;
      process.stderr.write(`  ✗ ${tenant.slug}: ${err?.message ?? err}\n`);
    }
  }

  process.stdout.write(
    fallos ? `\n⚠ Terminado con ${fallos} tenant(s) fallidos\n\n` : "\n✓ Captura completada\n\n"
  );
  return fallos ? 1 : 0;
}

let codigo = 1;
try {
  codigo = await main();
} catch (err) {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  codigo = 1;
} finally {
  try { await getMasterDb().close(); } catch { /* da igual al salir */ }
}
process.exit(codigo);
