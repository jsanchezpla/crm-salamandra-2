// @vivo — Diagnóstico genérico por slug, solo lectura, de una integración viva (Analytics con credenciales por cliente): dice en qué eslabón falla sin abrir… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * check-cloudflare-analytics.js — comprueba que un tenant puede leer sus
 * visitas de Cloudflare. SOLO LECTURA: no escribe nada, en ninguna base.
 *
 * Para qué sirve: cuando el módulo Analíticas sale vacío o con error, esto dice
 * en qué eslabón está el problema sin tener que abrir el navegador — si falta
 * la credencial, si Cloudflare rechaza el token, si el token no alcanza esa
 * cuenta, o si sencillamente todavía no hay visitas.
 *
 * NO imprime el token ni ningún fragmento suyo.
 *
 * USO
 *   node --env-file=.env.local scripts/check-cloudflare-analytics.js <slug> [dias]
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/check-cloudflare-analytics.js spain_enzymes 30
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantCloudflareConfig } from "../lib/analytics/cloudflareConfig.js";
import { consultarRum } from "../lib/analytics/cloudflareRum.js";

const [slug, diasArg] = process.argv.slice(2);
const dias = Number(diasArg ?? 30);

if (!slug) {
  process.stderr.write("\n✗ Falta el slug.\n  Uso: node scripts/check-cloudflare-analytics.js <slug> [dias]\n\n");
  process.exit(1);
}

getMasterDb();
const { Tenant } = getMasterModels();

const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) {
  process.stderr.write(`\n✗ No existe el tenant "${slug}"\n\n`);
  process.exit(1);
}

const config = getTenantCloudflareConfig({ tenant: tenant.toJSON() });

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(` Cloudflare Web Analytics — ${tenant.name} (${slug})\n`);
process.stdout.write("══════════════════════════════════════════════════════\n\n");
process.stdout.write(`  token de API .......... ${config.token ? "configurado" : "FALTA"}\n`);
process.stdout.write(`  id de cuenta .......... ${config.accountId ?? "FALTA o con formato inválido"}\n`);
process.stdout.write(`  id de sitio ........... ${config.siteTag ?? "(sin filtrar: todos los sitios de la cuenta)"}\n`);
if (config.siteTagInvalido) {
  process.stdout.write("  ⚠ el id de sitio guardado NO tiene formato válido y se está ignorando\n");
}
process.stdout.write("\n");

if (!config.configured) {
  process.stdout.write("  → Sin credenciales completas. Se configuran en Configuración → Integraciones\n");
  process.stdout.write("    → «Cloudflare (visitas de la web)». Hacen falta el token Y el id de cuenta.\n\n");
  process.exit(1);
}

const hoy = new Date();
const desdeD = new Date(hoy);
desdeD.setUTCDate(desdeD.getUTCDate() - (dias - 1));
const iso = (d) => d.toISOString().slice(0, 10);

process.stdout.write(`  Consultando ${iso(desdeD)} → ${iso(hoy)} …\n\n`);

try {
  const r = await consultarRum({
    token: config.token,
    accountId: config.accountId,
    siteTag: config.siteTag,
    desde: iso(desdeD),
    hasta: iso(hoy),
  });

  process.stdout.write(`  ✓ Cloudflare respondió correctamente\n\n`);
  process.stdout.write(`    visitas ............. ${r.totales.visitas}\n`);
  process.stdout.write(`    páginas vistas ...... ${r.totales.vistas}\n`);
  process.stdout.write(`    países con datos .... ${r.paises.length}\n`);
  process.stdout.write(`    días con datos ...... ${r.serie.length}\n\n`);

  if (r.paises.length > 0) {
    process.stdout.write("    Top países:\n");
    for (const p of r.paises.slice(0, 8)) {
      process.stdout.write(`      ${p.codigo}  ${String(p.visitas).padStart(6)} visitas\n`);
    }
    process.stdout.write("\n");
  }

  if (r.totales.visitas === 0) {
    process.stdout.write("  ⚠ La conexión funciona pero no hay visitas en el periodo.\n");
    process.stdout.write("    Comprueba que el fragmento de medición está en la web y que\n");
    process.stdout.write("    el id de sitio (si lo hay) es el correcto.\n\n");
  }
  process.exit(0);
} catch (err) {
  process.stderr.write(`  ✗ ${err.message}\n\n`);
  process.exit(1);
}
