/**
 * migrate-auto-asignar-nutricion.js — enciende el auto-marcado de Nutrición a
 * quien ya lo tenía de hecho.
 *
 * ── QUÉ CAMBIA Y POR QUÉ HACE FALTA ESTE SCRIPT ─────────────────────────────
 * Hasta el 13/08/2026, en TODO tenant con el módulo `nutricion` cada alta de
 * cliente marcaba sola la asignación «Paciente Nutrición»
 * (AUTO_ASSIGN_MODULE_KEYS en lib/clients/moduleAssignments.js). La regla
 * colgaba de tener el módulo y de nada más.
 *
 * Eso se escribió para una consulta de una persona, donde «todo cliente nuevo
 * es paciente» es verdad. En un centro grande deja de serlo: el día que
 * Nutrición se venda a un centro de psicología con mil familias, toda ficha que
 * entre por la puerta queda marcada como paciente de dietas, y no lo dice nadie.
 *
 * Ahora manda un flag por tenant (`featureFlags.autoAsignarEnAlta` en su fila
 * de `master.tenant_modules`), APAGADO por defecto. Este script existe para que
 * ese cambio no le mueva el suelo a quien ya dependía del comportamiento
 * viejo: enciende el flag en `nutri_laura`, que es quien lo pidió en julio.
 *
 * A los demás se les deja apagado A PROPÓSITO, y se listan al final para que se
 * vea qué se ha decidido por ellos: `demo` es escaparate y `somos` no tiene
 * todavía ni una ficha, así que ninguno pierde nada, y un cliente nuevo no debe
 * heredar la costumbre de otro sin decirlo.
 *
 * Toca SOLO el schema `master` (una columna JSONB), no la estructura de ningún
 * tenant. Por eso va en ONE_OFF y no en el mapa de módulos. Idempotente.
 *
 * USO
 *   node --env-file=.env.local scripts/migrate-auto-asignar-nutricion.js
 *   node --env-file=.env.local scripts/migrate-auto-asignar-nutricion.js --list
 *   node --env-file=.env.local scripts/migrate-auto-asignar-nutricion.js --tenant otro_slug
 *   node --env-file=.env.local scripts/migrate-auto-asignar-nutricion.js --tenant otro_slug --off
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/migrate-auto-asignar-nutricion.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { AUTO_ASSIGN_FLAG } from "../lib/clients/moduleAssignments.js";

const MODULE_KEY = "nutricion";
// Quien lo pidió (2026-07-27) y para quien el comportamiento no debe cambiar.
const POR_DEFECTO = "nutri_laura";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const iTenant = argv.indexOf("--tenant");
const slugObjetivo = iTenant >= 0 ? argv[iTenant + 1] : POR_DEFECTO;
const encender = !flags.has("--off");

function log(m) { process.stdout.write(`  ${m}\n`); }

getMasterDb();
const { Tenant, TenantModule } = getMasterModels();

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(` Auto-marcado de Nutrición en el alta (${AUTO_ASSIGN_FLAG})\n`);
process.stdout.write("══════════════════════════════════════════════════════\n\n");

// ── Foto de quién tiene el módulo y cómo está su flag ───────────────────────
const filas = await TenantModule.findAll({
  where: { moduleKey: MODULE_KEY, enabled: true },
  include: [{ model: Tenant, as: "tenant", attributes: ["slug", "name"] }],
});

// El include puede no estar declarado en el modelo; si no viene, se resuelve a mano.
const slugPorTenantId = new Map();
if (filas.some((f) => !f.tenant)) {
  const tenants = await Tenant.findAll({ attributes: ["id", "slug"] });
  for (const t of tenants) slugPorTenantId.set(t.id, t.slug);
}
const slugDe = (fila) => fila.tenant?.slug ?? slugPorTenantId.get(fila.tenantId) ?? "(desconocido)";

function pinta(titulo) {
  log(titulo);
  for (const f of filas) {
    const on = !!(f.featureFlags || {})[AUTO_ASSIGN_FLAG];
    log(`  · ${slugDe(f).padEnd(22)} ${on ? "ENCENDIDO" : "apagado"}`);
  }
  process.stdout.write("\n");
}

if (filas.length === 0) {
  log("· Ningún tenant con el módulo `nutricion` activo. Nada que hacer.\n");
  process.exit(0);
}

pinta("Estado actual:");

if (flags.has("--list")) process.exit(0);

// ── El cambio ───────────────────────────────────────────────────────────────
const objetivo = filas.find((f) => slugDe(f) === slugObjetivo);
if (!objetivo) {
  process.stderr.write(
    `✗ "${slugObjetivo}" no tiene el módulo \`${MODULE_KEY}\` activo, así que el flag no pintaría nada.\n` +
      `  Actívale el módulo primero:  node scripts/enable-module.js ${slugObjetivo} ${MODULE_KEY}\n\n`
  );
  process.exit(1);
}

const antes = { ...(objetivo.featureFlags || {}) };
if (!!antes[AUTO_ASSIGN_FLAG] === encender) {
  log(`· ${slugObjetivo} ya estaba ${encender ? "encendido" : "apagado"}. Nada que cambiar.\n`);
  process.exit(0);
}

// Se reasigna el objeto entero: Sequelize no detecta la mutación de un JSONB
// in-place y guardaría la fila sin cambios.
await objetivo.update({ featureFlags: { ...antes, [AUTO_ASSIGN_FLAG]: encender } });
log(`✓ ${slugObjetivo}: ${AUTO_ASSIGN_FLAG} → ${encender}`);
log("  (la caché de tenant del servidor caduca sola en ~60 s)\n");

await objetivo.reload();
pinta("Estado final:");

process.stdout.write("✓ Listo\n\n");
process.exit(0);
