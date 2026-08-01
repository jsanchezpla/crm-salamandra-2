/**
 * check-module-access.js — ¿hay módulos activos que alguien NO ve?
 *
 * Activar un módulo tiene DOS puertas y es fácil cruzar solo una:
 *   1. `master.tenant_modules` — el cliente lo tiene contratado.
 *   2. `master.users.module_access` — ESE usuario puede verlo.
 *
 * Si la segunda no se cruza, el módulo está activo, el schema al día… y la
 * persona no ve nada: el menú se lo oculta y la API le responde 403. Pasó con
 * `analytics` en spain_enzymes (31/07) y otra vez con `documents` en
 * nutri_laura (01/08), y las dos veces se descubrió porque el cliente lo dijo.
 * Esto es la red para que lo diga el CRM y no el cliente.
 *
 * SOLO LECTURA. Lanzarlo después de activar módulos y en cada despliegue que
 * los toque, como `db:check-links`.
 *
 * Uso:
 *   node --env-file=.env.local scripts/check-module-access.js
 *   docker exec crm-salamandra-app-1 node scripts/check-module-access.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  process.stdout.write(" ¿Ve cada persona los módulos que su cliente tiene?\n");
  process.stdout.write("══════════════════════════════════════════════════════\n");

  const db = getMasterDb();
  await db.authenticate();
  const { Tenant, TenantModule, User } = getMasterModels();

  const [tenants, modulos, usuarios] = await Promise.all([
    Tenant.findAll({ attributes: ["id", "slug", "status"] }),
    TenantModule.findAll({ where: { enabled: true }, attributes: ["tenantId", "moduleKey"] }),
    User.findAll({ attributes: ["id", "email", "role", "tenantId", "moduleAccess"] }),
  ]);

  const porTenant = new Map();
  for (const m of modulos) {
    const k = String(m.tenantId);
    if (!porTenant.has(k)) porTenant.set(k, []);
    porTenant.get(k).push(m.moduleKey);
  }

  let avisosAdmin = 0;
  let avisosUsuario = 0;

  for (const t of tenants.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const activos = (porTenant.get(String(t.id)) ?? []).sort();
    const gente = usuarios.filter((u) => String(u.tenantId) === String(t.id));
    if (activos.length === 0 || gente.length === 0) continue;

    const problemas = [];
    for (const u of gente) {
      // Superadmin y quien no tiene lista explícita ven todo lo del tenant.
      if (u.role === "superadmin") continue;
      const acc = u.moduleAccess;
      if (!Array.isArray(acc) || acc.includes("all")) continue;
      const faltan = activos.filter((k) => !acc.includes(k));
      if (faltan.length) problemas.push({ u, faltan });
    }
    if (problemas.length === 0) continue;

    header(`${t.slug}${t.status !== "active" ? ` (${t.status})` : ""}`);
    for (const { u, faltan } of problemas) {
      const esAdmin = u.role === "admin";
      if (esAdmin) avisosAdmin++; else avisosUsuario++;
      log(`${esAdmin ? "✗" : "·"} ${u.email} (${u.role}) no ve: ${faltan.join(", ")}`);
    }
  }

  header("Resumen");
  if (avisosAdmin === 0 && avisosUsuario === 0) {
    log("✓ Todo el mundo ve lo que su cliente tiene contratado.");
  } else {
    // El de un ADMIN casi siempre es un olvido: quien administra el cliente
    // debería ver todo lo que ese cliente ha contratado. El de un usuario
    // normal suele ser deliberado (no todo el equipo ve facturación).
    if (avisosAdmin) log(`✗ ${avisosAdmin} ADMIN(es) no ven algún módulo de su cliente — casi seguro es un olvido.`);
    if (avisosUsuario) log(`· ${avisosUsuario} usuario(s) no admin con módulos ocultos — puede ser a propósito.`);
    log("Para dar acceso:  node scripts/enable-module.js <slug> <moduleKey> --grant-users");
  }
  process.stdout.write("\n");
  await db.close();
  // Sin exit 1: es un informe, no un test. Que no rompa un despliegue por una
  // decisión que puede ser deliberada.
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
