/**
 * arreglar-tipos-cita-demos.js — pone dirección y teléfono a los tipos de cita
 * de las demos, para que se puedan guardar.
 *
 * ⚠️ ENSAYA POR DEFECTO. Sin `--aplicar` no escribe nada.
 *
 * ── QUÉ PASA (28/08/2026) ───────────────────────────────────────────────────
 * En cualquiera de las cuatro demos, abrir un tipo de cita en Citas → Tipos de
 * cita y darle a guardar devuelve un error rojo: «El campo 'location' es
 * obligatorio cuando se acepta modalidad presencial». No se puede guardar ni
 * cambiándole solo el nombre. Los 8 tipos de las cuatro demos están así, y 4 de
 * ellos además aceptan modalidad telefónica sin número.
 *
 * Nacieron rotos porque el seed escribía directo al modelo y la comprobación
 * que exige la dirección corre al GUARDAR, no al sembrar: nacieron en un estado
 * que la propia pantalla rechaza. Eso ya no puede repetirse — el seed valida
 * antes de sembrar (`scripts/seed-sandbox-data.js`) y hay una prueba que lo
 * vigila (`scripts/_smoke-tipos-cita-demo.mjs`) —, pero los tipos que YA existen
 * siguen rotos y hay que arreglarlos uno a uno. De eso va este script.
 *
 * Las demos son el escaparate y dan sesión de admin a cualquier visitante, así
 * que esto es de las pocas pantallas donde un cliente potencial se topa con algo
 * que no funciona.
 *
 * ── POR QUÉ TOCA TAMBIÉN LA FOTO DORADA, Y POR QUÉ ESO ES LO BUENO ──────────
 * `crm_{slug}_golden` es la copia impecable desde la que se restaura la demo en
 * cada recarga dura (`lib/demo/resetDemo.js`). Sus 8 tipos están rotos IGUAL que
 * los vivos (comprobado el 28/08/2026: 16 filas en total). Arreglar solo lo vivo
 * duraría hasta la siguiente recarga.
 *
 * La salida obvia sería rehacer las fotos con `demo-golden-snapshot.js`, y es
 * PEOR: esa foto congela lo que haya en la demo en ese momento, incluido lo que
 * dejara un visitante cinco minutos antes. Este script arregla las mismas dos
 * columnas en los dos sitios, así que la foto sigue siendo la de siempre —solo
 * que con la dirección puesta— y no hay que rehacer nada.
 *
 * ── LO QUE NO HACE ──────────────────────────────────────────────────────────
 * · NO pisa un valor que ya esté puesto: solo rellena lo que está vacío.
 * · NO toca las modalidades. Si un tipo acepta presencial, se le da dirección;
 *   no se le quita la modalidad, que empobrecería el escaparate.
 * · NO acepta un tenant que no sea una demo. La dirección que pone es de
 *   mentira (`lib/demo/tiposCitaDemo.js`) y en un cliente real saldría impresa
 *   en el correo de confirmación de una familia de verdad.
 *
 * Es idempotente: la segunda vez no encuentra nada que tocar.
 *
 * Uso local:  node --env-file=.env.local scripts/arreglar-tipos-cita-demos.js
 *             node --env-file=.env.local scripts/arreglar-tipos-cita-demos.js --aplicar
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/arreglar-tipos-cita-demos.js
 *             docker exec crm-salamandra-app-1 node scripts/arreglar-tipos-cita-demos.js --aplicar
 *
 * Con `--aplicar` deja un `.rollback.sql` con el UPDATE exacto que devuelve cada
 * fila a como estaba (`--rollback-dir` para elegir dónde).
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMasterDb } from "../lib/db/masterDb.js";
import { DEMOS, schemaDorado } from "../lib/demo/demos.js";
import { SITIO_DEMO, TELEFONO_DEMO } from "../lib/demo/tiposCitaDemo.js";
import { validateModalityFields } from "../lib/citas/validation.js";

const argv = process.argv.slice(2);
const valorDe = (bandera) => (argv.includes(bandera) ? argv[argv.indexOf(bandera) + 1] : null);

const APLICAR = argv.includes("--aplicar");
const ROLLBACK_DIR = valorDe("--rollback-dir") ?? tmpdir();
const SOLO = valorDe("--tenant");

const log = (m) => process.stdout.write(`  ${m}\n`);
const morir = (m) => {
  process.stderr.write(`\n✗ ${m}\n\n`);
  process.exit(1);
};

// La lista blanca manda. Un slug que no esté en `lib/demo/demos.js` no es una
// demo, y aquí se escriben datos de mentira: en un cliente real esa dirección
// acabaría en el correo de confirmación de una familia.
const slugsDemo = DEMOS.map((d) => d.slug);
if (SOLO && !slugsDemo.includes(SOLO)) {
  morir(`"${SOLO}" no es una demo. Solo valen: ${slugsDemo.join(", ")}`);
}
const objetivo = SOLO ? [SOLO] : slugsDemo;

const master = getMasterDb();

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(" Tipos de cita de las demos: dirección y teléfono\n");
process.stdout.write(` Demos:     ${objetivo.join(", ")}\n`);
process.stdout.write(` Dirección: ${SITIO_DEMO}\n`);
process.stdout.write(` Teléfono:  ${TELEFONO_DEMO}\n`);
process.stdout.write(`${APLICAR ? " ⚠️  MODO REAL: va a escribir" : " · ENSAYO: no se escribe nada"}\n`);
process.stdout.write("══════════════════════════════════════════════════════\n\n");

/** ¿Existe la tabla event_types en ese schema? */
async function hayTabla(schema) {
  const [filas] = await master.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = :schema AND table_name = 'event_types'",
    { replacements: { schema } }
  );
  return filas.length > 0;
}

