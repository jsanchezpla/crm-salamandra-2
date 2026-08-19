// @vivo — Alta inicial de un cliente vivo, ya hecha: crea crm_nutri_laura, las 3 tablas de citas por SQL, el tenant y su admin, activa `citas` y siembra 2… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * seed-nutri-laura.js — Inicializa el tenant Nutri Laura
 *
 * 1. Crea schema crm_nutri_laura.
 * 2. Crea las 3 tablas del módulo Citas (event_types, availabilities, bookings)
 *    directamente con SQL (no via sync), porque el tenant arranca con
 *    SOLO módulo citas activo. El resto de tablas del CRM se crearán cuando
 *    se activen otros módulos para este tenant.
 * 3. Crea el tenant en master.tenants y un admin con password aleatoria.
 * 4. Activa el módulo 'citas' en master.tenant_modules.
 * 5. Siembra 2 EventType, 10 bloques de Availability y 4 Bookings.
 *
 * La password se imprime UNA SOLA VEZ en stdout. No se commitea ni se
 * guarda en disco. Jorge la copia a qa-credentials.txt manualmente.
 *
 * Uso local:  npm run db:seed:nutri-laura
 * Uso VPS:    npm run db:seed:nutri-laura:prod
 *
 * Idempotente: re-ejecutar no rompe nada y no genera duplicados (busca por
 * slug/email antes de crear).
 */

import crypto from "node:crypto";
import { Sequelize } from "sequelize";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const SLUG = "nutri_laura";
const SCHEMA = `crm_${SLUG}`;
const USER_EMAIL = "admin@nutri-laura.es";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

