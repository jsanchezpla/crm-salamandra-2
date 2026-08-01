/**
 * migrate-clients-avanzado.js — parte Clientes en BÁSICO y AVANZADO
 * (01/08/2026), igual que se hizo con Equipo y con Documentos.
 *
 *   `clients`           básico: fichas, contactos, adjuntos, historial.
 *   `clients_avanzado`  la LISTA DE ESPERA DE ADMISIÓN: gente esperando plaza,
 *                       por orden de llegada, que se convierte en ficha cuando
 *                       entra.
 *
 * ── QUÉ HACE Y POR QUÉ ──────────────────────────────────────────────────────
 * La lista de espera nació encendida para todo el que tuviera `clients`, porque
 * se hizo para Aumenta y allí es el día a día. Pero admitir por cola es de un
 * centro que reparte plazas: a un centro de nutrición no le sobra la pantalla,
 * le sobra el concepto. El paquete Nutrición lleva Clientes SIN lista de
 * espera, así que hace falta separarlas.
 *
 * A quién se le da el avanzado: SOLO a quien la usa (`DESTINOS`). Es lo
 * contrario de lo que se hizo con Documentos, y a propósito — allí el módulo
 * llevaba meses en uso y quitarlo era quitar algo que la gente ya tenía; aquí
 * la pantalla es de este mismo sprint y nadie fuera de Aumenta ha llegado a
 * usarla.
 *
 * Los demás no pierden nada de Clientes: solo dejan de ver una pantalla que no
 * les pertenecía. Volver atrás con cualquiera es una línea:
 *   node scripts/enable-module.js <slug> clients_avanzado
 *
 * Idempotente: relanzarlo no duplica filas (findOrCreate por tenant+módulo).
 *
 * Uso:
 *   node --env-file=.env.local scripts/migrate-clients-avanzado.js
 *   docker exec crm-salamandra-app-1 node scripts/migrate-clients-avanzado.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const BASICO = "clients";
const AVANZADO = "clients_avanzado";

// `aumenta` la pidió y la usa. `demo` es el escaparate: enseña todo.
const DESTINOS = ["aumenta", "demo"];

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  process.stdout.write(" Clientes: básico vs avanzado (lista de espera)\n");
  process.stdout.write("══════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const db = getMasterDb();
  await db.authenticate();
  const { Tenant, TenantModule, User } = getMasterModels();

  const tenants = await Tenant.findAll();
  const porSlug = new Map(tenants.map((t) => [t.slug, t]));
  const nombre = new Map(tenants.map((t) => [String(t.id), t.slug]));

  header("Quién tiene Clientes hoy…");
  const conClientes = await TenantModule.findAll({ where: { moduleKey: BASICO, enabled: true } });
  log(`· ${conClientes.map((f) => nombre.get(String(f.tenantId)) ?? f.tenantId).sort().join(", ") || "nadie"}`);

  header("Dando el avanzado solo a quien admite por cola…");
  let creados = 0;
  let permisos = 0;
  for (const slug of DESTINOS) {
    const t = porSlug.get(slug);
    if (!t) { log(`⚠ ${slug}: no existe, lo salto`); continue; }

    const tieneBasico = conClientes.some((f) => String(f.tenantId) === String(t.id));
    if (!tieneBasico) { log(`⚠ ${slug}: no tiene Clientes, el avanzado no le serviría`); continue; }

    const [mod, creado] = await TenantModule.findOrCreate({
      where: { tenantId: t.id, moduleKey: AVANZADO },
      defaults: { tenantId: t.id, moduleKey: AVANZADO, enabled: true, version: 1 },
    });
    if (!creado && !mod.enabled) await mod.update({ enabled: true });
    log(`${creado ? "✓" : "·"} ${slug}: ${creado ? "avanzado añadido" : "ya lo tenía"}`);
    if (creado) creados++;

    // LA SEGUNDA PUERTA. Activar el módulo en el tenant no basta: quien tenga
    // una lista explícita en `module_access` seguiría sin verlo, y aquí eso no
    // sería «un módulo nuevo que no ve» sino «me habéis quitado la lista de
    // espera». Quien hoy ve Clientes en este tenant, ve la lista: se le da.
    const gente = await User.findAll({ where: { tenantId: t.id } });
    for (const u of gente) {
      const acc = u.moduleAccess;
      if (!Array.isArray(acc) || acc.includes("all") || acc.includes(AVANZADO)) continue;
      if (!acc.includes(BASICO)) continue; // no ve Clientes: tampoco veía la lista
      await u.update({ moduleAccess: [...acc, AVANZADO] });
      log(`    ✓ ${u.email} la sigue viendo`);
      permisos++;
    }
  }

  header("Resumen");
  log(`Avanzado añadido a ${creados} de ${DESTINOS.length} · ${permisos} permiso(s) de usuario conservados.`);
  log("Los demás conservan Clientes; solo dejan de ver la lista de espera.");
  log("Después: node scripts/check-module-access.js");
  log("La caché de tenant del servidor caduca sola en ~60 s.");
  process.stdout.write("\n✓ Hecho\n\n");
  await db.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
