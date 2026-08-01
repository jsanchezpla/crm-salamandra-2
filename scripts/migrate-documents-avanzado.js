/**
 * migrate-documents-avanzado.js — parte Documentos en BÁSICO y AVANZADO
 * (01/08/2026), igual que se hizo con Equipo.
 *
 *   `documents`           básico: SOLO el Contrato de Prestación de Servicios.
 *   `documents_avanzado`  el archivo completo: carpetas, buscador, subida
 *                         general, cuota.
 *
 * ── QUÉ HACE Y POR QUÉ ──────────────────────────────────────────────────────
 * A partir de hoy `documents` significa MENOS de lo que significaba. Quien ya
 * lo tenía activado esperaba el archivo entero, así que este script le añade
 * `documents_avanzado` para que NADIE se quede con menos de lo que tenía por un
 * cambio de nomenclatura. Es la parte aburrida que, si se olvida, se convierte
 * en «me han quitado los documentos» un lunes por la mañana.
 *
 * No toca a quien no tenga `documents`: dar el básico a un cliente nuevo es una
 * decisión comercial, no una migración.
 *
 * Idempotente: relanzarlo no duplica filas (findOrCreate por tenant+módulo).
 *
 * Uso:
 *   node --env-file=.env.local scripts/migrate-documents-avanzado.js
 *   docker exec crm-salamandra-app-1 node scripts/migrate-documents-avanzado.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const BASICO = "documents";
const AVANZADO = "documents_avanzado";

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  process.stdout.write(" Documentos: básico vs avanzado\n");
  process.stdout.write("══════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const db = getMasterDb();
  await db.authenticate();
  const { Tenant, TenantModule } = getMasterModels();

  header("Clientes que hoy tienen Documentos…");
  const filas = await TenantModule.findAll({ where: { moduleKey: BASICO, enabled: true } });
  if (filas.length === 0) {
    log("· Ninguno. Nada que conservar.");
    await db.close();
    return;
  }

  const tenants = await Tenant.findAll();
  const nombre = new Map(tenants.map((t) => [String(t.id), t.slug]));
  log(`✓ ${filas.length}: ${filas.map((f) => nombre.get(String(f.tenantId)) ?? f.tenantId).join(", ")}`);

  header("Dándoles el AVANZADO para que no pierdan el archivo…");
  let creados = 0;
  for (const fila of filas) {
    const slug = nombre.get(String(fila.tenantId)) ?? fila.tenantId;
    const [mod, creado] = await TenantModule.findOrCreate({
      where: { tenantId: fila.tenantId, moduleKey: AVANZADO },
      defaults: { tenantId: fila.tenantId, moduleKey: AVANZADO, enabled: true, version: 1 },
    });
    if (!creado && !mod.enabled) await mod.update({ enabled: true });
    log(`${creado ? "✓" : "·"} ${slug}: ${creado ? "avanzado añadido" : "ya lo tenía"}`);
    if (creado) creados++;
  }

  header("Resumen");
  log(`Clientes con Documentos: ${filas.length} · avanzado añadido a ${creados}`);
  log("La caché de tenant del servidor caduca sola en ~60 s.");
  process.stdout.write("\n✓ Hecho\n\n");
  await db.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
