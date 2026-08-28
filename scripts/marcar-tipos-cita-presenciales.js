/**
 * marcar-tipos-cita-presenciales.js — deja que un centro pueda apuntar citas
 * presenciales, añadiendo la modalidad y la dirección a sus tipos de cita.
 *
 * ⚠️ ENSAYA POR DEFECTO. Sin `--aplicar` no escribe nada.
 *
 * ── QUÉ PASÓ (28/08/2026, Lau de Aumenta) ───────────────────────────────────
 * Lau: «me pide seleccionar modalidad pero solo sale la modalidad online; si es
 * presencial no puedo seleccionarlo».
 *
 * Los 57 tipos de cita de Aumenta tienen `modalities = ["online"]` —el valor de
 * fábrica del modelo— porque el importador de julio los creó sin decir la
 * modalidad (`scripts/_hechos/import-aumenta-tipos-cita.js`). Mientras tanto,
 * las 12.030 citas que se volcaron son TODAS presenciales: entraron escribiendo
 * directamente en la base, sin pasar por la comprobación que las habría
 * rechazado por no coincidir con su tipo. O sea que la base lleva desde el 2 de
 * agosto contradiciéndose consigo misma.
 *
 * El efecto no se queda dentro del CRM: la pantalla solo ofrece lo que el tipo
 * permite, así que cada cita nueva nace 'online' y el correo de confirmación le
 * dice a la familia «Modalidad: Online (videollamada)» —sin enlace, porque el
 * centro está en modo manual—. Es información falsa saliendo por correo.
 *
 * ── POR QUÉ UN SCRIPT Y NO LA PANTALLA ──────────────────────────────────────
 * Porque son 57 tipos, uno a uno, y solo puede un administrador.
 *
 * Hubo un segundo motivo, más serio, y **ya no vale**: abrir un tipo en
 * /citas/tipos y guardarlo le borraba el precio. Lo arregló `a2835c9`, que está
 * desplegado desde el 28/08/2026. Se deja escrito en vez de borrarlo porque el
 * motivo se apuntó aquí, y quitarlo sin más deja a quien lo lea sin saber si la
 * pantalla es de fiar: lo es. Para UN tipo suelto, usa la pantalla.
 *
 * ── QUÉ TOCA, Y NADA MÁS ────────────────────────────────────────────────────
 * DOS columnas de `event_types`: `modalities` y `location`. No crea ni borra
 * ningún tipo, no toca citas, ni precios, ni duraciones, ni nombres, ni la
 * agenda. Al terminar hay exactamente los mismos tipos que había.
 *
 * ── LO QUE ESTO **NO** ARREGLA: LA RESERVA PÚBLICA ──────────────────────────
 * Esto desbloquea el alta MANUAL. El widget público sigue creando citas online
 * pase lo que pase: `app/api/public/c/[tenantSlug]/book/route.js:803` escribe
 * `modality: "online"` como literal, y los tres endpoints públicos
 * (`event-types:83`, `availability:51`, `book:194`) solo aceptan tipos que
 * incluyan online. La reserva pública presencial no existe todavía.
 *
 * Como esto DEJA online en la lista (suma, no reemplaza), el widget sigue
 * viendo los 57 tipos igual que antes: no rompe nada. Pero tampoco los arregla,
 * y en un centro cuyas 12.030 citas son presenciales, una reserva por la web
 * seguiría naciendo online. Está apuntado en el Registro como pregunta de
 * producto. Comprobado en producción el 28/08/2026: hoy no hay ni un tipo
 * activo en ningún cliente al que el filtro público esté escondiendo.
 *
 * Efecto lateral pequeño y conocido: el enlace «Añadir a Google Calendar» usa
 * `meetUrl || location` sin mirar la modalidad, así que en cuanto los tipos
 * tengan dirección, una cita online de Aumenta —que no tiene sala— la llevará
 * en el calendario. En este centro apunta al sitio correcto; en otro sería
 * incoherente con el «Modalidad: Online» del propio correo.
 *
 * ── LA DIRECCIÓN ES OBLIGATORIA, Y NO SE INVENTA ────────────────────────────
 * `lib/citas/validation.js` exige `location` para aceptar 'presencial', y con
 * razón: esa dirección se imprime en el correo de confirmación que recibe la
 * familia. Así que hay que dársela por parámetro, y **la tiene que dar el
 * centro**. Si tiene más de una sede, esto deja de valer y hay que ir tipo a
 * tipo.
 *
 * ── IDEMPOTENTE ─────────────────────────────────────────────────────────────
 * Un tipo que ya ofrece 'presencial' Y ya tiene la dirección pedida se deja
 * como está y se cuenta aparte. Lanzarlo dos veces no cambia nada la segunda.
 *
 * ── VUELTA ATRÁS ────────────────────────────────────────────────────────────
 * Con `--aplicar` deja un `.rollback.sql` con el UPDATE exacto que devuelve
 * cada fila a como estaba.
 *
 * USO
 *   node --env-file=.env.local scripts/marcar-tipos-cita-presenciales.js --tenant aumenta --direccion "Calle Tal 1, Fuenlabrada"
 *   … --aplicar                    escribe de verdad
 *   … --modalidades presencial     solo presencial (por defecto: presencial,online)
 *
 * En el VPS (que es donde están los datos de verdad):
 *   docker exec crm-salamandra-app-1 node scripts/marcar-tipos-cita-presenciales.js --tenant aumenta --direccion "..."
 *   docker exec crm-salamandra-app-1 node scripts/marcar-tipos-cita-presenciales.js --tenant aumenta --direccion "..." --aplicar
 *
 * NO lleva el seguro de `_guard-datos-reales.js` a propósito: está hecho para
 * correr sobre un cliente REAL. El freno es el ensayo por defecto.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMasterDb } from "../lib/db/masterDb.js";
import { VALID_MODALITIES, validateModalityFields } from "../lib/citas/validation.js";

const argv = process.argv.slice(2);
const valorDe = (bandera) => (argv.includes(bandera) ? argv[argv.indexOf(bandera) + 1] : null);

const APLICAR = argv.includes("--aplicar");
const SLUG = valorDe("--tenant");
const DIRECCION = (valorDe("--direccion") ?? "").trim();
const ROLLBACK_DIR = valorDe("--rollback-dir") ?? tmpdir();
const MODALIDADES = (valorDe("--modalidades") ?? "presencial,online")
  .split(",")
  .map((m) => m.trim().toLowerCase())
  .filter(Boolean);

const log = (m) => process.stdout.write(`  ${m}\n`);
const morir = (m) => {
  process.stderr.write(`\n✗ ${m}\n\n`);
  process.exit(1);
};

if (!SLUG || !/^[a-z0-9_]+$/.test(SLUG)) morir(`Falta o no vale --tenant (slug con guiones bajos). Recibido: ${SLUG ?? "nada"}`);
if (!MODALIDADES.length || MODALIDADES.some((m) => !VALID_MODALITIES.includes(m))) {
  morir(`--modalidades solo acepta ${VALID_MODALITIES.join(", ")}. Recibido: ${MODALIDADES.join(", ")}`);
}
// La dirección solo hace falta si se pide 'presencial', que es el caso normal.
if (MODALIDADES.includes("presencial") && !DIRECCION) {
  morir(
    "Falta --direccion.\n\n" +
    "  Marcar 'presencial' la exige (lib/citas/validation.js) y SALE IMPRESA en el\n" +
    "  correo de confirmación que recibe la familia. Tiene que darla el centro:\n" +
    "  no se pone una de relleno para que el script pase."
  );
}
// 'phone' pediría además un teléfono por tipo, que este script no gestiona.
if (MODALIDADES.includes("phone")) morir("Este script no pone la modalidad telefónica: exige un teléfono por tipo. Hazlo a mano.");

const SCHEMA = `crm_${SLUG}`;
const master = getMasterDb();

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(` Modalidad de los tipos de cita → ${SLUG}\n`);
process.stdout.write(` Se les pondrá: ${MODALIDADES.join(" + ")}\n`);
if (DIRECCION) process.stdout.write(` Dirección:     ${DIRECCION}\n`);
process.stdout.write(`${APLICAR ? " ⚠️  MODO REAL: va a escribir" : " · ENSAYO: no se escribe nada"}\n`);
process.stdout.write("══════════════════════════════════════════════════════\n\n");

// El cliente se comprueba contra master, no se da por hecho (regla #12).
const [tenants] = await master.query("SELECT id FROM master.tenants WHERE slug = :slug", {
  replacements: { slug: SLUG },
});
if (!tenants.length) {
  await master.close();
  morir(`No existe el cliente "${SLUG}" en master.tenants.`);
}

const [tablas] = await master.query(
  "SELECT 1 FROM information_schema.tables WHERE table_schema = :schema AND table_name = 'event_types'",
  { replacements: { schema: SCHEMA } }
);
if (!tablas.length) {
  log(`· ${SLUG} no tiene tabla event_types (¿sin módulo citas?). Nada que hacer.\n`);
  await master.close();
  process.exit(0);
}

const [filas] = await master.query(
  // `phone_number` y `meet_url` se traen aunque no se toquen: hacen falta para
  // validar el estado FINAL con la misma función que la API (ver más abajo).
  // Sin ellos, un tipo con modalidad telefónica y su teléfono puesto saldría
  // rechazado por un teléfono que sí tiene.
  `SELECT id, name, active, modalities, location, phone_number, meet_url
     FROM "${SCHEMA}"."event_types"
    ORDER BY name`
);

if (!filas.length) {
  log("· No hay ningún tipo de cita. Nada que hacer.\n");
  await master.close();
  process.exit(0);
}

const listaDe = (v) => (Array.isArray(v) ? v : []);

/*
 * SUMA, NO REEMPLAZA. Lo que se pide se AÑADE a lo que el tipo ya ofrecía, sin
 * quitarle nada.
 *
 * Salió del primer ensayo: un tipo con ["presencial","online","phone"] se
 * quedaba en ["presencial","online"] y perdía la modalidad telefónica en
 * silencio. Este script existe para DESBLOQUEAR una modalidad que falta, no
 * para decidir el catálogo de nadie — quitar una es una decisión del centro y
 * se hace tipo a tipo desde su pantalla.
 *
 * Y se CONSERVA EL ORDEN que ya tenía, añadiendo detrás solo lo que falte. Con
 * un orden «canónico» propio, un tipo que ya ofrecía las tres modalidades salía
 * marcado para cambiar solo porque la lista quedaba ordenada distinto: una
 * escritura inútil sobre datos de un cliente real, y un diff que asusta al
 * revisarlo.
 */
