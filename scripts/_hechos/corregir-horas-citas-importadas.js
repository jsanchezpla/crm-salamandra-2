/**
 * corregir-horas-citas-importadas.js — la agenda importada iba 2 horas tarde.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── EL FALLO (encontrado el 26/08/2026, seis días antes del curso) ──────────
 * La importación de la agenda (02/08) corrió en un contenedor en UTC, así que
 * `new Date("2026-09-01T15:45:00")` guardó la hora del RELOJ de Organízate
 * como si fuera UTC. La agenda pinta en hora de Madrid: una sesión de las 15:45
 * salía a las 17:45, TODAS las citas importadas dos horas tarde en verano y una
 * en invierno, con el salto en mitad del curso. Nadie lo había visto porque el
 * curso empieza el 1 de septiembre: ninguna cita migrada se había vivido aún.
 *
 * La pista que lo delató: la distribución de horas «UTC» iba de 10:00 a 20:00
 * — como reloj español de un centro infantil, normal; como UTC de verdad, niños
 * saliendo de terapia a las 22:00 de Madrid.
 *
 * ── EL ARREGLO ──────────────────────────────────────────────────────────────
 * Reinterpretar lo guardado como lo que siempre fue: hora de Madrid.
 *   (scheduled_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Madrid'
 * La doble conversión resuelve el horario de verano FILA A FILA: una cita de
 * enero se desplaza 1 hora y una de septiembre 2, cada una la suya.
 *
 * Solo toca citas importadas (`additional_data LIKE 'Importada de Organízate%'`)
 * y deja la marca «hora corregida» en cada fila: relanzarlo no desplaza dos
 * veces, y quien abra el detalle de la cita ve que se tocó y cuándo.
 *
 * Uso (VPS):
 *   docker exec crm-salamandra-app-1 node scripts/corregir-horas-citas-importadas.js            → simulación
 *   docker exec crm-salamandra-app-1 node scripts/corregir-horas-citas-importadas.js --confirm  → escribe
 */

import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const MARCA = "hora corregida 26/08/2026";

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` HORAS DE LA AGENDA IMPORTADA → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(62)}\n`);

  const { sequelize } = getTenantDb(SLUG);
  const schema = `crm_${SLUG}`;
  const donde = `additional_data LIKE 'Importada de Organízate%' AND additional_data NOT LIKE '%${MARCA}%'`;

  const [antes] = await sequelize.query(`
    SELECT count(*)::int AS n,
           min(scheduled_at) AS primera,
           count(*) FILTER (WHERE extract(hour from (scheduled_at AT TIME ZONE 'Europe/Madrid')) >= 21)::int AS tardisimas
    FROM "${schema}"."bookings" WHERE ${donde}`);
  console.log(`  Pendientes de corregir: ${antes[0].n}`);
  console.log(`  De ellas, pintadas hoy a las 21:00 de Madrid o más tarde: ${antes[0].tardisimas}\n`);

  const [muestra] = await sequelize.query(`
    SELECT to_char(scheduled_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS mal,
           to_char(((scheduled_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS bien
    FROM "${schema}"."bookings" WHERE ${donde} ORDER BY scheduled_at LIMIT 3`);
  for (const m of muestra) console.log(`  se veía ${m.mal}  →  se verá ${m.bien}`);

  if (!CONFIRM) {
    console.log("\n SIMULACIÓN: nada escrito. Con --confirm se ejecuta.\n");
    process.exit(0);
  }

  const [, meta] = await sequelize.query(`
    UPDATE "${schema}"."bookings"
    SET scheduled_at = (scheduled_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Madrid',
        additional_data = additional_data || ' · ${MARCA}'
    WHERE ${donde}`);
  console.log(`\n  ✓ Corregidas ${meta?.rowCount ?? 0} citas.\n`);
  process.exit(0);
}

main().catch((err) => { process.stderr.write(`\n✗ ${err?.stack ?? err}\n`); process.exit(1); });
