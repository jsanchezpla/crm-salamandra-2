/**
 * check-migration-order.js — audita el orden de las migraciones.
 *
 * El orden que usa `ensure-tenant-schema.js` no está escrito a mano: se deduce
 * del SQL de cada migración (ver _migration-order.js). Este script enseña ese
 * razonamiento para que un humano pueda comprobarlo, en vez de tener que fiarse.
 *
 * Muestra:
 *   · las dependencias detectadas, con el motivo de cada una
 *   · el orden resultante
 *   · las tablas que ninguna migración crea (vienen de los modelos vía db:sync)
 *   · migraciones huérfanas: existen como fichero pero no están en ningún módulo
 *
 * No toca la base de datos: es solo lectura de ficheros. Sale con código 1 si
 * encuentra una incoherencia que haya que arreglar.
 *
 * Uso:  node scripts/check-migration-order.js
 */

import { extractDeps, edges, computeOrder, blindSpots, EXTRA_EDGES } from "./_migration-order.js";
import { ONE_OFF, mapInconsistencies, MODULES, CORE } from "./_module-migrations.js";

function h(t) { process.stdout.write(`\n▶ ${t}\n`); }

const deps = extractDeps();
const aristas = edges(deps);
const orden = computeOrder(deps);

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(" Auditoría del orden de migraciones\n");
process.stdout.write("══════════════════════════════════════════════════════\n");

h(`Dependencias deducidas del SQL (${aristas.filter((e) => e.derivada).length})`);
for (const e of aristas.filter((x) => x.derivada)) {
  process.stdout.write(`  ${e.before}\n    └→ ${e.after}   (${e.why})\n`);
}

h(`Dependencias declaradas a mano (${EXTRA_EDGES.length})`);
for (const e of EXTRA_EDGES) {
  process.stdout.write(`  ${e.before}\n    └→ ${e.after}\n       ${e.why}\n`);
}

h(`Orden resultante (${orden.length} migraciones)`);
orden.forEach((m, i) => {
  const etiqueta = ONE_OFF[m] ? "  [ONE_OFF, no se ejecuta]" : "";
  process.stdout.write(`  ${String(i + 1).padStart(2)}. ${m}${etiqueta}\n`);
});

const sinProductor = new Set();
const productores = new Set(Object.values(deps).flatMap((v) => v.provides));
for (const v of Object.values(deps)) {
  for (const r of v.requires) if (!productores.has(r)) sinProductor.add(r);
}
h(`Tablas que ninguna migración crea (${sinProductor.size})`);
process.stdout.write("  Vienen de los modelos Sequelize vía db:sync. Es lo esperado, y es la razón\n");
process.stdout.write("  por la que las migraciones no deben fiarse de los DEFAULT de la tabla.\n  ");
process.stdout.write([...sinProductor].sort().join(", ") + "\n");

// Lo más importante de esta auditoría: qué NO ha podido leer el analizador.
// Una migración cuyo SQL no se entiende no aporta ninguna dependencia y flota
// libre en el orden. Si alguna depende de otra, hay que declararlo en
// EXTRA_EDGES. Callarse esto sería justo el tipo de confianza ciega que este
// diseño quiere eliminar.
const ciegas = blindSpots(deps);
const ciegasSinArista = ciegas.filter(
  (m) => !EXTRA_EDGES.some((e) => e.before === m || e.after === m) && !ONE_OFF[m]
);
h(`Punto ciego del analizador (${ciegas.length} de ${orden.length})`);
if (!ciegas.length) {
  process.stdout.write("  ✓ Ninguno: se ha entendido el SQL de todas\n");
} else {
  for (const m of ciegas) {
    const cubierta = ONE_OFF[m]
      ? "ONE_OFF, no se ejecuta"
      : EXTRA_EDGES.some((e) => e.before === m || e.after === m)
        ? "cubierta por una arista declarada a mano"
        : "SIN CUBRIR — revisa si depende de otra migración";
    process.stdout.write(`  · ${m}  (${cubierta})\n`);
  }
}

const { sinOrden, huerfanas } = mapInconsistencies();
let problemas = 0;

h("Coherencia del mapa módulo → migraciones");
if (sinOrden.length) {
  process.stdout.write(`  ✗ Declaradas en MODULES/CORE pero sin fichero: ${sinOrden.join(", ")}\n`);
  problemas++;
} else {
  process.stdout.write("  ✓ Todo lo declarado existe como fichero\n");
}
if (huerfanas.length) {
  process.stdout.write(`  ✗ Sin módulo asignado (nadie las ejecutaría): ${huerfanas.join(", ")}\n`);
  process.stdout.write("    Añádelas a MODULES/CORE en _module-migrations.js, o a ONE_OFF si son\n");
  process.stdout.write("    parches de un tenant concreto.\n");
  problemas++;
} else {
  process.stdout.write("  ✓ Toda migración está en un módulo, en CORE o marcada como ONE_OFF\n");
}
if (ciegasSinArista.length) {
  process.stdout.write(`  ✗ Ilegibles y sin arista declarada: ${ciegasSinArista.join(", ")}\n`);
  process.stdout.write("    Comprueba si dependen de otra migración y decláralo en EXTRA_EDGES\n");
  process.stdout.write("    (_migration-order.js), o mejora el analizador para que las entienda.\n");
  problemas++;
}

const cubiertas = new Set([...CORE, ...Object.values(MODULES).flat()]);
process.stdout.write(`  · ${cubiertas.size} migraciones mapeadas · ${Object.keys(ONE_OFF).length} one-off · ${orden.length} en total\n`);

process.stdout.write("\n══════════════════════════════════════════════════════\n");
if (problemas) {
  process.stdout.write(` ✗ ${problemas} incoherencia(s) que arreglar\n`);
  process.stdout.write("══════════════════════════════════════════════════════\n\n");
  process.exit(1);
}
process.stdout.write(" ✓ Orden coherente\n");
process.stdout.write("══════════════════════════════════════════════════════\n\n");
process.exit(0);
