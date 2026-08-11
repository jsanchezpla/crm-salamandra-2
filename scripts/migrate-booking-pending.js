/**
 * migrate-booking-pending.js
 *
 * Sprint Fase 1 nutri_laura — Lista de espera de bookings.
 *
 * Cambios:
 *   1) Amplía enum_bookings_status con el valor 'pending' en todos los
 *      tenants con módulo `citas` habilitado.
 *   2) Setea featureFlag `autoConfirmPublicBookings = false` en el módulo
 *      `citas` del tenant `nutri_laura`. Cualquier otro tenant queda con
 *      el flag ausente → comportamiento por defecto = auto-confirm (true).
 *
 * Estrategia (mismo patrón que migrate-training-archive.js):
 *   - Fase A en autocommit: ALTER TYPE ADD VALUE (Postgres NO permite ADD
 *     VALUE dentro de transacción del mismo tipo que se está usando).
 *   - Fase B en transacción global: UPDATE feature_flags.
 *   - Idempotente: ADD VALUE IF NOT EXISTS + UPDATE con merge JSONB.
 *
 * Uso:
 *   npm run db:migrate:booking-pending       (local)
 *   npm run db:migrate:booking-pending:prod  (producción)
 */

import { Sequelize } from "sequelize";
import { byTable } from "./_schema-targets.js";
import { acotarSlugs } from "./_solo-este-tenant.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ─── Helpers ────────────────────────────────────────────────────────────────

async function tableExists(s, t, schema, table) {
  const [rows] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    { bind: [schema, table], transaction: t }
  );
  return rows.length > 0;
}

async function enumHasValue(s, schema, enumName, value) {
  const [rows] = await s.query(
    `
    SELECT 1
    FROM pg_type tp
    JOIN pg_namespace n ON n.oid = tp.typnamespace
    JOIN pg_enum e ON e.enumtypid = tp.oid
    WHERE tp.typname = $1 AND n.nspname = $2 AND e.enumlabel = $3
    `,
    { bind: [enumName, schema, value] }
  );
  return rows.length > 0;
}

// ─── Fase A: ALTER TYPE ADD VALUE en autocommit ─────────────────────────────

async function addPendingToEnumAutocommit(s, schema) {
  // Solo procesa schemas con tabla `bookings` (módulo citas instalado).
  if (!(await tableExists(s, null, schema, "bookings"))) {
    log(`· ${schema}: sin tabla bookings (módulo citas no instalado), salto`);
    return false;
  }

  if (await enumHasValue(s, schema, "enum_bookings_status", "pending")) {
    log(`· ${schema} enum_bookings_status.pending: ya existe`);
    return true;
  }

  await s.query(
    `ALTER TYPE "${schema}"."enum_bookings_status" ADD VALUE IF NOT EXISTS 'pending'`
  );
  log(`✓ ${schema} enum_bookings_status: añadido valor 'pending'`);
  return true;
}

// ─── Fase B: feature flag autoConfirmPublicBookings=false en nutri_laura ────

async function setNutriLauraFlagInTx(s, t) {
  // El flag vive en master.tenant_modules.feature_flags (JSONB) del módulo
  // citas, scopeado al tenant nutri_laura.
  const [rows] = await s.query(
    `
    SELECT tm.id, tm.feature_flags
    FROM master.tenant_modules tm
    JOIN master.tenants t ON t.id = tm.tenant_id
    WHERE t.slug = 'nutri_laura' AND tm.module_key = 'citas'
    `,
    { transaction: t }
  );

  if (rows.length === 0) {
    log("· nutri_laura no tiene módulo citas registrado en master.tenant_modules — salto");
    return false;
  }

  const current = rows[0].feature_flags ?? {};
  const merged = { ...current, autoConfirmPublicBookings: false };

  await s.query(
    `UPDATE master.tenant_modules SET feature_flags = $1, updated_at = now() WHERE id = $2`,
    { bind: [JSON.stringify(merged), rows[0].id], transaction: t }
  );
  log("✓ nutri_laura.citas.featureFlags.autoConfirmPublicBookings = false");
  return true;
}

// ─── Main ───────────────────────────────────────────────────────────────────

// Fase A se decide por EXISTENCIA de la tabla `bookings`, no por módulo activo:
// si el schema tiene la tabla, su enum debe aceptar 'pending' aunque el tenant
// todavía no haya comprado Citas (ver scripts/_schema-targets.js y el incidente
// del 2026-07-21). La Fase B sigue siendo un flag puntual de nutri_laura.

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: booking 'pending' + flag nutri_laura     \n");
  process.stdout.write("══════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });

  try {
    header("Obteniendo schemas con tabla `bookings`...");
    const { schemas, skipped } = await byTable(sequelize, "bookings");
    if (schemas.length === 0) {
      log("· Ningún schema tiene tabla bookings.");
    } else {
      log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
      if (skipped.length) log(`· sin tabla bookings, se omiten: ${skipped.join(", ")}`);

      header("Fase A — ALTER TYPE ADD VALUE 'pending' (autocommit)...");
      for (const schema of schemas) {
        await addPendingToEnumAutocommit(sequelize, schema);
      }
    }

    /*
     * ⚠️ LA FASE B TOCA A UN CLIENTE CONCRETO, ASÍ QUE HAY QUE ACOTARLA (11/08/2026).
     *
     * La Fase A ya iba acotada, porque `byTable` respeta ONLY_SCHEMAS. La B no:
     * escribía en `master.tenant_modules` de `nutri_laura` con el slug a mano,
     * corriera quien corriera. Como el alta dispara esta migración, dar de alta
     * a CUALQUIER cliente reescribía la configuración de Laura.
     *
     * Se vio en la prueba de huella del 11/08: el alta de un cliente de prueba
     * dejó su fila con `updated_at` trece segundos después de empezar. El valor
     * no cambió —la migración fuerza `false` y ya estaba en `false`—, pero el
     * efecto de verdad es peor que un UPDATE de más: ese interruptor era
     * IMPOSIBLE DE ENCENDER. Si Laura activaba la autoconfirmación de reservas
     * públicas, la siguiente alta de cualquier otro cliente se la apagaba, sin
     * avisar y sin dejar rastro en la auditoría.
     *
     * El recuento de filas no lo habría visto nunca: un UPDATE no cambia
     * cuántas hay. Salió mirando el `xmin` de cada fila.
     */
    if (acotarSlugs(["nutri_laura"]).length === 0) {
      header("Fase B — omitida: el alcance pedido no incluye a nutri_laura");
    } else {
      header("Fase B — feature flag autoConfirmPublicBookings (transacción)...");
      await sequelize.transaction(async (t) => {
        await setNutriLauraFlagInTx(sequelize, t);
      });
    }

    process.stdout.write("\n══════════════════════════════════════════════════════\n");
    process.stdout.write(" ✓ Migración completada                              \n");
    process.stdout.write("══════════════════════════════════════════════════════\n");
    process.stdout.write(" ℹ Otros tenants conservan auto-confirm por defecto.\n");
    process.stdout.write("══════════════════════════════════════════════════════\n\n");

    await sequelize.close();
    process.exit(0);
  } catch (err) {
    await sequelize.close();
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
