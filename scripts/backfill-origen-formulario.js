/**
 * backfill-origen-formulario.js — devuelve su procedencia a las fichas que
 * nacieron de una solicitud web y acabaron marcadas como alta a mano.
 *
 *   node scripts/backfill-origen-formulario.js            (simulacro)
 *   node scripts/backfill-origen-formulario.js --confirm
 *
 * ── QUÉ PASÓ ────────────────────────────────────────────────────────────────
 * Aceptar una solicitud guardaba la procedencia en `customFields.origen` y la
 * ficha pintaba `customFields.origin`. Dos claves distintas: el dato se
 * guardaba y no se veía. Y como el PUT de la ficha rellenaba `origin` con
 * "manual" cuando faltaba, la primera vez que alguien editaba una de esas
 * fichas, una familia que había llegado por el formulario de la web quedaba
 * registrada para siempre como alta de mostrador.
 *
 * Esto copia `origen` → `origin` en las fichas afectadas. NO borra `origen`:
 * si mañana aparece algo que lo lea, sigue ahí.
 *
 * ── LO QUE NO TOCA, A PROPÓSITO ─────────────────────────────────────────────
 * Solo las que empiezan por "Formulario web". Las 1.083 familias que Aumenta
 * importó de su sistema anterior llevan `origen = "organizate"`, que NO es una
 * procedencia comercial sino la marca que usa `limpiar-importacion-aumenta.js`
 * para saber qué filas vinieron de aquel volcado. Renombrarla rompería esa
 * limpieza.
 *
 * Y solo pisa `origin` si está vacío o dice "manual" (que es exactamente la
 * mentira que vino a arreglar). Si alguien escribió otra cosa a mano, manda
 * lo que escribió esa persona.
 *
 * Lee los schemas de `master.tenants` en tiempo de ejecución (regla 12).
 *
 * Uso VPS: docker compose exec -T app node scripts/backfill-origen-formulario.js --confirm
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const confirmar = process.argv.includes("--confirm");

const MARCA = "Formulario web";

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════════\n");
  process.stdout.write("  Procedencia de las fichas nacidas del formulario web");
  process.stdout.write(confirmar ? "\n" : "   (SIMULACRO)\n");
  process.stdout.write("══════════════════════════════════════════════════════════\n\n");

  const master = await getMasterDb();
  const [tenants] = await master.query(
    "SELECT slug FROM master.tenants WHERE status <> 'deleted' ORDER BY slug"
  );

  let totalTocadas = 0;

  for (const { slug } of tenants) {
    let models;
    try {
      ({ models } = getTenantDb(slug));
    } catch {
      continue; // slug que el validador no acepta: no es nuestro
    }
    const { Client } = models;
    if (!Client) continue;

    let candidatas;
    try {
      candidatas = await Client.findAll({ attributes: ["id", "name", "customFields"] });
    } catch (err) {
      // Tenant sin tabla `clients` (solo leads, por ejemplo): no es un fallo.
      if (err?.parent?.code === "42P01" || err?.original?.code === "42P01") continue;
      throw err;
    }

    const afectadas = candidatas.filter((c) => {
      const cf = c.customFields || {};
      const viejo = typeof cf.origen === "string" ? cf.origen : "";
      if (!viejo.startsWith(MARCA)) return false;
      const actual = cf.origin;
      return actual == null || actual === "" || actual === "manual";
    });

    if (afectadas.length === 0) continue;

    process.stdout.write(`  ${slug}: ${afectadas.length} ficha(s)\n`);
    for (const c of afectadas) {
      const cf = c.customFields || {};
      process.stdout.write(
        `    ${confirmar ? "→" : "·"} ${String(c.name ?? "(sin nombre)").slice(0, 34).padEnd(34)} ` +
        `origin: ${cf.origin ?? "(vacío)"} → ${cf.origen}\n`
      );
      if (confirmar) {
        await c.update({ customFields: { ...cf, origin: cf.origen } });
      }
      totalTocadas += 1;
    }
    process.stdout.write("\n");
  }

  if (totalTocadas === 0) {
    process.stdout.write("  No hay ninguna ficha que reparar.\n\n");
  } else {
    process.stdout.write(`  ${confirmar ? "Reparadas" : "Se repararían"}: ${totalTocadas}\n`);
    if (!confirmar) process.stdout.write("\n  · Simulacro: no se ha escrito nada. Repite con --confirm.\n");
    process.stdout.write("\n");
  }

  await closeAllConnections();
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  try { await closeAllConnections(); } catch { /* ya nos vamos */ }
  process.exit(1);
});
