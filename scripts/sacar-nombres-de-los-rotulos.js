// @vivo — Saca el nombre del paciente de los rótulos de bloqueo y lo engancha por `patient_id`. Genérico, en seco por defecto; se relanza cuando el centro dé de alta a los niños que hoy no tienen ficha.
/**
 * sacar-nombres-de-los-rotulos.js — el nombre del niño deja de estar escrito en
 * el rótulo de un hueco reservado y pasa a viajar por su enlace (08/09/2026,
 * Rodrigo).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── QUÉ ARREGLA ────────────────────────────────────────────────────────────
 * En Aumenta hay 381 bloqueos de «reserva de plaza» cuyo rótulo lleva el nombre
 * y el apellido de un niño. Los ve todo el equipo, porque el 14/08/2026 los
 * bloqueos dejaron de seguir el filtro de visibilidad de las citas — y el
 * motivo que se escribió entonces fue que «un bloqueo no tiene paciente».
 * Aquí lo tiene, y un rótulo es texto libre que no obedece a ningún permiso.
 *
 * Este script mueve el nombre del texto al enlace. Lo que queda en el rótulo es
 * lo que le sirve a recepción: «RESERVADO, EMPIEZA EL 15/09».
 *
 * ── LO QUE NO HACE ─────────────────────────────────────────────────────────
 * **No convierte bloqueos en citas.** Se miró y no se puede: de los 381, 298
 * nombran a un niño que todavía no tiene ficha (la plaza se guarda ANTES del
 * alta) y 42 de los 44 que dicen «empieza el X» caen ANTES de esa fecha, o sea
 * que son huecos en los que el niño NO viene. Crear ahí una cita sería inventar
 * una sesión en la ficha de un paciente y, en Aumenta, meterla en el cobro del
 * mes.
 *
 * **Y no adivina.** Solo toca el rótulo donde UN paciente y solo uno casa por
 * nombre Y primer apellido (`lib/citas/rotuloSinNombre.js`). Con cero o con
 * varios, se deja como está y se cuenta aparte: no se puede quitar un nombre
 * que no se sabe identificar, y vaciar el rótulo destruiría la única pista que
 * tiene el centro. Emparejar por nombre alegremente es lo que esta misma semana
 * habría cambiado el pagador de 669 familias.
 *
 * Es idempotente y se puede relanzar: los que ya están enganchados y limpios no
 * dan cambio. Conviene volver a pasarlo cuando el centro dé de alta a los niños
 * que hoy no tienen ficha, porque entonces sí casarán.
 *
 * El rótulo de antes se guarda en las notas, para poder deshacerlo.
 *
 * Uso:
 *   node --env-file=.env.local scripts/sacar-nombres-de-los-rotulos.js <slug>
 *   node --env-file=.env.local scripts/sacar-nombres-de-los-rotulos.js <slug> --confirm
 *   … --detalle    enseña cada rótulo (⚠️ imprime nombres: solo en local)
 */

import { getTenantDb } from "../lib/db/tenantDb.js";
import { despiezarRotulo, pacienteCasaConRotulo } from "../lib/citas/rotuloSinNombre.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const DETALLE = args.includes("--detalle");
const SLUG = args.find((a) => !a.startsWith("--"));

if (!SLUG) {
  process.stderr.write("\n✗ Falta el slug del cliente.\n\n");
  process.exit(1);
}

async function main() {
  process.stdout.write(`\n${"═".repeat(70)}\n`);
  process.stdout.write(` NOMBRES FUERA DE LOS RÓTULOS DE BLOQUEO → "${SLUG}"\n`);
  process.stdout.write(CONFIRM ? " ⚠️  MODO REAL: va a escribir\n" : " · SIMULACIÓN: no se escribe nada\n");
  process.stdout.write(`${"═".repeat(70)}\n\n`);

  const { models: m } = getTenantDb(SLUG);
  if (!m.Patient) {
    process.stdout.write(" Este centro no tiene pacientes: nada que hacer.\n\n");
    process.exit(0);
  }

  const pacientes = await m.Patient.findAll({ attributes: ["id", "firstName", "lastName"], raw: true });
  const bloqueos = await m.TeamBlock.findAll({
    attributes: ["id", "label", "notes", "patientId", "startAt"],
    order: [["startAt", "ASC"]],
  });
  process.stdout.write(`  ${bloqueos.length} bloqueos · ${pacientes.length} pacientes\n\n`);

  let cambian = 0, yaEstaban = 0, ambiguos = 0, sinFicha = 0, sinNombre = 0;
  const aCambiar = [];

  for (const b of bloqueos) {
    const despiece = despiezarRotulo(b.label, pacientes);
    if (despiece) {
      if (b.patientId === despiece.patientId && b.label === despiece.label) { yaEstaban++; continue; }
      cambian++;
      aCambiar.push({ b, despiece });
      if (DETALLE) process.stdout.write(`  · «${b.label}»\n    → «${despiece.label}» + enlace\n`);
      continue;
    }
    // Sin despiece: ¿por qué? Solo para poder contarlo.
    const casan = pacientes.filter((p) => pacienteCasaConRotulo(p, b.label));
    if (casan.length > 1) ambiguos++;
    else if (/reservad/i.test(String(b.label ?? ""))) sinFicha++;
    else sinNombre++;
  }

  process.stdout.write(`\n  se pueden limpiar        : ${String(cambian).padStart(4)}\n`);
  process.stdout.write(`  ya estaban limpios       : ${String(yaEstaban).padStart(4)}\n`);
  process.stdout.write(`  ambiguos (2+ candidatos) : ${String(ambiguos).padStart(4)}   ← se dejan a propósito\n`);
  process.stdout.write(`  reservas sin ficha       : ${String(sinFicha).padStart(4)}   ← el niño aún no está dado de alta\n`);
  process.stdout.write(`  sin nombre dentro        : ${String(sinNombre).padStart(4)}   ← vacaciones, descansos, reuniones\n`);

  if (!cambian) {
    process.stdout.write("\n  Nada que cambiar.\n\n");
    process.exit(0);
  }
  if (!CONFIRM) {
    process.stdout.write(`\n${"═".repeat(70)}\n`);
    process.stdout.write(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.\n");
    process.stdout.write(`${"═".repeat(70)}\n\n`);
    process.exit(0);
  }

  process.stdout.write("\n  ⚠️  Escribiendo…\n");
  let hechos = 0;
  for (const { b, despiece } of aCambiar) {
    // El rótulo de antes queda en las notas: sin eso, deshacerlo sería
    // reconstruir a mano un texto que ya no está en ninguna parte.
    const nota = `Rótulo antes del 08/09/2026: «${b.label}»`;
    await m.TeamBlock.update(
      {
        label: despiece.label,
        patientId: despiece.patientId,
        notes: [b.notes, nota].filter(Boolean).join(" · ").slice(0, 4000),
      },
      { where: { id: b.id } }
    );
    hechos++;
  }
  // Se relee: `update` por WHERE no dice si escribió.
  const quedan = (await m.TeamBlock.findAll({ attributes: ["id", "label", "patientId"], raw: true }))
    .filter((b) => despiezarRotulo(b.label, pacientes));
  process.stdout.write(`  ✓ ${hechos} bloqueos limpiados · quedan por limpiar: ${quedan.length}\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
