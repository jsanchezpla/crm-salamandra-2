/**
 * renumerar-sesiones-de-bono.js — las citas que se rotularon «1/5» siendo la
 * quinta (18/09/2026, Aumenta: «hay bonos que se han migrado mal de organizate
 * y pueden ser la cita 5/5 en organizate y aparecer como 1/5 en nuestro crm»).
 *
 * ── QUÉ PASÓ, Y QUÉ NO ─────────────────────────────────────────────────────
 * No fue la migración: el dato llegó bien. Medido en producción el 18/09/2026,
 * los 232 bonos de Organízate tienen `sesiones_previas` exactamente igual a lo
 * que dice la nota que se les escribió al traerlos (0 discrepancias), y ni una
 * sola cita suya es anterior a 2026, así que tampoco hay doble conteo.
 *
 * Fue el CÓDIGO. `estadoPack` suma las previas desde el 09/09/2026 —por eso las
 * cuentas del dinero salían bien: CERO bonos habían pasado de su tope— pero
 * `siguienteNumeroSesion` no las miraba. Así que la primera cita que se apuntaba
 * en el CRM contra un bono que ya venía con 4 de 5 gastadas nacía como
 * «sesión 1», y la rejilla escribía «Bono 1/5» de la última sesión que le
 * quedaba a esa familia. Arreglado en `lib/citas/packs.js` con su prueba
 * (`scripts/_smoke-packs-sesiones.mjs`).
 *
 * Este script es solo para las citas que YA se crearon mal. Son pocas —4 en
 * producción, en 3 bonos— pero son las que lee quien avisa a las familias.
 *
 * ── QUÉ RENUMERA, Y POR QUÉ TAN POCO ───────────────────────────────────────
 * SOLO las citas de un bono con `sesiones_previas > 0` cuyo número esté dentro
 * del tramo que el bono ya traía gastado (`session_number <= sesiones_previas`).
 * Ese número es imposible de todas todas: nombra una sesión que se dio en
 * Organízate años antes de que el CRM existiera. Las demás no se tocan aunque
 * parezcan raras, porque la regla de la casa es que un número de sesión no se
 * recicla: lo que la profesional apuntó como «sesión 3» tiene que seguir siendo
 * la 3 dentro de un año (`models/tenant/Booking.model.js`).
 *
 * Se renumeran CORRIDAS hacia arriba, respetando el orden entre ellas: la más
 * antigua pasa a ser `previas + 1`, la siguiente `previas + 2`… Así un bono con
 * dos citas mal puestas no acaba con dos sesiones del mismo número.
 *
 * Idempotente: en cuanto una cita queda por encima de las previas, deja de
 * entrar en el WHERE. Relanzarlo no mueve nada.
 *
 * ── LO QUE NO HACE ─────────────────────────────────────────────────────────
 * No toca `sesiones_previas` (el dato está bien), no toca el estado de ningún
 * bono, no crea ni borra citas y no toca el dinero. Solo el rótulo.
 *
 * Recorre los tenants de `master.tenants` en tiempo de ejecución (regla 12),
 * nunca una lista a mano. En seco por defecto.
 *
 * Uso local:
 *   node --env-file=.env.local scripts/renumerar-sesiones-de-bono.js
 *   node --env-file=.env.local scripts/renumerar-sesiones-de-bono.js aumenta --confirm
 * Uso VPS:
 *   docker exec -it crm-salamandra-app-1 node scripts/renumerar-sesiones-de-bono.js
 *   docker exec -it crm-salamandra-app-1 node scripts/renumerar-sesiones-de-bono.js --confirm
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { auditar } from "../lib/utils/auditoria.js";

const args = process.argv.slice(2);
const CONFIRMAR = args.includes("--confirm");
const SLUG = args.find((a) => !a.startsWith("--")) ?? null;

const n = (x) => String(x).padStart(6);

async function tenants() {
  const db = getMasterDb();
  // El `id` hace falta para la auditoría, que vive en master y va por tenantId.
  return db.query(
    `SELECT id, slug FROM master.tenants WHERE slug = COALESCE(:slug, slug) ORDER BY slug`,
    { type: db.QueryTypes.SELECT, replacements: { slug: SLUG } }
  );
}

async function unTenant({ id: tenantId, slug }) {
  const { sequelize } = getTenantDb(slug);
  const esquema = `crm_${slug}`;
  const q = (sql, opciones = {}) =>
    sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, ...opciones });

  // Sin las dos tablas no hay nada que renumerar (un tenant sin módulo de citas).
  const [existe] = await q(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = :esquema AND table_name IN ('bookings','session_packs')`,
    { replacements: { esquema } }
  );
  if (existe.n < 2) return null;

  /*
   * Las citas imposibles, con el número que les toca.
   *
   * `fila` las ordena DENTRO de cada bono por el número que llevan y, a igualdad,
   * por la fecha de la cita: así dos citas mal puestas del mismo bono salen
   * corridas (previas+1, previas+2) y no las dos con el mismo número.
   */
  const MALAS = `
    SELECT b.id,
           b.session_number AS num,
           sp.id   AS pack_id,
           sp.sesiones_previas AS previas,
           sp.total_sessions   AS tope,
           sp.sesiones_previas + ROW_NUMBER() OVER (
             PARTITION BY sp.id ORDER BY b.session_number, b.scheduled_at, b.id
           ) AS nuevo
      FROM ${esquema}.bookings b
      JOIN ${esquema}.session_packs sp ON sp.id = b.pack_id
     WHERE sp.sesiones_previas > 0
       AND b.session_number IS NOT NULL
       AND b.session_number <= sp.sesiones_previas`;

  const malas = await q(MALAS);
  const [enganchadas] = await q(
    `SELECT COUNT(*)::int n FROM ${esquema}.bookings WHERE pack_id IS NOT NULL`
  );

  if (!malas.length) {
    console.log(`\n▶ ${slug}`);
    console.log(`  citas enganchadas a un bono               ${n(enganchadas.n)}`);
    console.log("  · mal numeradas                                0   — nada que hacer");
    return { slug, citas: enganchadas.n, malas: 0, renumeradas: 0, bonos: 0 };
  }

  const bonos = new Set(malas.map((m) => String(m.pack_id))).size;
  console.log(`\n▶ ${slug}`);
  console.log(`  citas enganchadas a un bono               ${n(enganchadas.n)}`);
  console.log(`  · mal numeradas                           ${n(malas.length)}   en ${bonos} bonos`);
  // Sin nombres ni ids de persona: solo la cuenta. Es lo que hace falta ver.
  for (const m of malas) {
    console.log(`      rotulada ${m.num}/${m.tope ?? "—"} · le toca la ${m.nuevo} (el bono llegó con ${m.previas} gastadas)`);
  }

  let renumeradas = 0;
  if (CONFIRMAR) {
    /*
     * Un solo UPDATE con la misma subconsulta del ensayo: lo que se enseña es
     * exactamente lo que se escribe. El `session_number <= sesiones_previas` de
     * dentro es lo que lo hace idempotente — en la segunda pasada no casa nadie.
     */
    const [, meta] = await sequelize.query(`
      UPDATE ${esquema}.bookings b
         SET session_number = m.nuevo,
             updated_at = NOW()
        FROM (${MALAS}) m
       WHERE b.id = m.id`);
    renumeradas = meta?.rowCount ?? malas.length;
    console.log(`  ✓ ${renumeradas} citas renumeradas`);

    // Auditoría DESPUÉS de la mutación y con un RESUMEN: ni un id de paciente
    // ni un nombre, que master es un schema compartido.
    await auditar({
      tenantId,
      action: "citas.bono_sesiones_renumeradas",
      entity: "booking",
      after: { renumeradas, bonos, motivo: "sesiones previas del bono no contadas al numerar" },
    });
  }

  const quedan = await q(MALAS);
  console.log(`  quedan mal numeradas                      ${n(quedan.length)}`);
  return { slug, citas: enganchadas.n, malas: malas.length, renumeradas, bonos };
}

console.log("═".repeat(64));
console.log(
  ` Sesiones de bono mal numeradas${SLUG ? ` — ${SLUG}` : ""}${CONFIRMAR ? "" : "  ·  ENSAYO (no escribe)"}`
);
console.log("═".repeat(64));

const filas = [];
for (const t of await tenants()) {
  try {
    const r = await unTenant(t);
    if (r) filas.push(r);
  } catch (e) {
    console.error(`\n✗ ${t.slug}: ${e.message}`);
  }
}

const malas = filas.reduce((a, f) => a + f.malas, 0);
const hechas = filas.reduce((a, f) => a + f.renumeradas, 0);
console.log("\n" + "─".repeat(64));
console.log(` ${filas.length} tenants con bonos · ${malas} citas mal numeradas · ${hechas} renumeradas`);
if (!CONFIRMAR && malas) console.log(" (ensayo: repite con --confirm para escribir)");
console.log("─".repeat(64) + "\n");

await closeAllConnections();
process.exit(0);
