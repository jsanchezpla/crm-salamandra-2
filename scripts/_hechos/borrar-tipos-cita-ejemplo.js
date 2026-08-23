/**
 * borrar-tipos-cita-ejemplo.js — quita los tipos de cita de relleno.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no borra nada.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * Cuando se montó el tenant de Aumenta se sembraron tres tipos de cita de
 * ejemplo («Primera consulta», «Sesión seguimiento», «Mentoría directivos»)
 * para que la agenda no arrancara vacía. Con los 56 tipos reales de Organízate
 * ya dentro, sobran y ensucian el desplegable de recepción. Rodrigo pidió
 * borrarlos el 02/08/2026.
 *
 * ── La red de seguridad ────────────────────────────────────────────────────
 *
 * Un tipo de cita CON CITAS COLGANDO no se borra jamás, aunque se llame igual
 * que uno de ejemplo. `bookings_event_type_id_fkey` es **ON DELETE CASCADE**
 * (comprobado en la BD, no supuesto): borrar el tipo BORRA TODAS SUS CITAS, sin
 * preguntar y sin dar error. Por eso el recuento previo no es cosmético, es lo
 * único que separa «limpiar el desplegable» de «vaciar la agenda». Si alguno
 * tiene citas, el script lo salta y lo dice; no hay bandera para forzarlo.
 *
 * Los bloques de disponibilidad (`availabilities`) atados SOLO a ese tipo sí se
 * borran con él: sin su tipo no significan nada.
 *
 * Uso:
 *   node --env-file=.env.local scripts/borrar-tipos-cita-ejemplo.js            → simulación
 *   node --env-file=.env.local scripts/borrar-tipos-cita-ejemplo.js --confirm  → borra
 *   … --tenant demo    → otro tenant (por defecto, aumenta)
 */

import { getTenantDb } from "../../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";

/** Los sembró `expand-aumenta.js`. Se buscan por SLUG, que es lo estable. */
const DE_EJEMPLO = ["primera-consulta", "sesion-seguimiento", "mentoria-directivos"];

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` TIPOS DE CITA DE EJEMPLO → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a borrar" : " · SIMULACIÓN: no se borra nada"}`);
  console.log(`${"═".repeat(62)}\n`);

  const { models: m, sequelize } = getTenantDb(SLUG);

  const tipos = await m.EventType.findAll({ where: { slug: DE_EJEMPLO } });
  if (!tipos.length) {
    console.log("No queda ninguno de los tres: ya se borraron.\n");
    process.exit(0);
  }

  const borrables = [];
  for (const t of tipos) {
    const citas = await m.Booking.count({ where: { eventTypeId: t.id } });
    const huecos = await m.Availability.count({ where: { eventTypeId: t.id } });
    if (citas > 0) {
      console.log(`  ⛔ «${t.name}» tiene ${citas} cita(s). NO se toca.`);
      continue;
    }
    console.log(`  ✓ «${t.name}» · sin citas${huecos ? ` · ${huecos} bloque(s) de disponibilidad se van con él` : ""}`);
    borrables.push(t);
  }
  console.log("");

  if (!borrables.length) {
    console.log("Ninguno se puede borrar: todos tienen citas.\n");
    process.exit(0);
  }

  if (!CONFIRM) {
    console.log(`${"═".repeat(62)}`);
    console.log(` SIMULACIÓN: se borrarían ${borrables.length}. Con --confirm se ejecuta.`);
    console.log(`${"═".repeat(62)}\n`);
    process.exit(0);
  }

  await sequelize.transaction(async (t) => {
    for (const tipo of borrables) {
      await m.Availability.destroy({ where: { eventTypeId: tipo.id }, transaction: t });
      await tipo.destroy({ transaction: t });
    }
  });

  const quedan = await m.EventType.count();
  console.log(`Borrados ${borrables.length}. Quedan ${quedan} tipos de cita en "${SLUG}".\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✖ Error:", e.message);
  process.exit(1);
});
