/**
 * limpiar-importacion-aumenta.js — deshace la importación de Organízate.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no borra nada.
 *
 * ── Para qué ───────────────────────────────────────────────────────────────
 *
 * Los importadores son idempotentes: repetirlos no duplica. Lo que NO hacen es
 * corregir lo ya escrito —si una fila entró mal, ahí se queda—. Cuando el fallo
 * está en el importador y no en un dato suelto, lo limpio es tirar lo importado
 * y volver a empezar, que además ensaya exactamente lo que va a pasar en
 * producción.
 *
 * ── El cerrojo ─────────────────────────────────────────────────────────────
 *
 * Antes de borrar nada comprueba que TODOS los clientes del tenant llevan la
 * marca `customFields.origen = "organizate"`. Si aparece uno solo dado de alta
 * a mano, se planta y no borra nada: eso significa que alguien ya está
 * trabajando ahí y esto dejaría de ser «deshacer una importación» para ser
 * «borrarle los clientes a un centro». No hay bandera para saltárselo.
 *
 * Equipo, leads, series de facturación y ajustes del tenant NO se tocan: no
 * salieron de Organízate.
 *
 * Uso:
 *   node --env-file=.env.local scripts/limpiar-importacion-aumenta.js
 *   node --env-file=.env.local scripts/limpiar-importacion-aumenta.js --confirm
 */

import { getTenantDb } from "../../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";

/**
 * En este orden. No es alfabético: `cash_closes` va antes que `cash_points`
 * porque su clave ajena es RESTRICT y al revés Postgres se niega.
 */
const TABLAS = [
  "clinic_sessions",
  // Las actas de coordinación y la agenda de contactos externos que salen de
  // ellas. Van explícitas aunque `external_contacts` caería sola con los
  // pacientes: `coordinations` NO, su clave ajena es SET NULL y las dejaría
  // vivas apuntando a un paciente que ya no existe.
  "coordinations",
  "external_contacts",
  "taller_inscripciones",
  "talleres",
  "bookings",
  "event_types",
  "invoices",
  "costs",
  "cash_closes",
  "cash_points",
  "suppliers",
  "patients",
  "clients",
];

async function main() {
  const esquema = `crm_${SLUG}`;
  console.log(`\n${"═".repeat(62)}`);
  console.log(` LIMPIAR LA IMPORTACIÓN → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a borrar" : " · SIMULACIÓN: no se borra nada"}`);
  console.log(`${"═".repeat(62)}\n`);

  const { sequelize } = getTenantDb(SLUG);
  const uno = async (sql) => (await sequelize.query(sql))[0][0];

  // ── El cerrojo ──────────────────────────────────────────────────────────
  const { total, ajenos } = await uno(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE coalesce(custom_fields->>'origen','') <> 'organizate')::int AS ajenos
    FROM ${esquema}.clients
  `);
  if (Number(ajenos) > 0) {
    console.log(`⛔ ${ajenos} de los ${total} clientes NO vienen de Organízate.`);
    console.log("   Este tenant ya tiene trabajo hecho a mano. No se borra nada.\n");
    process.exit(1);
  }
  console.log(`Cerrojo: los ${total} clientes vienen de la importación. Se puede seguir.\n`);

  let totalFilas = 0;
  for (const t of TABLAS) {
    const { n } = await uno(`SELECT count(*)::int AS n FROM ${esquema}."${t}"`);
    totalFilas += Number(n);
    console.log(`  ${String(n).padStart(7)}  ${t}`);
  }
  console.log(`\n  ${String(totalFilas).padStart(7)}  filas en total\n`);

  if (!CONFIRM) {
    console.log(`${"═".repeat(62)}`);
    console.log(" SIMULACIÓN: no se ha borrado nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(62)}\n`);
    process.exit(0);
  }

  console.log("⚠️  Borrando…\n");
  await sequelize.transaction(async (tx) => {
    for (const t of TABLAS) {
      await sequelize.query(`DELETE FROM ${esquema}."${t}"`, { transaction: tx });
    }
  });

  const { n } = await uno(`SELECT count(*)::int AS n FROM ${esquema}.clients`);
  console.log(`Listo. Quedan ${n} clientes.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✖ Error:", e.message);
  process.exit(1);
});
