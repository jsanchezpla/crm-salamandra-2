/**
 * podar-bajas.js — caduca la red de rescate de las bajas.
 *
 * ── QUÉ PROBLEMA RESUELVE (13/08/2026) ──────────────────────────────────────
 * Cada baja deja un `.rollback.sql` en `uploads/_bajas/` con los INSERT exactos
 * para devolver al cliente. Es lo que hace la operación reversible, y por eso se
 * escribe ANTES de tocar nada.
 *
 * Pero dentro van los `password_hash` de sus usuarios. Son hashes de bcrypt, no
 * contraseñas —el fichero es 0600 y bcrypt a coste 12 no se rompe de un
 * vistazo—, pero se atacan offline con tiempo, y ahí nadie los caducaba: los
 * tres del 12/08/2026 sobrevivieron a un `deploy.sh` completo y seguían enteros
 * cuando sus schemas ya estaban purgados, o sea sirviendo para nada excepto para
 * el que los encuentre.
 *
 * ── Y LOS FICHEROS APARTADOS ────────────────────────────────────────────────
 * Desde el 13/08 la baja también mueve los papeles del cliente a
 * `uploads/_bajas/<slug>_<fecha>/`. Esos NO los borra este script: pueden ser
 * documentos de salud y su destrucción es la PURGA, que se pide a propósito
 * cliente a cliente (`borrar-tenant.js <slug> --purgar`). Aquí solo se AVISA de
 * los que llevan mucho tiempo, que es información que hoy no tenía nadie.
 *
 * ── Y LA VUELTA ATRÁS QUE SE PIERDE ─────────────────────────────────────────
 * Sí: pasado el plazo, deshacer una baja deja de ser un comando. Es la decisión
 * correcta de todas formas — a los noventa días nadie va a «deshacer» nada, y el
 * schema apartado sigue entero, que es donde están los datos. Lo que se pierde
 * es poder devolver las filas de master automáticamente; volverlas a crear es un
 * alta.
 *
 * Uso local:  node --env-file=.env.local scripts/podar-bajas.js
 *             node --env-file=.env.local scripts/podar-bajas.js --dias=30 --aplicar
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/podar-bajas.js --aplicar
 *
 * Ensaya por defecto: sin `--aplicar` dice qué borraría y no toca nada.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { carpetaDeBajas } from "../lib/provisioning/bajaTenant.js";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const diasArg = args.find((a) => a.startsWith("--dias="));
/** 90 días: bastante para arrepentirse de una baja, poco para olvidarse. */
const DIAS = Number(diasArg ? diasArg.slice("--dias=".length) : 90);

const di = (s = "") => process.stdout.write(`${s}\n`);
const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} kB`);
const dias = (ms) => Math.floor(ms / 86_400_000);

async function main() {
  if (!Number.isFinite(DIAS) || DIAS < 1) {
    process.stderr.write(`\n✗ --dias tiene que ser un número de días (has puesto "${DIAS}").\n\n`);
    process.exit(1);
  }

  const carpeta = carpetaDeBajas();
  di();
  di("  ══════════════════════════════════════════════════════════");
  di(`   Podar redes de rescate de más de ${DIAS} días`);
  di("  ══════════════════════════════════════════════════════════");
  di(`     carpeta   ${carpeta}`);

  let entradas;
  try {
    entradas = await fs.readdir(carpeta, { withFileTypes: true });
  } catch (e) {
    di(`\n  No hay nada que podar (${e.code ?? e.message}).\n`);
    return;
  }

  const ahora = Date.now();
  const caducados = [];
  const vivos = [];
  const apartados = [];

  for (const e of entradas) {
    const abs = path.join(carpeta, e.name);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) continue;
    const edad = dias(ahora - st.mtimeMs);

    if (e.isDirectory()) {
      apartados.push({ nombre: e.name, edad });
      continue;
    }
    if (!e.name.endsWith(".rollback.sql")) continue;
    (edad >= DIAS ? caducados : vivos).push({ nombre: e.name, edad, bytes: st.size, abs });
  }

  di();
  di(`     redes vivas      ${vivos.length}`);
  for (const v of vivos) di(`       · ${v.nombre}  (${v.edad} d, ${kb(v.bytes)})`);
  di(`     redes caducadas  ${caducados.length}`);
  for (const c of caducados) di(`       · ${c.nombre}  (${c.edad} d, ${kb(c.bytes)})`);

  if (apartados.length) {
    di();
    di(`     ficheros apartados (NO se tocan aquí: eso es la purga)`);
    for (const a of apartados) di(`       · ${a.nombre}/  (${a.edad} d)`);
  }

  if (!caducados.length) {
    di("\n  Nada que podar.\n");
    return;
  }

  if (!APLICAR) {
    di("\n  ENSAYO. Nada se ha tocado.");
    di(`  Para hacerlo:  node scripts/podar-bajas.js --dias=${DIAS} --aplicar\n`);
    return;
  }

  for (const c of caducados) {
    await fs.rm(c.abs, { force: true });
    di(`     borrado ${c.nombre}`);
  }
  di(`\n  ${caducados.length} red(es) de rescate borradas. Sus schemas apartados siguen enteros.\n`);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  process.exit(1);
});