function nextWeekDate(daysFromNow, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function createCitasTablesIfNotExist(rawDb, schema) {
  // ENUMs (autocommit)
  const enumExistsSql = `SELECT 1 FROM pg_type tp
    JOIN pg_namespace n ON n.oid = tp.typnamespace
    WHERE tp.typname = $1 AND n.nspname = $2`;

  const [modalityRows] = await rawDb.query(enumExistsSql, { bind: ["enum_bookings_modality", schema] });
  if (modalityRows.length === 0) {
    await rawDb.query(`CREATE TYPE "${schema}"."enum_bookings_modality" AS ENUM ('presencial','phone','online')`);
    log(`  ✓ enum enum_bookings_modality: creado`);
  } else { log(`  · enum enum_bookings_modality: ya existe`); }

  const [statusRows] = await rawDb.query(enumExistsSql, { bind: ["enum_bookings_status", schema] });
  if (statusRows.length === 0) {
    await rawDb.query(`CREATE TYPE "${schema}"."enum_bookings_status" AS ENUM ('confirmed','completed','cancelled','no_show')`);
    log(`  ✓ enum enum_bookings_status: creado`);
  } else { log(`  · enum enum_bookings_status: ya existe`); }

  // Tablas (transacción)
  await rawDb.transaction(async (t) => {
    await rawDb.query(`
      CREATE TABLE IF NOT EXISTS "${schema}"."event_types" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        slug VARCHAR(255) NOT NULL,
        duration INTEGER NOT NULL,
        buffer_before INTEGER NOT NULL DEFAULT 0,
        buffer_after INTEGER NOT NULL DEFAULT 0,
        color VARCHAR(7),
        modalities JSONB NOT NULL DEFAULT '["online"]'::jsonb,
        location VARCHAR(255),
        phone_number VARCHAR(255),
        meet_url VARCHAR(255),
        additional_data_label VARCHAR(255),
        additional_data_required BOOLEAN NOT NULL DEFAULT FALSE,
        min_notice_hours INTEGER NOT NULL DEFAULT 24,
        max_advance_days INTEGER NOT NULL DEFAULT 60,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        "order" INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });

    await rawDb.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "event_types_slug_unique" ON "${schema}"."event_types" (slug)`,
      { transaction: t }
    );
    await rawDb.query(
      `CREATE INDEX IF NOT EXISTS "event_types_active_order_idx" ON "${schema}"."event_types" (active, "order")`,
      { transaction: t }
    );

    await rawDb.query(`
      CREATE TABLE IF NOT EXISTS "${schema}"."availabilities" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type_id UUID REFERENCES "${schema}"."event_types"(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });

    await rawDb.query(
      `CREATE INDEX IF NOT EXISTS "availabilities_event_type_day_idx" ON "${schema}"."availabilities" (event_type_id, day_of_week)`,
      { transaction: t }
    );

    await rawDb.query(`
      CREATE TABLE IF NOT EXISTS "${schema}"."bookings" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type_id UUID NOT NULL REFERENCES "${schema}"."event_types"(id) ON DELETE RESTRICT,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255) NOT NULL,
        client_phone VARCHAR(255) NOT NULL,
        additional_data TEXT,
        scheduled_at TIMESTAMPTZ NOT NULL,
        duration INTEGER NOT NULL,
        modality "${schema}"."enum_bookings_modality" NOT NULL,
        meet_url VARCHAR(255),
        status "${schema}"."enum_bookings_status" NOT NULL DEFAULT 'confirmed',
        cancellation_token UUID NOT NULL DEFAULT gen_random_uuid(),
        cancelled_at TIMESTAMPTZ,
        cancellation_reason TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `, { transaction: t });

    await rawDb.query(
      `CREATE INDEX IF NOT EXISTS "bookings_scheduled_status_idx" ON "${schema}"."bookings" (scheduled_at, status)`,
      { transaction: t }
    );
    await rawDb.query(
      `CREATE INDEX IF NOT EXISTS "bookings_client_email_idx" ON "${schema}"."bookings" (client_email)`,
      { transaction: t }
    );
  });

  log(`  ✓ Tablas event_types/availabilities/bookings listas`);
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write("      Nutri Laura — Seed inicial            \n");
  process.stdout.write("════════════════════════════════════════════\n");

  // ── 1. Crear schema ────────────────────────────────────────────────────
  header("Creando schema PostgreSQL...");
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  log(`✓ Schema "${SCHEMA}" listo`);

  // ── 2. Tablas del módulo citas ─────────────────────────────────────────
  header(`Creando tablas del módulo citas en ${SCHEMA}...`);
  await createCitasTablesIfNotExist(rawDb, SCHEMA);
  await rawDb.close();

  // ── 3. Master + Tenant ─────────────────────────────────────────────────
  header("Sincronizando master y creando tenant...");
  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  const [tenant, tenantCreated] = await Tenant.findOrCreate({
    where: { slug: SLUG },
    defaults: {
      name: "Nutri Laura",
      slug: SLUG,
      dbName: "salamandra",
      plan: "starter",
      status: "active",
      settings: {
        brand: {
          primaryColor: "#A97873",
          secondaryColor: "#6E5A52",
          accentColor: "#F7F1EB",
          inkColor: "#A97873",
          cardColor: "#FFFDFC",
          logoUrl: null,
        },
      },
    },
  });
  log(`${tenantCreated ? "✓ Creado" : "· Ya existía"} tenant "${SLUG}" (id: ${tenant.id})`);

  // ── 4. Usuario admin con password aleatoria ────────────────────────────
  header("Creando usuario administrador...");
  const rawPassword = crypto.randomBytes(9).toString("base64").slice(0, 12);
  const passwordHash = await bcrypt.hash(rawPassword, 12);

  const [adminUser, userCreated] = await User.findOrCreate({
    where: { email: USER_EMAIL },
    defaults: {
      email: USER_EMAIL,
      passwordHash,
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: ["citas"],
    },
  });

  if (!userCreated) {
    log(`· Ya existía usuario "${USER_EMAIL}" — password no modificada`);
  } else {
    log(`✓ Creado usuario "${USER_EMAIL}" (id: ${adminUser.id})`);
  }

  // ── 5. Módulo citas ────────────────────────────────────────────────────
  header('Activando módulo "citas"...');
  const [, citasCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "citas" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "citas",
      enabled: true,
      version: "1.0.0",
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: {},
    },
  });
  log(`${citasCreated ? "✓ Activado" : "· Ya activo"} módulo "citas"`);

  // ── 6. Modelos del tenant (cargar sin sync) ────────────────────────────
  const { models } = getTenantDb(SLUG);
  const { EventType, Availability, Booking } = models;

  // ── 7. EventTypes ──────────────────────────────────────────────────────
  header("Sembrando EventTypes...");
  const [primera] = await EventType.findOrCreate({
    where: { slug: "primera-consulta" },
    defaults: {
      name: "Primera consulta",
      description: "Valoración inicial completa: anamnesis, composición corporal y plan personalizado.",
      slug: "primera-consulta",
      duration: 60,
      bufferBefore: 0,
      bufferAfter: 15,
      color: "#A97873",
      modalities: ["online", "presencial"],
      location: "C/ Salud 12, 2º A, Madrid",
      meetUrl: "https://meet.google.com/nutri-laura-primera",
      additionalDataLabel: "¿Has seguido alguna dieta antes? ¿Tienes intolerancias o alergias?",
      additionalDataRequired: false,
      minNoticeHours: 3,
      maxAdvanceDays: 60,
      active: true,
      order: 1,
    },
  });
  log(`· EventType "Primera consulta" listo`);

  const [seguimiento] = await EventType.findOrCreate({
    where: { slug: "seguimiento" },
    defaults: {
      name: "Seguimiento",
      description: "Revisión de evolución y ajuste del plan.",
      slug: "seguimiento",
      duration: 30,
      bufferBefore: 0,
      bufferAfter: 10,
      color: "#C89C97",
      modalities: ["online", "presencial", "phone"],
      location: "C/ Salud 12, 2º A, Madrid",
      phoneNumber: "+34 600 123 456",
      meetUrl: "https://meet.google.com/nutri-laura-seguimiento",
      additionalDataLabel: "¿Algo concreto que quieras revisar en esta sesión?",
      additionalDataRequired: false,
      minNoticeHours: 3,
      maxAdvanceDays: 30,
      active: true,
      order: 2,
    },
  });
  log(`· EventType "Seguimiento" listo`);

  // ── 8. Availability (lunes-viernes 9-14 + 16-18, eventTypeId=null) ─────
  header("Sembrando disponibilidad semanal...");
  const slots = [];
  for (const day of [1, 2, 3, 4, 5]) {
    slots.push({ eventTypeId: null, dayOfWeek: day, startTime: "09:00:00", endTime: "14:00:00" });
    slots.push({ eventTypeId: null, dayOfWeek: day, startTime: "16:00:00", endTime: "18:00:00" });
  }
  let availCreated = 0;
  for (const slot of slots) {
    const [, created] = await Availability.findOrCreate({
      where: {
        eventTypeId: slot.eventTypeId,
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
      },
      defaults: slot,
    });
    if (created) availCreated++;
  }
  log(`✓ Availability: ${availCreated} bloques creados, ${slots.length - availCreated} ya existían`);

  // ── 9. Bookings de ejemplo ─────────────────────────────────────────────
  header("Sembrando bookings de ejemplo...");
  const bookings = [
    {
      eventTypeId: primera.id,
      clientName: "Marta Gómez",
      clientEmail: "marta.gomez@example.com",
      clientPhone: "+34 611 222 333",
      additionalData: "Quiero perder unos kilos antes del verano. Intolerancia leve a la lactosa.",
      scheduledAt: nextWeekDate(2, 10, 0),
      duration: 60,
      modality: "online",
      meetUrl: "https://meet.google.com/nutri-laura-primera",
      status: "confirmed",
      notes: "Cliente referida por Ana López.",
    },
    {
      eventTypeId: seguimiento.id,
      clientName: "Carlos Vega",
      clientEmail: "carlos.vega@example.com",
      clientPhone: "+34 622 333 444",
      additionalData: null,
      scheduledAt: nextWeekDate(3, 12, 30),
      duration: 30,
      modality: "presencial",
      meetUrl: null,
      status: "confirmed",
      notes: null,
    },
    {
      eventTypeId: seguimiento.id,
      clientName: "Sara Ruiz",
      clientEmail: "sara.ruiz@example.com",
      clientPhone: "+34 633 444 555",
      additionalData: "Hablar de comidas fuera de casa.",
      scheduledAt: nextWeekDate(4, 17, 0),
      duration: 30,
      modality: "phone",
      meetUrl: null,
      status: "confirmed",
      notes: null,
    },
    {
      eventTypeId: primera.id,
      clientName: "Diego Martín",
      clientEmail: "diego.martin@example.com",
      clientPhone: "+34 644 555 666",
      additionalData: "Hipertensión, no me funcionan las dietas restrictivas.",
      scheduledAt: nextWeekDate(5, 9, 30),
      duration: 60,
      modality: "presencial",
      meetUrl: null,
      status: "confirmed",
      notes: null,
    },
  ];

  let bookCreated = 0;
  for (const b of bookings) {
    const [, created] = await Booking.findOrCreate({
      where: {
        clientEmail: b.clientEmail,
        scheduledAt: b.scheduledAt,
      },
      defaults: b,
    });
    if (created) bookCreated++;
  }
  log(`✓ Bookings: ${bookCreated} creados, ${bookings.length - bookCreated} ya existían`);

  // ── 10. Resumen + credenciales ─────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════════\n");
  if (userCreated) {
    process.stdout.write(" === CUENTA ADMIN NUTRI LAURA ===\n");
    process.stdout.write(` Email:    ${USER_EMAIL}\n`);
    process.stdout.write(` Password: ${rawPassword}\n`);
    process.stdout.write(` URL:      http://localhost:3000 (local) /\n`);
    process.stdout.write("           https://crm.salamandrasolutions.com (prod)\n");
    process.stdout.write("════════════════════════════════════════════\n");
    process.stdout.write(" Guarda la password ahora; no se volverá a mostrar.\n");
  } else {
    process.stdout.write(" El usuario ya existía: la password NO se ha modificado.\n");
    process.stdout.write(` Email: ${USER_EMAIL}\n`);
    process.stdout.write(" Si necesitas resetearla, usa un script ad-hoc.\n");
  }
  process.stdout.write("════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
