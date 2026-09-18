/**
 * backfill-duracion-sesion-desde-cita.js — a la sesión que ya está enganchada a
 * una cita, ponerle la duración que la cita ya sabía (18/09/2026, Aumenta por
 * Jorge).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── DE DÓNDE VIENE ──────────────────────────────────────────────────────────
 * Del cierre de «Sesiones de 45min». Desde `749a0a2c`, una sesión que nace de
 * una cita hereda su duración (`lib/clinica/duracionDeLaSesion.js`). Pero eso
 * solo mira hacia adelante: las que ya estaban se quedaron en «— min» teniendo
 * la respuesta a un `JOIN` de distancia. Medido en producción el 18/09/2026, en
 * Aumenta: **508 sesiones con cita y sin duración**, 271 cuya cita dice 45 y 237
 * cuya cita dice 60.
 *
 * No es lo mismo que `vaciar-duracion-sesiones-volcadas.js`, que QUITA un número
 * que nadie midió. Esto PONE uno que sí se sabe: la duración de la cita es una
 * foto de su tipo al reservarla, y es exactamente lo que el código escribe hoy
 * para las sesiones nuevas. El resultado es que las de antes y las de después
 * dicen lo mismo por la misma razón.
 *
 * ── LAS DOS CONDICIONES, Y POR QUÉ ──────────────────────────────────────────
 *   · **Solo si la sesión NO tiene duración.** Una duración escrita a mano gana
 *     siempre: es la única persona que estuvo allí.
 *   · **Solo si la cita es DEL MISMO PACIENTE que la sesión.** Es la misma regla
 *     que aplica el servidor al crearlas, y por el mismo motivo: `bookingId` no
 *     se comprueba contra el paciente en ningún otro sitio, así que una cita
 *     ajena mal enganchada no puede decidir nada de la sesión de otro niño. El
 *     18/09/2026 las 508 de Aumenta cumplían las dos, pero la condición se queda
 *     escrita porque el día que no se cumpla es justo el día que importa.
 *
 * Los minutos se validan con `minutosDeSesion`, la MISMA función que usan el POST
 * y el PATCH: si algún día cambia el rango, cambia en los tres a la vez.
 *
 * Nada del texto clínico se toca.
 *
 * ── POR QUÉ NO ES UNA MIGRACIÓN (regla 12) ──────────────────────────────────
 * Porque no cambia la forma del schema, cambia datos. Como todo backfill mira el
 * `status` del tenant —en un cliente apagado no se escribe— y recibe el slug por
 * argumento en vez de llevarlo dentro. En un centro sin sesiones enganchadas a
 * citas no toca nada y lo dice.
 *
 * Uso local:  node --env-file=.env.local scripts/backfill-duracion-sesion-desde-cita.js <slug>
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/backfill-duracion-sesion-desde-cita.js <slug> --confirm
 * Deshacer:   docker exec crm-salamandra-app-1 node scripts/backfill-duracion-sesion-desde-cita.js <slug> --deshacer /tmp/duracion-desde-cita-<slug>.json
 */

import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Sequelize } from "sequelize";
import { minutosDeSesion } from "../lib/clinica/duracionDeLaSesion.js";

const LOTE = 200;

