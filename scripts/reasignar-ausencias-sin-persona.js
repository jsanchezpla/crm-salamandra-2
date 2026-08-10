/**
 * reasignar-ausencias-sin-persona.js — pone dueño a las ausencias que se
 * apuntaron como «Todo el centro» sin querer.
 *
 * ⚠️ ENSAYA POR DEFECTO. Sin `--aplicar` no escribe nada.
 *
 * ── QUÉ PASÓ ────────────────────────────────────────────────────────────────
 * En «Vacaciones y ausencias» el desplegable «Quién» venía en «Todo el centro»,
 * y cualquiera del equipo podía apuntar una ausencia a nombre de cualquiera. En
 * la consulta de Laura, Rocío apuntó SEIS veces sus propias ausencias sin tocar
 * el desplegable: las seis cerraron la agenda del centro entero, la de Laura
 * incluida. No se detectó porque el efecto que se ve —un hueco que no se
 * ofrece— es idéntico en los dos casos.
 *
 * El desplegable y los permisos ya están arreglados (10/08/2026). Esto es solo
 * para las filas que quedaron mal.
 *
 * ── QUÉ TOCA, Y NADA MÁS ────────────────────────────────────────────────────
 * UNA columna, `team_blocks.team_member_id`, de UN cliente. No borra ninguna
 * fila, no toca citas, ni pacientes, ni horarios, ni festivos, ni las fechas o
 * el motivo de la propia ausencia. Al terminar hay exactamente las mismas filas
 * que había.
 *
 * ── A QUIÉN SE LA ASIGNA, Y POR QUÉ ASÍ ─────────────────────────────────────
 * A quien la APUNTÓ (`created_by_id` → la ficha de equipo con ese `user_id`),
 * no a una lista escrita a mano. Es la única fuente que hay en la propia base:
 * si Rocío apuntó «no estoy el martes», la ausencia es de Rocío.
 *
 * Y SOLO si quien la apuntó NO es administrador. Un cierre de centro puesto por
 * dirección puede ser de verdad —una mudanza, una formación— y ese no se toca.
 * Un no-admin, en cambio, no tenía ningún motivo para cerrar el centro entero:
 * lo hizo porque el formulario venía así. Tras el arreglo ya ni puede.
 *
 * Cualquier fila que no cumpla las dos cosas se deja EXACTAMENTE como está y se
 * dice por pantalla, para que se mire a mano.
 *
 * ── VUELTA ATRÁS ────────────────────────────────────────────────────────────
 * Con `--aplicar` deja un `.rollback.sql` con el UPDATE exacto que devuelve
 * cada fila a como estaba. No hace falta restaurar una copia entera.
 *
 * USO
 *   node --env-file=.env.local scripts/reasignar-ausencias-sin-persona.js
 *   node --env-file=.env.local scripts/reasignar-ausencias-sin-persona.js --aplicar
 *   … --tenant otro_slug   (por defecto, nutri_laura)
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/reasignar-ausencias-sin-persona.js
 *   docker exec crm-salamandra-app-1 node scripts/reasignar-ausencias-sin-persona.js --aplicar
 *
 * NO lleva el seguro de `_guard-datos-reales.js` a propósito: este script está
 * hecho para correr sobre un cliente REAL. El freno es el ensayo por defecto.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMasterDb } from "../lib/db/masterDb.js";

const argv = process.argv.slice(2);
const APLICAR = argv.includes("--aplicar");
const SLUG = argv.includes("--tenant") ? argv[argv.indexOf("--tenant") + 1] : "nutri_laura";
/** Dónde dejar el .rollback.sql. Por defecto, la carpeta temporal (ver abajo). */
const ROLLBACK_DIR = argv.includes("--rollback-dir")
  ? argv[argv.indexOf("--rollback-dir") + 1]
  : tmpdir();

if (!/^[a-z0-9_]+$/.test(SLUG)) {
  process.stderr.write(`\n✗ Slug no válido: ${SLUG}\n\n`);
  process.exit(1);
}
const SCHEMA = `crm_${SLUG}`;

const log = (m) => process.stdout.write(`  ${m}\n`);
const fecha = (d) =>
  new Date(d).toLocaleString("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Madrid",
  });

const master = getMasterDb();

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(` Ausencias sin persona → ${SLUG}\n`);
process.stdout.write(`${APLICAR ? " ⚠️  MODO REAL: va a escribir" : " · ENSAYO: no se escribe nada"}\n`);
process.stdout.write("══════════════════════════════════════════════════════\n\n");

// El cliente se comprueba contra master, no se da por hecho (regla #12).
const [tenants] = await master.query(`SELECT id, slug FROM master.tenants WHERE slug = :slug`, {
  replacements: { slug: SLUG },
});
if (!tenants.length) {
  log(`✗ No existe el cliente "${SLUG}" en master.tenants.`);
  await master.close();
  process.exit(1);
}

const [tablas] = await master.query(
  `SELECT 1 FROM information_schema.tables WHERE table_schema = :schema AND table_name = 'team_blocks'`,
  { replacements: { schema: SCHEMA } }
);
if (!tablas.length) {
  log(`· ${SLUG} no tiene tabla team_blocks. Nada que hacer.`);
  await master.close();
  process.exit(0);
}

/*
 * Candidatas: sin persona y con autor conocido. Se cruza con la ficha de equipo
 * de ese autor y con su rol en master, que es donde vive el rol de verdad.
 */
