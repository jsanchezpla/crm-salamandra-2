/**
 * acortar-bloqueos-de-nueve-meses.js — los dos bloqueos que tapaban un curso
 * entero (08/09/2026).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── QUÉ PASÓ ───────────────────────────────────────────────────────────────
 * Daniela escribió al Buzón (AV-0054): «sigo sin tener horario en CRM
 * actualizado… no coincide». Su agenda coincidía con Organízate cita a cita
 * hasta el viernes 11 —comprobadas las cinco jornadas del 7 al 11, las 21
 * citas y los bloqueos, una a una contra Organízate—, y a partir de ahí tenía
 * encima UN bloqueo del 11/09/2026 a las 15:30 al 30/06/2027 a las 15:45:
 * 420.495 minutos, 991 citas vivas debajo. Estefanía tenía otro igual,
 * etiquetado «Vacaciones», con 1.163 citas debajo.
 *
 * No son vacaciones ni descansos: son la fecha de fin puesta como si fuera
 * «hasta cuándo se repite». La huella es idéntica en los dos: hora de fin =
 * hora de inicio + 15 min, fecha de fin = último día del curso. El freno para
 * que no vuelva a pasar es `lib/citas/duracionBloqueo.js` (commit 937f7588).
 *
 * ── POR QUÉ ACORTA Y NO BORRA ──────────────────────────────────────────────
 * Acortar es reversible con un UPDATE y borrar no. Cada bloqueo se queda con
 * la duración que de verdad se tecleó —los quince minutos de su hora de fin—,
 * que es lo único que se sabe con certeza de la intención. Lo que sobre a
 * partir de ahí (a Daniela le quedan cinco bloqueos vacíos más a esa misma
 * hora, de sus otros cinco intentos) lo decide el centro: no se toca.
 *
 * Para deshacerlo, los valores de antes se imprimen y se guardan en las notas.
 *
 * Uso:
 *   node scripts/_hechos/acortar-bloqueos-de-nueve-meses.js
 *   node scripts/_hechos/acortar-bloqueos-de-nueve-meses.js --confirm
 */

import { getTenantDb } from "../../lib/db/tenantDb.js";
import { avisoDeBloqueoLargo } from "../../lib/citas/duracionBloqueo.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";

const fmt = (d) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d instanceof Date ? d : new Date(d));

async function main() {
  console.log(`\n${"═".repeat(70)}`);
  console.log(` BLOQUEOS DE MÁS DE UN DÍA → tenant "${SLUG}"`);
  console.log(CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada");
  console.log(`${"═".repeat(70)}\n`);

  const { models: m, sequelize } = getTenantDb(SLUG);
  const { Op } = sequelize.Sequelize;

  const todos = await m.TeamBlock.findAll({
    include: [{ model: m.TeamMember, as: "teamMember", attributes: ["displayName"], required: false }],
    order: [["startAt", "ASC"]],
  });

  // La huella: más de un día Y acabando a la misma hora del día a la que
  // empieza. Un bloqueo largo de verdad (unas vacaciones) no la tiene, así que
  // este script no lo tocaría aunque apareciera mañana.
  const rotos = todos.filter((b) => {
    const a = avisoDeBloqueoLargo(b.startAt, b.endAt);
    return a && a.mismaHoraDelDia;
  });

  if (!rotos.length) {
    console.log(" No hay ninguno. Nada que hacer.\n");
    process.exit(0);
  }

  for (const b of rotos) {
    const finBueno = new Date(b.startAt);
    // La hora de fin que se tecleó, el MISMO día que empieza.
    const fin = new Date(b.endAt);
    const hhmm = new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(fin);
    const [h, mi] = hhmm.split(":").map(Number);
    const inicioHhmm = new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(b.startAt));
    const [hIni, miIni] = inicioHhmm.split(":").map(Number);
    // Minutos que dura de verdad, según lo que se tecleó en la hora de fin.
    const dura = (h * 60 + mi) - (hIni * 60 + miIni);
    finBueno.setTime(new Date(b.startAt).getTime() + (dura > 0 ? dura : 15) * 60000);

    console.log(`  ${b.teamMember?.displayName ?? "(sin persona)"} · «${b.label || "(sin etiqueta)"}»`);
    console.log(`     antes:   ${fmt(b.startAt)} → ${fmt(b.endAt)}`);
    console.log(`     después: ${fmt(b.startAt)} → ${fmt(finBueno)}   (${dura > 0 ? dura : 15} min)`);

    const citas = await m.Booking.count({
      where: {
        teamMemberId: b.teamMemberId,
        status: { [Op.ne]: "cancelled" },
        scheduledAt: { [Op.gte]: b.startAt, [Op.lt]: b.endAt },
      },
    });
    console.log(`     citas que deja de tapar: ${citas}`);

    if (!CONFIRM) { console.log("     [SIMULACIÓN]\n"); continue; }

    const nota = `Acortado el 08/09/2026: estaba puesto hasta ${fmt(b.endAt)} y tapaba ${citas} citas. Para deshacerlo, endAt = ${new Date(b.endAt).toISOString()}.`;
    await m.TeamBlock.update(
      { endAt: finBueno, notes: [b.notes, nota].filter(Boolean).join(" · ") },
      { where: { id: b.id } }
    );
    // Se relee: `update` por WHERE no dice si escribió, y aquí importa.
    const despues = await m.TeamBlock.findByPk(b.id);
    console.log(`     ✓ guardado · ahora acaba ${fmt(despues.endAt)}\n`);
  }

  if (!CONFIRM) {
    console.log(`${"═".repeat(70)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(70)}\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