function out(msg) {
  process.stdout.write(`${msg}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const iDeshacer = args.indexOf("--deshacer");
  const ficheroDeshacer = iDeshacer >= 0 ? args[iDeshacer + 1] : null;
  const slug = args.find((a) => !a.startsWith("--") && a !== ficheroDeshacer);

  if (!slug) {
    process.stderr.write(
      "\nUso: node scripts/backfill-duracion-sesion-desde-cita.js <slug> [--confirm]\n" +
        "     node scripts/backfill-duracion-sesion-desde-cita.js <slug> --deshacer <fichero.json>\n\n"
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const [tenants] = await s.query(`SELECT slug, name, status FROM master.tenants WHERE slug = :slug`, {
    replacements: { slug },
  });
  if (!tenants.length) {
    process.stderr.write(`✗ No existe el cliente «${slug}».\n`);
    await s.close();
    process.exit(1);
  }
  const t = tenants[0];
  if (t.status !== "active") {
    process.stderr.write(`✗ «${slug}» está en estado «${t.status}»: en un cliente que no está activo no se escribe.\n`);
    await s.close();
    process.exit(1);
  }
  const schema = `crm_${slug}`;

  // ── Deshacer ─────────────────────────────────────────────────────────────
  if (ficheroDeshacer) {
    const guardado = JSON.parse(readFileSync(ficheroDeshacer, "utf8"));
    const filas = Array.isArray(guardado?.filas) ? guardado.filas : [];
    if (guardado?.slug && guardado.slug !== slug) {
      process.stderr.write(`✗ Ese fichero es de «${guardado.slug}», no de «${slug}».\n`);
      await s.close();
      process.exit(1);
    }
    out(`\nDeshacer: ${filas.length} sesiones de «${slug}» vuelven a su duración anterior.`);
    if (!confirm) {
      out("SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.\n");
      await s.close();
      return;
    }
    const tx = await s.transaction();
    try {
      for (const f of filas) {
        await s.query(`UPDATE "${schema}"."clinic_sessions" SET duration = :d WHERE id = :id`, {
          replacements: { d: f.duration ?? null, id: f.id },
          transaction: tx,
        });
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
    out(`✓ ${filas.length} sesiones restauradas.\n`);
    await s.close();
    return;
  }

  // ── Qué hay ──────────────────────────────────────────────────────────────
  // El `IS NOT DISTINCT FROM` y no `=`: con nulos, `=` devuelve NULL y la fila se
  // cae sola de la lista sin que nadie lo vea. Aquí una sesión sin paciente y una
  // cita sin paciente NO son «el mismo paciente», y tienen que salir en el
  // recuento de descartadas, no desaparecer.
  const [candidatas] = await s.query(
    `SELECT s.id, s.duration AS antes, b.duration AS de_la_cita,
            (s.patient_id IS NOT DISTINCT FROM b.patient_id AND s.patient_id IS NOT NULL) AS mismo_paciente
       FROM "${schema}"."clinic_sessions" s
       JOIN "${schema}"."bookings" b ON b.id = s.booking_id
      WHERE s.duration IS NULL`
  );

  const aEscribir = [];
  const descartadas = new Map();
  for (const c of candidatas) {
    if (!c.mismo_paciente) {
      descartadas.set("la cita es de otro paciente (o falta)", (descartadas.get("la cita es de otro paciente (o falta)") ?? 0) + 1);
      continue;
    }
    const min = minutosDeSesion(c.de_la_cita);
    if (min === null) {
      descartadas.set("la cita tampoco dice cuánto duró", (descartadas.get("la cita tampoco dice cuánto duró") ?? 0) + 1);
      continue;
    }
    aEscribir.push({ id: c.id, duration: c.antes ?? null, nueva: min });
  }

  const [sinCita] = await s.query(
    `SELECT COUNT(*)::int AS n FROM "${schema}"."clinic_sessions"
      WHERE booking_id IS NULL AND duration IS NULL`
  );

  out(`\n${"═".repeat(66)}`);
  out(` DURACIÓN DESDE LA CITA → "${slug}" (${t.name})`);
  out(`${confirm ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  out(`${"═".repeat(66)}\n`);

  if (!aEscribir.length) {
    out(`Ninguna sesión de «${slug}» puede heredar la duración de su cita. Nada que hacer.\n`);
    if (descartadas.size) for (const [k, v] of descartadas) out(`  (descartadas ${v}: ${k})`);
    await s.close();
    return;
  }

  const porMinutos = new Map();
  for (const f of aEscribir) porMinutos.set(f.nueva, (porMinutos.get(f.nueva) ?? 0) + 1);
  out("Sesiones que pasan de «— min» a la duración de SU cita:\n");
  for (const [min, n] of [...porMinutos].sort((a, b) => b[1] - a[1])) {
    out(`  ${String(n).padStart(5)} sesiones  →  ${String(min).padStart(3)} min`);
  }
  if (descartadas.size) {
    out("");
    for (const [k, v] of descartadas) out(`  Descartadas ${v}: ${k}`);
  }
  out(`\n  No se tocan: ${sinCita[0].n} sesiones sin cita (no hay de dónde sacarlo).\n`);

  const fichero = join(tmpdir(), `duracion-desde-cita-${slug}.json`);
  if (!confirm) {
    out(`${"═".repeat(66)}`);
    out(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    out(`${"═".repeat(66)}\n`);
    await s.close();
    return;
  }

  writeFileSync(
    fichero,
    JSON.stringify({ slug, fecha: new Date().toISOString(), filas: aEscribir.map(({ id, duration }) => ({ id, duration })) }, null, 2),
    "utf8"
  );

  // Se agrupa por minutos para que sean dos UPDATE y no 508: el valor nuevo es
  // el mismo dentro de cada grupo.
  const tx = await s.transaction();
  try {
    for (const [min] of porMinutos) {
      const ids = aEscribir.filter((f) => f.nueva === min).map((f) => f.id);
      for (let i = 0; i < ids.length; i += LOTE) {
        await s.query(`UPDATE "${schema}"."clinic_sessions" SET duration = :min WHERE id IN (:ids)`, {
          replacements: { min, ids: ids.slice(i, i + LOTE) },
          transaction: tx,
        });
      }
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  out(`✓ ${aEscribir.length} sesiones con la duración de su cita.`);
  out(`· Para deshacerlo: --deshacer ${fichero} --confirm  (${aEscribir.length} filas con su valor anterior)\n`);
  await s.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
