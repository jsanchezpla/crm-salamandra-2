/**
 * migrate-productos.js — Inventario, Pedidos y Tienda pasan a colgar de
 * PRODUCTOS (03/09/2026, Rodrigo), igual que se hizo con Documentos.
 *
 *   `productos`           básico: el catálogo con su valor (la pantalla general).
 *   `productos_avanzado`  estadísticas de venta + la puerta a Inventario,
 *                         Pedidos y Tienda en el menú.
 *
 * ── QUÉ HACE Y POR QUÉ ──────────────────────────────────────────────────────
 * A partir de hoy la entrada de menú de Inventario, Pedidos y Tienda exige
 * `productos_avanzado`, y el endpoint de productos exige `productos`. Quien ya
 * tenía cualquiera de los tres los usaba sin más, así que este script le da
 * las dos claves nuevas para que NADIE se quede sin menú ni con un 403 por un
 * cambio de nomenclatura. Es la parte aburrida que, si se olvida, se convierte
 * en «me han quitado los pedidos» un lunes por la mañana.
 *
 * Dos puertas, como siempre (CLAUDE.md): la fila en `master.tenant_modules` y
 * el `module_access` de cada usuario. A quien tenga lista explícita con alguna
 * de las tres claves viejas se le añaden las dos nuevas; `["all"]` y las listas
 * sin ninguna de las tres no se tocan.
 *
 * No toca a quien no tenga ninguno de los tres: dar Productos a un cliente
 * nuevo es una decisión comercial, no una migración.
 *
 * Idempotente: relanzarlo no duplica filas (findOrCreate por tenant+módulo) ni
 * repite claves en las listas.
 *
 * Uso:
 *   node --env-file=.env.local scripts/migrate-productos.js
 *   docker exec crm-salamandra-app-1 node scripts/migrate-productos.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const VIEJAS = ["inventory", "orders", "tienda"];
const NUEVAS = ["productos", "productos_avanzado"];

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  process.stdout.write(" Productos: básico + avanzado para quien tenía el trío\n");
  process.stdout.write("══════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const db = getMasterDb();
  await db.authenticate();
  const { Tenant, TenantModule, User } = getMasterModels();

  header("Clientes que hoy tienen Inventario, Pedidos o Tienda…");
  const filas = await TenantModule.findAll({ where: { moduleKey: VIEJAS, enabled: true } });
  const tenantIds = [...new Set(filas.map((f) => String(f.tenantId)))];
  if (tenantIds.length === 0) {
    log("· Ninguno. Nada que conservar.");
    await db.close();
    return;
  }

  const tenants = await Tenant.findAll();
  const nombre = new Map(tenants.map((t) => [String(t.id), t.slug]));
  log(`✓ ${tenantIds.length}: ${tenantIds.map((id) => nombre.get(id) ?? id).join(", ")}`);

  header("Dándoles Productos básico y avanzado…");
  let creados = 0;
  for (const tenantId of tenantIds) {
    const slug = nombre.get(tenantId) ?? tenantId;
    const hechos = [];
    for (const moduleKey of NUEVAS) {
      const [mod, creado] = await TenantModule.findOrCreate({
        where: { tenantId, moduleKey },
        defaults: {
          tenantId,
          moduleKey,
          enabled: true,
          version: "1.0.0",
          schemaExtensions: {},
          logicOverrides: {},
          uiOverride: null,
          featureFlags: {},
        },
      });
      if (!creado && !mod.enabled) await mod.update({ enabled: true });
      if (creado) {
        creados++;
        hechos.push(moduleKey);
      }
    }
    log(`${hechos.length ? "✓" : "·"} ${slug}: ${hechos.length ? hechos.join(" + ") + " añadidos" : "ya los tenía"}`);
  }

  header("Y a los usuarios con lista explícita de módulos…");
  const usuarios = await User.findAll({
    where: { tenantId: tenantIds },
    attributes: ["id", "email", "tenantId", "moduleAccess"],
  });
  let tocados = 0;
  for (const u of usuarios) {
    const acc = u.moduleAccess;
    if (!Array.isArray(acc) || acc.includes("all")) continue;
    if (!VIEJAS.some((k) => acc.includes(k))) continue;
    const faltan = NUEVAS.filter((k) => !acc.includes(k));
    if (!faltan.length) continue;
    await u.update({ moduleAccess: [...acc, ...faltan] });
    tocados++;
    log(`✓ ${nombre.get(String(u.tenantId)) ?? u.tenantId}: ${u.email} → + ${faltan.join(", ")}`);
  }
  if (!tocados) log("· Ninguno hacía falta (listas con «all» o sin ninguna de las tres claves).");

  header("Resumen");
  log(`Clientes con el trío: ${tenantIds.length} · filas de módulo añadidas: ${creados} · usuarios tocados: ${tocados}`);
  log("La caché de tenant del servidor caduca sola en ~60 s.");
  process.stdout.write("\n✓ Hecho\n\n");
  await db.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
