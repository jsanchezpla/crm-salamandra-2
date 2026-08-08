/**
 * listar-leads.js — radiografía SOLO LECTURA de los leads de un cliente.
 *
 *   node scripts/listar-leads.js <slug> [--detalle]
 *
 * No escribe nada. Existe porque antes de mover un solo lead de sitio hay que
 * saber qué hay: cuántos son, de qué tipo, en qué etapa y desde cuándo. Los
 * scripts que había para leads o los borran todos o los limpian; ninguno
 * enseñaba lo que hay.
 *
 * Con `--detalle` saca además la lista con nombre, tipo, motivo y fecha, para
 * poder decidir uno a uno. Sin él, solo los recuentos.
 *
 * ⚠️ Los leads llevan datos personales (y en un centro clínico, a veces de
 * salud dentro del mensaje). Este script NO imprime nunca el mensaje ni el
 * correo completo: para eso está el CRM.
 *
 * Uso en el VPS: docker compose exec -T app node scripts/listar-leads.js aumenta
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const detalle = args.includes("--detalle");

if (!slug) {
  process.stderr.write("\n✗ Falta el slug del cliente.\n  Uso: node scripts/listar-leads.js <slug> [--detalle]\n\n");
  process.exit(1);
}

/** Agrupa y cuenta, ordenando de más a menos. */
function recuento(filas, campo) {
  const mapa = new Map();
  for (const f of filas) {
    const k = f[campo] ?? "(vacío)";
    mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
}

function pinta(titulo, pares, total) {
  process.stdout.write(`\n  ${titulo}\n`);
  for (const [k, n] of pares) {
    const pct = total ? Math.round((n / total) * 100) : 0;
    process.stdout.write(`    ${String(k).padEnd(24)} ${String(n).padStart(4)}  (${pct}%)\n`);
  }
}

async function main() {
  await getMasterDb();
  const { models } = getTenantDb(slug);
  const { Lead } = models;

  const filas = await Lead.findAll({
    attributes: ["id", "name", "email", "phone", "stage", "tipo_usuario", "motivo", "servicio", "curso", "taller", "createdAt"],
    order: [["createdAt", "DESC"]],
  });

  process.stdout.write(`\n════════════════════════════════════════════════\n`);
  process.stdout.write(`  Leads de «${slug}» — ${filas.length} en total\n`);
  process.stdout.write(`════════════════════════════════════════════════\n`);

  if (filas.length === 0) {
    process.stdout.write("\n  No hay ninguno.\n\n");
    await closeAllConnections();
    return;
  }

  const planas = filas.map((f) => f.get({ plain: true }));

  pinta("Por tipo de usuario:", recuento(planas, "tipo_usuario"), planas.length);
  pinta("Por etapa:", recuento(planas, "stage"), planas.length);
  pinta("Por motivo:", recuento(planas, "motivo"), planas.length);

  // Cuántos traen correo: sin él, esa persona no puede entrar al área privada
  // ni recibir nada, así que condiciona qué se puede hacer con ella.
  const conEmail = planas.filter((f) => f.email).length;
  const conTel = planas.filter((f) => f.phone).length;
  process.stdout.write(`\n  Contactables:\n`);
  process.stdout.write(`    con correo               ${String(conEmail).padStart(4)}  (${Math.round((conEmail / planas.length) * 100)}%)\n`);
  process.stdout.write(`    con teléfono             ${String(conTel).padStart(4)}  (${Math.round((conTel / planas.length) * 100)}%)\n`);

  const fechas = planas.map((f) => new Date(f.createdAt)).sort((a, b) => a - b);
  process.stdout.write(`\n  Desde ${fechas[0].toISOString().slice(0, 10)} hasta ${fechas[fechas.length - 1].toISOString().slice(0, 10)}\n`);

  if (detalle) {
    process.stdout.write(`\n  ── Uno a uno (sin correo ni mensaje: eso se mira en el CRM) ──\n`);
    for (const f of planas) {
      const fecha = new Date(f.createdAt).toISOString().slice(0, 10);
      const interes = [f.servicio, f.curso, f.taller].filter(Boolean).join(" / ") || "—";
      process.stdout.write(
        `    ${fecha}  ${String(f.tipo_usuario ?? "?").padEnd(12)} ${String(f.stage ?? "?").padEnd(11)} ` +
        `${String(f.motivo ?? "—").padEnd(12)} ${String(f.name ?? "(sin nombre)").slice(0, 28).padEnd(28)} ${interes.slice(0, 34)}\n`
      );
    }
  }

  process.stdout.write("\n");
  await closeAllConnections();
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  try { await closeAllConnections(); } catch { /* da igual, ya nos vamos */ }
  process.exit(1);
});