/** Qué le falta a un tipo para poder guardarse, según la regla de la pantalla. */
function loQueFalta(fila) {
  const modalidades = Array.isArray(fila.modalities) ? fila.modalities : [];
  const parche = {};
  if (modalidades.includes("presencial") && !fila.location) parche.location = SITIO_DEMO;
  if (modalidades.includes("phone") && !fila.phone_number) parche.phone_number = TELEFONO_DEMO;
  return parche;
}

// ── 1. Mirar, sin tocar ─────────────────────────────────────────────────────
const porTocar = [];
const sinTabla = [];

for (const slug of objetivo) {
  for (const schema of [`crm_${slug}`, schemaDorado(slug)]) {
    if (!(await hayTabla(schema))) {
      sinTabla.push(schema);
      continue;
    }
    const [filas] = await master.query(
      `SELECT id, name, modalities, location, phone_number FROM "${schema}"."event_types" ORDER BY "order", id`
    );
    let rotos = 0;
    for (const fila of filas) {
      const parche = loQueFalta(fila);
      if (!Object.keys(parche).length) continue;
      rotos++;
      porTocar.push({ schema, slug, fila, parche });
    }
    log(`${schema.padEnd(26)} ${String(filas.length).padStart(2)} tipos · ${rotos} por arreglar`);
  }
}

for (const schema of sinTabla) log(`${schema.padEnd(26)} (sin tabla event_types: se salta)`);
process.stdout.write("\n");

if (!porTocar.length) {
  process.stdout.write("══════════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ No hay nada que arreglar: todos se pueden guardar.\n");
  process.stdout.write("══════════════════════════════════════════════════════\n\n");
  await master.close();
  process.exit(0);
}

log(`Se van a tocar ${porTocar.length} filas:`);
for (const { schema, fila, parche } of porTocar.slice(0, 20)) {
  const que = Object.entries(parche).map(([k, v]) => `${k} ← "${v}"`).join(", ");
  log(`  · ${schema} "${fila.name}" ${JSON.stringify(fila.modalities)} → ${que}`);
}
if (porTocar.length > 20) log(`  … y ${porTocar.length - 20} más.`);
process.stdout.write("\n");

if (!APLICAR) {
  process.stdout.write("══════════════════════════════════════════════════════\n");
  process.stdout.write(" ENSAYO: no se ha escrito nada. Con --aplicar se ejecuta.\n");
  process.stdout.write("══════════════════════════════════════════════════════\n\n");
  await master.close();
  process.exit(0);
}

// ── 2. Vuelta atrás, ANTES de tocar nada ────────────────────────────────────
const comillas = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const sql = porTocar
  .map(
    ({ schema, fila }) =>
      `UPDATE "${schema}"."event_types" SET location = ${comillas(fila.location)}, ` +
      `phone_number = ${comillas(fila.phone_number)} WHERE id = '${fila.id}';`
  )
  .join("\n");
const ruta = join(ROLLBACK_DIR, "tipos-cita-demos.rollback.sql");
writeFileSync(ruta, `-- Devuelve las ${porTocar.length} filas a como estaban\n${sql}\n`, "utf8");
log(`Vuelta atrás guardada en ${ruta}`);

// ── 3. Escribir, todo o nada ────────────────────────────────────────────────
let cambiadas = 0;
const t = await master.transaction();
try {
  for (const { schema, fila, parche } of porTocar) {
    await master.query(
      `UPDATE "${schema}"."event_types"
          SET location     = COALESCE(:location, location),
              phone_number = COALESCE(:telefono, phone_number),
              updated_at   = NOW()
        WHERE id = :id`,
      {
        replacements: {
          location: parche.location ?? null,
          telefono: parche.phone_number ?? null,
          id: fila.id,
        },
        transaction: t,
      }
    );
    cambiadas++;
  }
  await t.commit();
} catch (err) {
  await t.rollback();
  await master.close();
  morir(`No se ha cambiado nada (todo o nada): ${err.message}`);
}

// ── 4. Comprobar con la MISMA regla que la pantalla ─────────────────────────
let quedanRotos = 0;
for (const schema of [...new Set(porTocar.map((p) => p.schema))]) {
  const [filas] = await master.query(
    `SELECT name, modalities, location, phone_number FROM "${schema}"."event_types"`
  );
  for (const f of filas) {
    const error = validateModalityFields({
      modalities: Array.isArray(f.modalities) ? f.modalities : [],
      location: f.location,
      phoneNumber: f.phone_number,
    });
    if (error) {
      quedanRotos++;
      log(`⚠️  ${schema} "${f.name}" SIGUE sin poder guardarse: ${error}`);
    }
  }
}

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(` ✓ ${cambiadas} filas actualizadas (vivas + fotos doradas)\n`);
process.stdout.write(
  quedanRotos
    ? ` ⚠️  ${quedanRotos} tipos siguen sin poder guardarse: míralos.\n`
    : " ✓ Todos los tipos de las demos se pueden guardar ya.\n"
);
process.stdout.write("══════════════════════════════════════════════════════\n\n");
log("Compruébalo: en una demo, Citas → Tipos de cita → abrir uno y guardar sin cambiar nada.");
log("Las fotos doradas NO hay que rehacerlas: se han arreglado a la vez.\n");

await master.close();
