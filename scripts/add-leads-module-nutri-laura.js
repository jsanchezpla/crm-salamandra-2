/**
 * add-leads-module-nutri-laura.js
 *
 * Activa el módulo "leads" en el tenant nutri_laura:
 *
 * 1. Crea la tabla `leads` en `crm_nutri_laura` (Lead.sync alter,
 *    sin tocar el resto de modelos: el tenant arrancó solo con
 *    citas y queremos mantenerlo minimal).
 * 2. Registra el módulo `leads` en `master.tenant_modules` con
 *    `uiOverride: nutri-laura/LeadsModule`.
 * 3. Añade "leads" al `moduleAccess` del admin (admin@nutri-laura.es).
 * 4. Siembra 8 leads de ejemplo distribuidos en los 6 stages
 *    nutricionales (new, contacted, consulta_agendada,
 *    consulta_realizada, paciente, lost).
 *
 * Idempotente: re-ejecutar no rompe nada ni genera duplicados.
 *
 * Uso local:  npm run db:add-leads-nutri-laura
 * Uso VPS:    npm run db:add-leads-nutri-laura:prod
 */

import { Sequelize } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const SLUG = "nutri_laura";
const SCHEMA = `crm_${SLUG}`;
const ADMIN_EMAIL = "admin@nutri-laura.es";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

/**
 * Crea la tabla `leads` con SQL crudo, sin FKs físicas a tablas que no
 * existen aún (`clients`, `projects`). `Lead.sync()` no sirve aquí porque
 * Sequelize añade FKs por las asociaciones definidas en tenantDb.js
 * (Client.hasMany(Lead), Project.hasMany(Lead, { foreignKey: "convertedProjectId" })).
 * Cuando ese tenant active `clients` o `projects`, se podrán añadir las
 * FKs con un ALTER posterior.
 */
async function createLeadsTableIfNotExist(rawDb, schema) {
  const enumExistsSql = `SELECT 1 FROM pg_type tp
    JOIN pg_namespace n ON n.oid = tp.typnamespace
    WHERE tp.typname = $1 AND n.nspname = $2`;

  const [tipoRows] = await rawDb.query(enumExistsSql, {
    bind: ["enum_leads_tipo_usuario", schema],
  });
  if (tipoRows.length === 0) {
    await rawDb.query(
      `CREATE TYPE "${schema}"."enum_leads_tipo_usuario" AS ENUM ('ciudadano','profesional')`
    );
    log(`  ✓ enum enum_leads_tipo_usuario: creado`);
  } else {
    log(`  · enum enum_leads_tipo_usuario: ya existe`);
  }

  const [motivoRows] = await rawDb.query(enumExistsSql, {
    bind: ["enum_leads_motivo", schema],
  });
  if (motivoRows.length === 0) {
    await rawDb.query(
      `CREATE TYPE "${schema}"."enum_leads_motivo" AS ENUM ('diagnostico','servicios','cursos','talleres')`
    );
    log(`  ✓ enum enum_leads_motivo: creado`);
  } else {
    log(`  · enum enum_leads_motivo: ya existe`);
  }

  await rawDb.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."leads" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID,
      name VARCHAR(255),
      phone VARCHAR(255),
      email VARCHAR(255),
      title VARCHAR(255),
      stage VARCHAR(50) NOT NULL DEFAULT 'new',
      probability INTEGER,
      value DECIMAL(12,2),
      expected_close_date DATE,
      assigned_to UUID,
      notes TEXT,
      tipo_usuario "${schema}"."enum_leads_tipo_usuario" DEFAULT 'ciudadano',
      motivo "${schema}"."enum_leads_motivo",
      servicio VARCHAR(255),
      curso VARCHAR(255),
      taller VARCHAR(255),
      mensaje TEXT,
      custom_fields JSONB DEFAULT '{}'::jsonb,
      source VARCHAR(255),
      metadata JSONB DEFAULT '{}'::jsonb,
      converted_project_id UUID,
      converted_to_project_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await rawDb.query(
    `CREATE INDEX IF NOT EXISTS "leads_stage_idx" ON "${schema}"."leads" (stage)`
  );
  await rawDb.query(
    `CREATE INDEX IF NOT EXISTS "leads_email_idx" ON "${schema}"."leads" (email)`
  );

  log(`  ✓ Tabla leads lista`);
}

// ─── Leads de ejemplo (6 stages nutricionales) ───────────────────────────────

