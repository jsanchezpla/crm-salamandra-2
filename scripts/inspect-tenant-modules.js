// @vivo — Herramienta de inspección genérica por slug (default «aumenta»), solo lectura: clasifica tenant_modules en activos sin/con override y deshabilitados. (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * inspect-tenant-modules.js — Radiografía de módulos de un tenant (SOLO LECTURA)
 *
 * Lee `master.tenant_modules` para un tenant y clasifica cada módulo en:
 *   · Activos SIN override    → enabled=true y sin personalización
 *   · Activos CON override    → enabled=true y con al menos un override
 *   · Deshabilitados          → enabled=false
 *
 * Se considera "override" cualquiera de estos 4 campos con contenido:
 *   · uiOverride       (string no nulo)  → componente React alternativo
 *   · logicOverrides   (JSONB no vacío)  → comportamiento distinto
 *   · schemaExtensions (JSONB no vacío)  → campos extra en el schema
 *   · featureFlags     (JSONB no vacío)  → features en prueba
 *
 * NO modifica nada. Seguro de ejecutar en producción.
 *
 * Uso local:      node --env-file=.env.local scripts/inspect-tenant-modules.js aumenta
 * Uso producción: docker exec crm-salamandra-app-1 node scripts/inspect-tenant-modules.js aumenta
 *   (dentro del contenedor Docker ya inyecta las envs vía env_file; NO usar --env-file)
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const SLUG = process.argv[2] || "aumenta";

function out(msg = "") {
  process.stdout.write(`${msg}\n`);
}

function isNonEmptyObj(v) {
  return v && typeof v === "object" && Object.keys(v).length > 0;
}

async function main() {
  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`\n✗ Tenant '${SLUG}' no encontrado en master.tenants\n`);
    process.exit(1);
  }

  const modules = await TenantModule.findAll({
    where: { tenantId: tenant.id },
    order: [["moduleKey", "ASC"]],
  });

  out("");
  out("═".repeat(64));
  out(`  Radiografía de módulos — tenant '${SLUG}'`);
  out(`  Tenant id: ${tenant.id}  ·  plan: ${tenant.plan}  ·  status: ${tenant.status}`);
  out(`  Total registros en tenant_modules: ${modules.length}`);
  out("═".repeat(64));

  const enabledWithoutOverride = [];
  const enabledWithOverride = [];
  const disabled = [];

  for (const m of modules) {
    const overrides = [];
    if (m.uiOverride) overrides.push(`ui="${m.uiOverride}"`);
    if (isNonEmptyObj(m.logicOverrides)) {
      overrides.push(`logic={${Object.keys(m.logicOverrides).join(",")}}`);
    }
    if (isNonEmptyObj(m.schemaExtensions)) {
      overrides.push(`schema={${Object.keys(m.schemaExtensions).join(",")}}`);
    }
    if (isNonEmptyObj(m.featureFlags)) {
      overrides.push(`flags={${Object.keys(m.featureFlags).join(",")}}`);
    }

    const row = {
      key: m.moduleKey,
      version: m.version || "—",
      overrides,
    };

    if (!m.enabled) disabled.push(row);
    else if (overrides.length) enabledWithOverride.push(row);
    else enabledWithoutOverride.push(row);
  }

  out("");
  out(`▶ ACTIVOS SIN override (${enabledWithoutOverride.length})`);
  if (enabledWithoutOverride.length === 0) out("   (ninguno)");
  for (const r of enabledWithoutOverride) {
    out(`   ✓ ${r.key.padEnd(16)} v${r.version}`);
  }

  out("");
  out(`▶ ACTIVOS CON override (${enabledWithOverride.length})`);
  if (enabledWithOverride.length === 0) out("   (ninguno)");
  for (const r of enabledWithOverride) {
    out(`   ★ ${r.key.padEnd(16)} v${r.version}`);
    for (const ov of r.overrides) out(`       └─ ${ov}`);
  }

  out("");
  out(`▶ DESHABILITADOS (${disabled.length})`);
  if (disabled.length === 0) out("   (ninguno)");
  for (const r of disabled) {
    const tag = r.overrides.length ? `  [tiene override latente: ${r.overrides.join(" ")}]` : "";
    out(`   ✗ ${r.key.padEnd(16)}${tag}`);
  }

  out("");
  out("═".repeat(64));
  out(
    `  Resumen: ${enabledWithoutOverride.length} activos sin override · ` +
      `${enabledWithOverride.length} activos con override · ` +
      `${disabled.length} deshabilitados`
  );
  out("═".repeat(64));
  out("");

  await getMasterDb().close();
  process.exit(0);
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  try {
    await getMasterDb().close();
  } catch {}
  process.exit(1);
});