const [filas] = await master.query(
  `SELECT b.id,
          b.label,
          b.start_at,
          b.end_at,
          b.created_by_id,
          tm.id            AS nuevo_dueno_id,
          tm.display_name  AS nuevo_dueno,
          u.email          AS autor_email,
          u.role           AS autor_rol
     FROM "${SCHEMA}"."team_blocks" b
     LEFT JOIN master.users u ON u.id = b.created_by_id
     LEFT JOIN "${SCHEMA}"."team_members" tm ON tm.user_id = b.created_by_id
    WHERE b.team_member_id IS NULL
    ORDER BY b.start_at`,
  { replacements: {} }
);

if (!filas.length) {
  log("✓ No hay ninguna ausencia sin persona. Nada que hacer.\n");
  await master.close();
  process.exit(0);
}

const ADMIN = new Set(["admin", "superadmin"]);
const aCambiar = [];
const seQuedan = [];

for (const f of filas) {
  if (!f.created_by_id) seQuedan.push([f, "no se sabe quién la apuntó"]);
  else if (!f.nuevo_dueno_id) seQuedan.push([f, `quien la apuntó (${f.autor_email ?? "?"}) no tiene ficha de equipo`]);
  else if (ADMIN.has(f.autor_rol)) seQuedan.push([f, `la apuntó dirección (${f.autor_email}): puede ser un cierre de verdad`]);
  else aCambiar.push(f);
}

process.stdout.write(`▶ SE REASIGNAN ${aCambiar.length} ausencia(s):\n\n`);
for (const f of aCambiar) {
  log(`${f.label}  ${fecha(f.start_at)} → ${fecha(f.end_at)}`);
  log(`     Todo el centro  ⇒  ${f.nuevo_dueno}   (la apuntó ${f.autor_email})`);
}

process.stdout.write(`\n▶ SE QUEDAN COMO ESTÁN ${seQuedan.length} ausencia(s):\n\n`);
if (!seQuedan.length) log("(ninguna)");
for (const [f, motivo] of seQuedan) {
  log(`${f.label}  ${fecha(f.start_at)} → ${fecha(f.end_at)}`);
  log(`     se deja en «Todo el centro»: ${motivo}`);
}

if (!APLICAR) {
  process.stdout.write("\n· Ensayo: no se ha escrito nada.\n");
  process.stdout.write("  Repasa las dos listas y, si cuadran, repite con --aplicar.\n\n");
  await master.close();
  process.exit(0);
}

if (!aCambiar.length) {
  process.stdout.write("\n· No hay nada que reasignar.\n\n");
  await master.close();
  process.exit(0);
}

// Vuelta atrás ANTES de tocar nada: si el proceso se cae a la mitad, el fichero
// ya está escrito y sirve igual.
const rollback = [
  `-- Deshace scripts/reasignar-ausencias-sin-persona.js sobre ${SCHEMA}`,
  `-- Devuelve cada ausencia a «Todo el centro» (team_member_id = NULL).`,
  "BEGIN;",
  ...aCambiar.map((f) => `UPDATE "${SCHEMA}"."team_blocks" SET team_member_id = NULL WHERE id = '${f.id}';`),
  "COMMIT;",
  "",
].join("\n");
/*
 * En la carpeta temporal, no en la del proyecto: dentro del contenedor la app
 * corre como `nextjs` y /app es de solo lectura, así que escribir aquí al lado
 * revienta con EACCES. Pasó en el primer intento del 10/08 — y como el fichero
 * se escribe ANTES de tocar la base, se cayó sin haber cambiado ni una fila,
 * que es justo lo que tenía que pasar.
 *
 * Si ni siquiera esto se puede escribir, se ABORTA: prefiero no reasignar nada
 * a reasignar sin manera de deshacerlo.
 */
const ficheroRollback = join(ROLLBACK_DIR, `reasignar-ausencias-${SLUG}.rollback.sql`);
try {
  writeFileSync(ficheroRollback, rollback, "utf8");
} catch (e) {
  process.stderr.write(`\n✗ No se ha podido escribir la vuelta atrás en ${ficheroRollback}: ${e.message}\n`);
  process.stderr.write("  No se toca la base. Repite con --rollback-dir o desde un sitio con permiso.\n\n");
  await master.close();
  process.exit(1);
}
log(`\n· Vuelta atrás escrita en ${ficheroRollback}`);

// Una transacción para todas: son cuatro filas de un cliente, o entran todas o
// no entra ninguna. Y por id, nunca por un WHERE que pudiera pillar de más.
const t = await master.transaction();
try {
  for (const f of aCambiar) {
    await master.query(
      `UPDATE "${SCHEMA}"."team_blocks" SET team_member_id = :dueno, updated_at = now() WHERE id = :id`,
      { replacements: { dueno: f.nuevo_dueno_id, id: f.id }, transaction: t }
    );
  }
  await t.commit();
} catch (e) {
  await t.rollback();
  process.stderr.write(`\n✗ ERROR, no se ha tocado nada: ${e.message}\n\n`);
  await master.close();
  process.exit(1);
}

// Se vuelve a leer de la base, no se da por hecho lo que se acaba de escribir.
const [despues] = await master.query(
  `SELECT coalesce(tm.display_name, '(Todo el centro)') AS quien, count(*)::int AS n
     FROM "${SCHEMA}"."team_blocks" b
     LEFT JOIN "${SCHEMA}"."team_members" tm ON tm.id = b.team_member_id
    GROUP BY 1 ORDER BY 2 DESC`
);

process.stdout.write(`\n✓ ${aCambiar.length} ausencia(s) reasignadas\n\n`);
process.stdout.write("▶ Cómo queda la tabla:\n\n");
for (const r of despues) log(`${String(r.n).padStart(3)} · ${r.quien}`);
process.stdout.write("\n");

await master.close();
process.exit(0);