const LEADS_DATA = [
  // ── Nuevo (2) ───────────────────────────────────────────────────────────────
  {
    name: "Marta Gómez Ruiz",
    phone: "611 234 567",
    email: "marta.gomez@gmail.com",
    edad: "34",
    motivo: "Quiero perder unos kilos antes del verano y mantener hábitos saludables a largo plazo.",
    info_adicional: "Intolerancia leve a la lactosa. He probado dietas restrictivas sin éxito.",
    stage: "new",
    daysAgo: 1,
  },
  {
    name: "Diego Martín Sanz",
    phone: "622 345 678",
    email: "diego.martin.s@gmail.com",
    edad: "52",
    motivo: "Mejorar mi energía y reducir la hipertensión sin medicarme más.",
    info_adicional: "Diagnóstico de hipertensión hace 2 años. Tomo enalapril 10 mg.",
    stage: "new",
    daysAgo: 2,
  },

  // ── Contactado (2) ──────────────────────────────────────────────────────────
  {
    name: "Sara Ruiz Blanco",
    phone: "633 456 789",
    email: "sara.ruiz.b@gmail.com",
    edad: "28",
    motivo: "Cambiar mi relación con la comida, comer fuera de casa sin culpa.",
    info_adicional: "Trabajo en consultoría, como mucho en restaurantes y aeropuertos.",
    stage: "contacted",
    daysAgo: 5,
    notes: "Contactada por WhatsApp. Pide info de tarifas. Enviar dossier.",
  },
  {
    name: "Carlos Vega Iglesias",
    phone: "644 567 890",
    email: "carlos.vega.i@hotmail.com",
    edad: "41",
    motivo: "Bajar grasa y ganar masa muscular, complementar mi entreno.",
    info_adicional: "Voy al gimnasio 4 días/semana. No tomo suplementos.",
    stage: "contacted",
    daysAgo: 7,
    notes: "Muy interesado. Pendiente de elegir fecha para primera consulta.",
  },

  // ── Consulta agendada (1) ───────────────────────────────────────────────────
  {
    name: "Ana López Pereira",
    phone: "655 678 901",
    email: "ana.lopez.p@gmail.com",
    edad: "37",
    motivo: "Recuperar mi peso saludable después del embarazo (parto hace 8 meses).",
    info_adicional: "Estoy en lactancia materna. No quiero dieta restrictiva.",
    stage: "consulta_agendada",
    daysAgo: 4,
    notes: "Primera consulta agendada para el próximo viernes a las 10:00.",
  },

  // ── Consulta realizada (1) ──────────────────────────────────────────────────
  {
    name: "Pedro Navarro Cruz",
    phone: "666 789 012",
    email: "pedro.navarro.c@gmail.com",
    edad: "46",
    motivo: "Mejorar mis analíticas (colesterol alto) y bajar 8 kg.",
    info_adicional: "Colesterol total 245, LDL 160. Sin medicación todavía.",
    stage: "consulta_realizada",
    daysAgo: 10,
    notes: "Primera consulta hecha el 17/05. Plan entregado. Decide si sigue tras analítica de control.",
  },

  // ── Paciente activo (1) ─────────────────────────────────────────────────────
  {
    name: "Lucía Fernández Ortiz",
    phone: "677 890 123",
    email: "lucia.fernandez@gmail.com",
    edad: "29",
    motivo: "Hábitos saludables sostenibles, no dieta puntual.",
    info_adicional: "Vegetariana desde hace 3 años. Sin déficit aparente.",
    stage: "paciente",
    daysAgo: 30,
    notes: "Paciente activa desde abril. 3 sesiones de seguimiento. Muy comprometida.",
  },

  // ── Descartado (1) ──────────────────────────────────────────────────────────
  {
    name: "Roberto Sánchez Tejero",
    phone: "688 901 234",
    email: "r.sanchez.t@outlook.com",
    edad: "55",
    motivo: "Información sobre dietas detox.",
    info_adicional: "Buscaba un plan rápido tipo 'detox' de una semana.",
    stage: "lost",
    daysAgo: 15,
    notes: "No encaja con enfoque del centro. Derivado a contenido educativo gratuito.",
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Nutri Laura — Activar módulo Leads     \n");
  process.stdout.write("════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  // ── 1. Verificar tenant ───────────────────────────────────────────────────
  header("Verificando tenant nutri_laura...");
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(
      "\n✗ Tenant nutri_laura no encontrado. Ejecuta `npm run db:seed:nutri-laura` primero.\n"
    );
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  // ── 2. Crear tabla `leads` con SQL crudo ──────────────────────────────────
  // El tenant arrancó solo con módulo citas (3 tablas). Aquí añadimos
  // únicamente la tabla `leads` con SQL directo, sin FKs físicas a las
  // tablas `clients`/`projects` que no existen aún en este tenant.
  // Cuando se activen esos módulos, se podrán añadir las FKs con un ALTER.
  header(`Creando tabla leads en ${SCHEMA}...`);
  const rawDb = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
  });
  await createLeadsTableIfNotExist(rawDb, SCHEMA);
  await rawDb.close();

  // Cargar modelos del tenant para el seed (sin sync)
  const { models } = getTenantDb(SLUG);
  const { Lead } = models;

  // ── 3. Registrar módulo leads ─────────────────────────────────────────────
  header("Registrando módulo leads en master.tenant_modules...");
  const [module, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "leads" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "leads",
      enabled: true,
      version: "1.0.0",
      uiOverride: "nutri-laura/LeadsModule",
      schemaExtensions: {
        edad: { type: "string" },
        motivo: { type: "text" },
        info_adicional: { type: "text" },
        utmSource: { type: "string" },
        utmMedium: { type: "string" },
        utmCampaign: { type: "string" },
      },
      logicOverrides: {},
      featureFlags: {},
    },
  });

  if (!modCreated) {
    await module.update({ enabled: true, uiOverride: "nutri-laura/LeadsModule" });
    log("· Módulo ya existía — actualizado");
  } else {
    log("✓ Módulo leads creado con uiOverride: nutri-laura/LeadsModule");
  }

  // ── 4. moduleAccess del admin ─────────────────────────────────────────────
  header("Actualizando moduleAccess del admin...");
  const admin = await User.findOne({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    process.stderr.write(`\n✗ Usuario ${ADMIN_EMAIL} no encontrado.\n`);
    process.exit(1);
  }
  const currentAccess = admin.moduleAccess ?? [];
  if (!currentAccess.includes("leads")) {
    await admin.update({ moduleAccess: [...currentAccess, "leads"] });
    log(`✓ "leads" añadido a moduleAccess de ${ADMIN_EMAIL}`);
  } else {
    log(`· ${ADMIN_EMAIL} ya tenía acceso a leads`);
  }

  // ── 5. Sembrar leads de ejemplo ───────────────────────────────────────────
  header(`Sembrando ${LEADS_DATA.length} leads de ejemplo...`);
  const now = new Date();
  let created = 0;

  for (const d of LEADS_DATA) {
    const createdAt = new Date(now);
    createdAt.setDate(createdAt.getDate() - d.daysAgo);

    const [, wasCreated] = await Lead.findOrCreate({
      where: { email: d.email },
      defaults: {
        name: d.name,
        phone: d.phone,
        email: d.email,
        title: d.name,
        stage: d.stage,
        notes: d.notes ?? null,
        customFields: {
          edad: d.edad ?? null,
          motivo: d.motivo ?? null,
          info_adicional: d.info_adicional ?? null,
        },
        createdAt,
        updatedAt: createdAt,
      },
    });
    if (wasCreated) created++;
  }
  log(`✓ ${created} leads creados, ${LEADS_DATA.length - created} ya existían`);

  // ── 6. Resumen ────────────────────────────────────────────────────────────
  const byStage = LEADS_DATA.reduce((acc, l) => {
    acc[l.stage] = (acc[l.stage] ?? 0) + 1;
    return acc;
  }, {});

  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo!                                \n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Leads en crm_${SLUG}:    ${LEADS_DATA.length}\n`);
  process.stdout.write(`    Nuevo:                    ${byStage.new ?? 0}\n`);
  process.stdout.write(`    Contactado:               ${byStage.contacted ?? 0}\n`);
  process.stdout.write(`    Consulta agendada:        ${byStage.consulta_agendada ?? 0}\n`);
  process.stdout.write(`    Consulta realizada:       ${byStage.consulta_realizada ?? 0}\n`);
  process.stdout.write(`    Paciente activo:          ${byStage.paciente ?? 0}\n`);
  process.stdout.write(`    Descartado:               ${byStage.lost ?? 0}\n`);
  process.stdout.write(`  Cuenta admin:               ${ADMIN_EMAIL}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