const finalDe = (f) => {
  const ya = listaDe(f.modalities);
  return [...ya, ...MODALIDADES.filter((m) => !ya.includes(m))];
};
const mismaLista = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const yaEsta = (f) =>
  mismaLista(listaDe(f.modalities), finalDe(f)) &&
  (!MODALIDADES.includes("presencial") || (f.location ?? "") === DIRECCION);

/*
 * ── NO DEJAR UN TIPO QUE LA PANTALLA YA NO PUEDA GUARDAR (28/08/2026) ───────
 *
 * Este script escribe en la base directamente, así que se salta la comprobación
 * que hace la API (`validateModalityFields`): 'presencial' exige una dirección y
 * 'phone' exige un teléfono. Un tipo que las incumpla se queda «inguardable»:
 * se ve bien, pero cualquier PATCH desde Citas → Tipos de cita devuelve 400.
 *
 * No es hipotético. Medido en producción ese día: **los 8 tipos de cita de las
 * cuatro demos están así** —aceptan presencial sin dirección, y la mitad además
 * teléfono sin teléfono—, de antes y sin que nadie lo tocara. Aumenta no: sus
 * 57 no ofrecen presencial todavía, que es justo lo que viene a arreglar esto.
 *
 * El caso que este script podría crear: añadir una modalidad a un tipo que YA
 * traía 'presencial' sin dirección. Ahí no se le pide `--direccion` —no la está
 * poniendo él— y saldría tocado y roto igual.
 *
 * Así que cada fila se valida con LA MISMA función que usa la API antes de
 * escribirla, y la que no pase se deja EXACTAMENTE como está y se dice por qué.
 * Mejor no tocar una fila que dejarla en un estado que solo se arregla por SQL.
 */
