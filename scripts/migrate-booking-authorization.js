/**
 * migrate-booking-authorization.js
 *
 * Sprint "cobrar al confirmar" (nutri_laura) — el hueco en la base de datos para
 * un estado que hasta ahora no existía: DINERO RETENIDO PERO NO COBRADO.
 *
 * El flujo viejo era: el paciente paga y la cita se confirma sola. El nuevo es:
 * el paciente deja la tarjeta (se AUTORIZA el importe, sin cobrarlo), la cita
 * entra en la lista de espera, y el dinero se CAPTURA cuando la profesional
 * confirma. Entre esos dos momentos hay dinero apartado en la tarjeta de una
 * persona, y no había ni un estado ni una fecha donde anotarlo.
 *
 * ── POR QUÉ VALORES NUEVOS Y NO REUTILIZAR 'pending' ─────────────────────────
 * `paymentStatus='pending'` ya significa otra cosa muy concreta: CARRITO
 * ABANDONADO en potencia. `noEsCarritoAbandonado` (lib/citas/booking.js) esconde
 * las citas 'pending' + hold vencido, y `retirarCitaImpagada` las cancela. Si
 * "tarjeta retenida esperando a la profesional" reutilizara ese valor, el
 * sistema borraría solicitudes legítimas por su cuenta a los 45 minutos.
 *
 * Los cuatro valores nuevos de `bookings.payment_status`:
 *   · authorizing → el paciente está metiendo la tarjeta ahora mismo
 *   · authorized  → retenido y esperando decisión. EL ESTADO NUEVO DE VERDAD
 *   · capturing   → captura en vuelo (evita cobrar dos veces si se pulsa dos veces)
 *   · void        → autorización liberada (rechazo o cancelación antes de cobrar)
 *
 * ── authorization_expires_at ─────────────────────────────────────────────────
 * Una autorización CADUCA, y al caducar el PaymentIntent muere: no se puede
 * capturar, hay que autorizar de cero. El plazo NO se calcula aquí: se guarda
 * tal cual el `capture_before` que devuelve Stripe en el charge. Calcularlo por
 * nuestra cuenta ("created + 7 días") es exactamente cómo se pierden
 * autorizaciones, porque el plazo real depende de la red de la tarjeta y del
 * tipo de operación.
 *
 * Va en las DOS tablas a propósito: `payment_sessions` es la verdad del pago
 * (capa genérica, sirve a pedidos y facturas), y la copia en `bookings` es para
 * que la lista de espera y el aviso de caducidad puedan filtrar y ordenar sin
 * join, igual que ya se hace con `amount`.
 *
 * `stripe_customer_id` se añade VACÍO y sin usar: es el hueco para el plan B
 * (guardar la tarjeta y reintentar si una retención caduca). Se deja puesto
 * ahora para no tener que volver a migrar todos los tenants más adelante.
 *
 * Estrategia (mismo patrón que migrate-booking-pending.js):
 *   - Fase A en autocommit: ALTER TYPE ADD VALUE (Postgres no deja usar el valor
 *     nuevo en la misma transacción que lo crea).
 *   - Fase B en transacción: ADD COLUMN IF NOT EXISTS.
 *   - Idempotente de principio a fin: se puede relanzar sin miedo.
 *
 * Los schemas se descubren por EXISTENCIA DE LA TABLA (`byTable`), no por módulo
 * activo: si un schema tiene `bookings`, su enum debe aceptar los valores nuevos
 * aunque el tenant todavía no haya comprado Citas (incidente del 2026-07-21).
 *
 * Uso:
 *   npm run db:migrate:booking-auth        (local)
 *   npm run db:migrate:booking-auth:prod   (producción)
 */

import { Sequelize } from "sequelize";
import { byTable, tableExists } from "./_schema-targets.js";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

/** Valores nuevos por enum. El orden importa poco; la idempotencia, mucho. */
const ENUMS = [
  {
    tabla: "bookings",
    enumName: "enum_bookings_payment_status",
    valores: ["authorizing", "authorized", "capturing", "void"],
  },
  {
    tabla: "payment_sessions",
    enumName: "enum_payment_sessions_status",
    valores: ["authorizing", "authorized", "void"],
  },
];

/** Columnas nuevas, todas nullable y sin default: puramente aditivo. */
const COLUMNAS = [
  { tabla: "bookings", columna: "authorization_expires_at", tipo: "TIMESTAMP WITH TIME ZONE" },
  { tabla: "payment_sessions", columna: "authorization_expires_at", tipo: "TIMESTAMP WITH TIME ZONE" },
  { tabla: "payment_sessions", columna: "stripe_customer_id", tipo: "VARCHAR(255)" },
];

