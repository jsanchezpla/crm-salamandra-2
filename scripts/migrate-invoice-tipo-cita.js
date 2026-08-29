/**
 * migrate-invoice-tipo-cita.js
 *
 * Añade a facturación:
 *   - invoices.event_type_id (UUID, nullable) — qué TIPO DE CITA se cobró con
 *     esta factura, para saber cuánto se ha facturado por servicio.
 *
 * ── POR QUÉ (29/08/2026, Rodrigo) ──────────────────────────────────────────
 * «El dinero no se va a saber a través de precios de las citas. Solo se sabe a
 * través de las facturas.» La vista «Ingresos por servicio» de la portada
 * multiplicaba citas × precio del tipo — valor de agenda, no caja — y con los
 * precios vacíos se quedaba muda. Ahora agrupa las facturas del mes por este
 * enlace: lo que se enseña es lo FACTURADO de verdad, servicio a servicio.
 *
 * El enlace es interno y opcional: una factura sin tipo no cuenta en esa
 * gráfica y nada más. Las facturas que ya existen se quedan a NULL a propósito
 * (nadie sabe hoy qué cita cobró una factura de 2025); lo rellena quien crea
 * la factura, empezando por los seeds de las demos.
 *
 *   - La COLUMNA se añade SIEMPRE que exista `invoices` (el modelo la declara
 *     para todos esos tenants → si faltara, 42703 en cada lectura de factura).
 *   - FK a event_types(id) ON DELETE SET NULL SOLO si existe esa tabla en el
 *     schema. Borrar el tipo de cita NO borra la factura: la desenlaza.
 *   - Índice por event_type_id (la portada agrupa por él cada carga).
 *
 * Selecciona schemas por EXISTENCIA de tabla (ver scripts/_schema-targets.js,
 * que incluye las fotos doradas). Aditiva e idempotente. Nombre snake_case =
 * el que generaría sequelize.sync(). Calcada de
 * migrate-documents-incidencia-link.js, que es el mismo caso.
 *
 * ⚠️ VA ANTES DEL DESPLIEGUE: el modelo pasa a declarar `eventTypeId`, y
 * Sequelize pide las columnas por nombre, así que el código nuevo por delante
 * de la columna daría 42703 en cada lectura de factura.
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-invoice-tipo-cita.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-invoice-tipo-cita.js
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function tablaExiste(s, schema, tabla) {
  const [[{ existe }]] = await s.query(
    `SELECT to_regclass('"${schema}"."${tabla}"') IS NOT NULL AS existe`
  );
  return existe;
}

// ¿Se puede referenciar esta tabla con una FK? Las fotos doradas se copian con
// CREATE TABLE AS TABLE, que trae datos pero NI UNA restricción: su event_types
// no tiene clave primaria y la FK reventaría con 42830. Ahí (y solo ahí) la
// columna va sin FK, que a una foto solo-datos tampoco le hace falta.
async function tieneClaveUnica(s, schema, tabla) {
  const [rows] = await s.query(
    `SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('"${schema}"."${tabla}"') AND contype IN ('p', 'u')`
  );
  return rows.length > 0;
}

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: factura → tipo de cita (invoices.event_type_id)\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const { schemas } = await byTable(s, "invoices");
  if (schemas.length === 0) log("· Ningún schema con tabla invoices.");

  for (const schema of schemas) {
    try {
      // La COLUMNA se añade SIEMPRE (el modelo la referencia en todo tenant con
      // invoices). La FK solo si existe event_types en este schema.
      await s.query(`ALTER TABLE "${schema}"."invoices" ADD COLUMN IF NOT EXISTS event_type_id UUID`);
      await s.query(
        `CREATE INDEX IF NOT EXISTS invoices_event_type_idx ON "${schema}"."invoices" (event_type_id)`
      );
      if ((await tablaExiste(s, schema, "event_types")) && (await tieneClaveUnica(s, schema, "event_types"))) {
        await s.query(
          `DO $$ BEGIN
             ALTER TABLE "${schema}"."invoices"
               ADD CONSTRAINT invoices_event_type_id_fkey
               FOREIGN KEY (event_type_id) REFERENCES "${schema}"."event_types"(id) ON DELETE SET NULL;
           EXCEPTION
             WHEN duplicate_object THEN NULL;
             WHEN undefined_table  THEN NULL;
             WHEN undefined_column THEN NULL;
           END $$;`
        );
        log(`✓ ${schema}: invoices.event_type_id + FK a event_types listo`);
      } else {
        log(`✓ ${schema}: invoices.event_type_id listo (event_types sin clave que referenciar — sin FK)`);
      }
    } catch (err) {
      log(`✗ ${schema}: ${err.message} — se salta, sigue con el resto`);
    }
  }

  process.stdout.write("\n ✓ Migración completada\n");
  process.stdout.write("   (las facturas viejas se quedan SIN tipo a propósito:\n");
  process.stdout.write("    el enlace lo pone quien crea la factura, no una adivinanza)\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