const estadoFinalDe = (f) => ({
  modalities: finalDe(f),
  location: MODALIDADES.includes("presencial") ? DIRECCION : (f.location ?? null),
  phoneNumber: f.phone_number ?? null,
  meetUrl: f.meet_url ?? null,
});

const candidatas = filas.filter((f) => !yaEsta(f));
const rechazadas = [];
const porTocar = [];
for (const f of candidatas) {
  const problema = validateModalityFields(estadoFinalDe(f));
  if (problema) rechazadas.push({ f, problema });
  else porTocar.push(f);
}
const intactos = filas.length - porTocar.length;

log(`Tipos de cita: ${filas.length} (${filas.filter((f) => f.active).length} activos)`);
log(`Ya están como se pide: ${intactos}`);
log(`Se van a cambiar: ${porTocar.length}`);
if (rechazadas.length) log(`⚠️  Se dejan sin tocar: ${rechazadas.length} (quedarían inguardables)`);
process.stdout.write("\n");

if (rechazadas.length) {
  log("⚠️  ESTOS NO SE TOCAN. Cambiarlos los dejaría en un estado que la pantalla");
  log("    de Tipos de cita ya no puede guardar (devolvería 400 al editarlos):");
  for (const { f, problema } of rechazadas.slice(0, 10)) log(`    · ${f.name} — ${problema}`);
  if (rechazadas.length > 10) log(`    … y ${rechazadas.length - 10} más.`);
  log("    Se arreglan poniéndoles lo que les falta desde Citas → Tipos de cita.");
  process.stdout.write("\n");
}