async function enumHasValue(s, schema, enumName, value) {
  const [rows] = await s.query(
    `
    SELECT 1
    FROM pg_type tp
    JOIN pg_namespace n ON n.oid = tp.typnamespace
    JOIN pg_enum e ON e.enumtypid = tp.oid
    WHERE tp.typname = :enumName AND n.nspname = :schema AND e.enumlabel = :value
    `,
    { replacements: { enumName, schema, value } }
  );
  return rows.length > 0;
}

async function enumExists(s, schema, enumName) {
  const [rows] = await s.query(
    `
    SELECT 1 FROM pg_type tp
    JOIN pg_namespace n ON n.oid = tp.typnamespace
    WHERE tp.typname = :enumName AND n.nspname = :schema
    `,
    { replacements: { enumName, schema } }
  );
  return rows.length > 0;
}

// ─── Fase A: ALTER TYPE ADD VALUE en autocommit ─────────────────────────────

async function ampliarEnum(s, schema, { tabla, enumName, valores }) {
  if (!(await tableExists(s, schema, tabla))) {
    log(`· ${schema}: sin tabla ${tabla}, salto`);
    return;
  }
  if (!(await enumExists(s, schema, enumName))) {
    // Puede pasar en schemas montados a mano o con la columna como texto.
    // No se inventa el tipo: se avisa y se sigue, que es menos dañino que
    // crear un enum que no case con lo que el modelo espera.
    log(`⚠ ${schema}: la tabla ${tabla} existe pero no el tipo ${enumName} — REVISAR A MANO`);
    return;
  }
  for (const valor of valores) {
    if (await enumHasValue(s, schema, enumName, valor)) {
      log(`· ${schema}.${enumName}.${valor}: ya existe`);
      continue;
    }
    await s.query(`ALTER TYPE "${schema}"."${enumName}" ADD VALUE IF NOT EXISTS '${valor}'`);
    log(`✓ ${schema}.${enumName}: añadido '${valor}'`);
  }
}

// ─── Fase B: ADD COLUMN dentro de transacción ───────────────────────────────

async function anadirColumna(s, t, schema, { tabla, columna, tipo }) {
  if (!(await tableExists(s, schema, tabla))) return false;
  await s.query(
    `ALTER TABLE "${schema}"."${tabla}" ADD COLUMN IF NOT EXISTS "${columna}" ${tipo}`,
    { transaction: t }
  );
  log(`✓ ${schema}.${tabla}.${columna}`);
  return true;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════════\n");
  process.stdout.write(" Migración: retención de tarjeta (autorizado sin cobrar)\n");
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
    header("Buscando schemas con tabla `bookings`...");
    const { schemas, skipped } = await byTable(sequelize, "bookings");
    if (schemas.length === 0) {
      log("· Ningún schema tiene tabla bookings. Nada que hacer.");
      await sequelize.close();
      return;
    }
    log(`✓ ${schemas.length}: ${schemas.join(", ")}`);
    if (skipped.length) log(`· sin tabla bookings, se omiten: ${skipped.join(", ")}`);

    header("Fase A — valores nuevos de enum (autocommit)...");
    for (const schema of schemas) {
      for (const e of ENUMS) await ampliarEnum(sequelize, schema, e);
    }

    header("Fase B — columnas nuevas (transacción)...");
    await sequelize.transaction(async (t) => {
      for (const schema of schemas) {
        for (const c of COLUMNAS) await anadirColumna(sequelize, t, schema, c);
      }
    });

    header("Comprobación final...");
    let fallos = 0;
    for (const schema of schemas) {
      for (const e of ENUMS) {
        if (!(await tableExists(sequelize, schema, e.tabla))) continue;
        if (!(await enumExists(sequelize, schema, e.enumName))) continue;
        for (const v of e.valores) {
          if (!(await enumHasValue(sequelize, schema, e.enumName, v))) {
            log(`✗ ${schema}.${e.enumName} sigue SIN '${v}'`);
            fallos++;
          }
        }
      }
    }
    if (fallos > 0) {
      // Parar el deploy: una migración a medias con dinero de por medio deja
      // citas que el código no puede representar.
      process.stderr.write(`\n✗ ${fallos} comprobaciones fallidas. NO desplegar.\n\n`);
      await sequelize.close();
      process.exit(1);
    }
    log("✓ todo en su sitio");

    process.stdout.write("\n✓ Migración completada\n\n");
    await sequelize.close();
  } catch (err) {
    process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
    await sequelize.close();
    process.exit(1);
  }
}

main();
