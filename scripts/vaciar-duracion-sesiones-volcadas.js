/**
 * vaciar-duracion-sesiones-volcadas.js — quitarle a las sesiones importadas de
 * Organízate una duración que nadie midió (18/09/2026, Aumenta por Jorge).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── EL AVISO ────────────────────────────────────────────────────────────────
 * Olga: «aparece duración 45 min en la ficha de paciente cuando la mayoría de
 * sus sesiones son de 60 min». No era un default del CRM, ni la duración del
 * tipo de cita, ni la última cita: `scripts/_hechos/import-aumenta-sesiones.js`
 * escribió `duration: 45` A FUEGO en cada fila que trajo, porque Organízate no
 * guarda cuánto duró una sesión. Medido en producción el 18/09/2026:
 *
 *   · 22.996 sesiones a 45 min — TODAS con `observations->>'origen' =
 *     'organizate'`, ninguna posterior al 31/07/2026, y **ninguna otra sesión
 *     del centro dice 45**: el marcador y el número casan fila a fila;
 *   ·    695 a null y 71 con su duración de verdad (60 y 90), ya del CRM.
 *
 * O sea: un relleno constante presentado como medida. Y no se quedaba en la
 * pantalla —la ficha del paciente y el PDF del registro (`sessionPdf.js`), que
 * sale del centro, lo imprimían como «45 minutos»—, así que el CRM afirmaba
 * por escrito algo que nadie apuntó. Vaciarlo no pierde información: no la
 * había. La ficha pasa a decir «— min» y el PDF se salta la línea.
 *
 * ── QUÉ TOCA Y QUÉ NO ───────────────────────────────────────────────────────
 * SOLO las filas con `observations->>'origen' = 'organizate'` Y `duration` no
 * nula. Una sesión importada a la que alguien le haya puesto después una
 * duración de verdad NO se distingue de las demás por el marcador… pero es que
 * hasta hoy no se podía: el registro no tenía campo de duración en ninguna
 * pantalla (por eso se añade en la misma entrega). Aun así, el `--deshacer`
 * guarda id y valor anterior de cada fila tocada, no un «eran todas 45».
 *
 * Nada del texto clínico se toca. Ni objetivos, ni actividades, ni
 * observaciones, ni el original de Organízate que el volcado dejó dentro.
 *
 * ── POR QUÉ NO ES UNA MIGRACIÓN (regla 12) ──────────────────────────────────
 * Porque no cambia la FORMA del schema: cambia datos. Como todo backfill mira
 * el `status` del tenant —en un cliente apagado no se escribe— y recibe el slug
 * por argumento en vez de llevarlo escrito. Es inocuo en cualquier otro
 * cliente: sin filas con ese marcador, no toca nada y lo dice.
 *
 * Uso local:  node --env-file=.env.local scripts/vaciar-duracion-sesiones-volcadas.js <slug>
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/vaciar-duracion-sesiones-volcadas.js <slug> --confirm
 * Deshacer:   docker exec crm-salamandra-app-1 node scripts/vaciar-duracion-sesiones-volcadas.js <slug> --deshacer /tmp/duracion-sesiones-<slug>.json
 */

import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Sequelize } from "sequelize";

const MARCADOR = "organizate";
const LOTE = 500;

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
      "\nUso: node scripts/vaciar-duracion-sesiones-volcadas.js <slug> [--confirm]\n" +
        "     node scripts/vaciar-duracion-sesiones-volcadas.js <slug> --deshacer <fichero.json>\n\n"
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

  // ── Deshacer: devolver a cada id su duración de antes ────────────────────
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
          replacements: { d: f.duration, id: f.id },
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
  const [afectadas] = await s.query(
    `SELECT id, duration FROM "${schema}"."clinic_sessions"
      WHERE observations->>'origen' = :marca AND duration IS NOT NULL`,
    { replacements: { marca: MARCADOR } }
  );
  const [reparto] = await s.query(
    `SELECT duration, COUNT(*)::int AS n,
            MIN(session_date)::date AS desde, MAX(session_date)::date AS hasta
       FROM "${schema}"."clinic_sessions"
      WHERE observations->>'origen' = :marca AND duration IS NOT NULL
      GROUP BY duration ORDER BY n DESC`,
    { replacements: { marca: MARCADOR } }
  );
  // Lo que NO se toca, para que se vea que el corte es el del volcado y no otro.
  const [fuera] = await s.query(
    `SELECT COUNT(*)::int AS n FROM "${schema}"."clinic_sessions"
      WHERE (observations->>'origen') IS DISTINCT FROM :marca AND duration IS NOT NULL`,
    { replacements: { marca: MARCADOR } }
  );

  out(`\n${"═".repeat(66)}`);
  out(` DURACIÓN INVENTADA DEL VOLCADO → "${slug}" (${t.name})`);
  out(`${confirm ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  out(`${"═".repeat(66)}\n`);

  if (!afectadas.length) {
    out(`Ninguna sesión de «${slug}» trae duración del volcado de Organízate. Nada que hacer.\n`);
    await s.close();
    return;
  }

  out("Se vacía la duración de estas (todas del volcado, marcador «origen: organizate»):\n");
  for (const r of reparto) {
    out(`  ${String(r.n).padStart(6)} sesiones a ${String(r.duration).padStart(3)} min   ${r.desde} → ${r.hasta}`);
  }
  out(`\n  Se quedan como están: ${fuera[0].n} sesiones con duración escrita en el CRM.\n`);

  const fichero = join(tmpdir(), `duracion-sesiones-${slug}.json`);
  if (!confirm) {
    out(`${"═".repeat(66)}`);
    out(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    out(`${"═".repeat(66)}\n`);
    await s.close();
    return;
  }

  // El antes, ANTES de escribir: si el UPDATE va bien y el disco no, mejor
  // haberlo intentado en este orden.
  writeFileSync(fichero, JSON.stringify({ slug, fecha: new Date().toISOString(), filas: afectadas }, null, 2), "utf8");

  const tx = await s.transaction();
  try {
    for (let i = 0; i < afectadas.length; i += LOTE) {
      const ids = afectadas.slice(i, i + LOTE).map((f) => f.id);
      await s.query(`UPDATE "${schema}"."clinic_sessions" SET duration = NULL WHERE id IN (:ids)`, {
        replacements: { ids },
        transaction: tx,
      });
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  out(`✓ ${afectadas.length} sesiones sin duración inventada. La ficha dirá «— min».`);
  out(`· Para deshacerlo: --deshacer ${fichero} --confirm  (${afectadas.length} filas con su valor anterior)\n`);
  await s.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