if (!porTocar.length) {
  if (rechazadas.length) {
    log("✗ No queda nada que se pueda cambiar sin romperlo. Arregla antes lo de arriba.\n");
    await master.close();
    process.exit(1);
  }
  log("✓ Todos están ya como se pide. Nada que hacer.\n");
  await master.close();
  process.exit(0);
}

for (const f of porTocar.slice(0, 10)) {
  log(`· ${f.name}${f.active ? "" : " (inactivo)"}`);
  log(`    ${JSON.stringify(listaDe(f.modalities))} → ${JSON.stringify(finalDe(f))}`);
  if (MODALIDADES.includes("presencial") && (f.location ?? "") !== DIRECCION) {
    log(`    dirección: ${f.location ? `«${f.location}»` : "(vacía)"} → «${DIRECCION}»`);
  }
}
if (porTocar.length > 10) log(`… y ${porTocar.length - 10} más.`);
process.stdout.write("\n");

if (!APLICAR) {
  process.stdout.write("══════════════════════════════════════════════════════\n");
  process.stdout.write(" ENSAYO: no se ha escrito nada. Con --aplicar se ejecuta.\n");
  process.stdout.write("══════════════════════════════════════════════════════\n\n");
  await master.close();
  process.exit(0);
}

// ── Vuelta atrás, ANTES de tocar nada ──────────────────────────────────────
const sql = porTocar
  .map(
    (f) =>
      `UPDATE "${SCHEMA}"."event_types" SET modalities = '${JSON.stringify(listaDe(f.modalities))}'::jsonb, ` +
      `location = ${f.location == null ? "NULL" : `'${String(f.location).replace(/'/g, "''")}'`} ` +
      `WHERE id = '${f.id}';`
  )
  .join("\n");
const ruta = join(ROLLBACK_DIR, `tipos-cita-${SLUG}.rollback.sql`);
writeFileSync(ruta, `-- Devuelve los ${porTocar.length} tipos de cita de ${SLUG} a como estaban\n${sql}\n`, "utf8");
log(`Vuelta atrás guardada en ${ruta}`);

let cambiados = 0;
const t = await master.transaction();
try {
  for (const f of porTocar) {
    await master.query(
      `UPDATE "${SCHEMA}"."event_types"
          SET modalities = :modalidades::jsonb,
              location   = :direccion,
              updated_at = NOW()
        WHERE id = :id`,
      {
        replacements: {
          modalidades: JSON.stringify(finalDe(f)),
          // Si no se pide presencial, la dirección se deja como estaba.
          direccion: MODALIDADES.includes("presencial") ? DIRECCION : (f.location ?? null),
          id: f.id,
        },
        transaction: t,
      }
    );
    cambiados++;
  }
  await t.commit();
} catch (err) {
  await t.rollback();
  await master.close();
  morir(`No se ha cambiado nada (todo o nada): ${err.message}`);
}

process.stdout.write("\n══════════════════════════════════════════════════════\n");
process.stdout.write(` ✓ ${cambiados} tipos de cita actualizados en ${SLUG}\n`);
process.stdout.write("══════════════════════════════════════════════════════\n\n");
log("Compruébalo: Citas → Nueva cita manual → elige un tipo; «Modalidad» debe ofrecer Presencial.");
log("Y las citas que ya existen NO se han tocado: siguen con la modalidad que tenían.\n");

await master.close();
