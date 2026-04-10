/**
 * seed-aumenta.js — Inicializa el tenant Aumenta
 *
 * 1. Crea schema crm_aumenta
 * 2. Crea el tenant, usuario y módulo de leads con override Aumenta
 * 3. Siembra 40 leads realistas con motivo, tipo_usuario y campos específicos
 *
 * Uso: npm run db:seed:aumenta
 */

import { Sequelize } from "sequelize";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const SLUG = "aumenta";
const SCHEMA = `crm_${SLUG}`;
const USER_EMAIL = "admin@aumenta.es";
const USER_PASSWORD = "Aumta#2026!";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

// ─── Datos de leads realistas para Aumenta ────────────────────────────────────

const LEADS_DATA = [
  // ── Nuevo (16) ──────────────────────────────────────────────────────────────
  {
    name: "Carmen Soler Ibáñez",
    phone: "611 234 901",
    email: "carmen.soler@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "diagnostico",
    mensaje: "Me gustaría saber qué formación me recomendáis para avanzar en mi carrera.",
    stage: "new",
  },
  {
    name: "Roberto Fuentes Méndez",
    phone: "622 345 012",
    email: "r.fuentes.mendez@hotmail.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Mentoría individual",
    stage: "new",
  },
  {
    name: "Lucía Marín Pascual",
    phone: "633 456 123",
    email: "lucia.marin.p@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Liderazgo y comunicación efectiva",
    stage: "new",
  },
  {
    name: "Andrés Castellano Vega",
    phone: "644 567 234",
    email: "andres.castellano@gmail.com",
    tipo_usuario: "profesional",
    motivo: "talleres",
    taller: "Taller de productividad personal",
    stage: "new",
  },
  {
    name: "Mónica Herrero Santana",
    phone: "655 678 345",
    email: "m.herrero.santana@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "diagnostico",
    mensaje: "Quiero hacer un diagnóstico de mis competencias digitales.",
    stage: "new",
  },
  {
    name: "Javier Pizarro Alonso",
    phone: "666 789 456",
    email: "javier.pizarro@outlook.com",
    tipo_usuario: "profesional",
    motivo: "cursos",
    curso: "Marketing digital avanzado",
    stage: "new",
  },
  {
    name: "Natalia Guerrero Ortiz",
    phone: "677 890 567",
    email: "natalia.guerrero@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "talleres",
    taller: "Gestión del estrés laboral",
    stage: "new",
  },
  {
    name: "Daniel Crespo Iglesias",
    phone: "688 901 678",
    email: "d.crespo.iglesias@gmail.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Consultoría de transformación digital",
    stage: "new",
  },
  {
    name: "Pilar Montoya Campos",
    phone: "699 012 789",
    email: "pilar.montoya@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Excel y análisis de datos para no técnicos",
    stage: "new",
  },
  {
    name: "Alberto Lozano Rueda",
    phone: "610 123 890",
    email: "alberto.lozano@gmail.com",
    tipo_usuario: "profesional",
    motivo: "diagnostico",
    mensaje: "Necesito orientación sobre cómo mejorar las habilidades de mi equipo.",
    stage: "new",
  },
  {
    name: "Cristina Baena Molina",
    phone: "621 234 901",
    email: "cristina.baena@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "talleres",
    taller: "Marca personal y presencia digital",
    stage: "new",
  },
  {
    name: "Fernando Rivas Cortés",
    phone: "632 345 012",
    email: "f.rivas.cortes@hotmail.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Formación in-company para equipos",
    stage: "new",
  },
  {
    name: "Sara Delgado Peña",
    phone: "643 456 123",
    email: "sara.delgado.p@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Inglés de negocios — nivel intermedio",
    stage: "new",
  },
  {
    name: "Tomás Blanco Serrano",
    phone: "654 567 234",
    email: "tomas.blanco.s@gmail.com",
    tipo_usuario: "profesional",
    motivo: "talleres",
    taller: "Inteligencia emocional en el trabajo",
    stage: "new",
  },
  {
    name: "Elena Vidal Romero",
    phone: "665 678 345",
    email: "elena.vidal.r@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "diagnostico",
    mensaje: "Estoy buscando reorientar mi carrera y no sé por dónde empezar.",
    stage: "new",
  },
  {
    name: "Pablo Mora Aguilar",
    phone: "676 789 456",
    email: "pablo.mora.a@outlook.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Programa de aceleración para startups",
    stage: "new",
  },

  // ── Contactado (14) ─────────────────────────────────────────────────────────
  {
    name: "Raquel Jiménez Torres",
    phone: "687 890 567",
    email: "raquel.jimenez@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Comunicación no violenta",
    stage: "contacted",
  },
  {
    name: "Hugo Navarro Ríos",
    phone: "698 901 678",
    email: "hugo.navarro.rios@gmail.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Mentoría grupal para directivos",
    stage: "contacted",
    notes: "Muy interesado. Gestiona equipo de 15 personas. Programar demo esta semana.",
  },
  {
    name: "Beatriz Castro Flores",
    phone: "609 012 789",
    email: "beatriz.castro.f@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "talleres",
    taller: "Cómo hablar en público sin miedo",
    stage: "contacted",
  },
  {
    name: "Ignacio Rubio Medina",
    phone: "620 123 890",
    email: "i.rubio.medina@gmail.com",
    tipo_usuario: "profesional",
    motivo: "diagnostico",
    mensaje: "Queremos diagnosticar las necesidades formativas de toda nuestra plantilla.",
    stage: "contacted",
    notes: "Empresa de 60 empleados. Presupuesto disponible. Llamar el martes.",
  },
  {
    name: "Virginia Sanz Espinosa",
    phone: "631 234 901",
    email: "virginia.sanz@hotmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Design thinking e innovación",
    stage: "contacted",
  },
  {
    name: "Carlos Reyes Guzmán",
    phone: "642 345 012",
    email: "carlos.reyes.g@gmail.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Consultoría de cultura organizacional",
    stage: "contacted",
    notes: "Responsable de RRHH. Enviado dossier de servicios. Pendiente de respuesta.",
  },
  {
    name: "Marta Pedraza Ibáñez",
    phone: "653 456 123",
    email: "marta.pedraza@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "talleres",
    taller: "Mindfulness y bienestar corporativo",
    stage: "contacted",
  },
  {
    name: "Gonzalo Vargas Ortega",
    phone: "664 567 234",
    email: "g.vargas.ortega@gmail.com",
    tipo_usuario: "profesional",
    motivo: "cursos",
    curso: "Gestión ágil de proyectos (Scrum y Kanban)",
    stage: "contacted",
  },
  {
    name: "Amparo Molina Cortés",
    phone: "675 678 345",
    email: "amparo.molina@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "diagnostico",
    mensaje: "He terminado mis estudios y no sé qué formación complementaria hacer.",
    stage: "contacted",
  },
  {
    name: "Rodrigo Pena Cano",
    phone: "686 789 456",
    email: "rodrigo.pena@outlook.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Formación in-company en habilidades directivas",
    stage: "contacted",
    notes: "Director de operaciones. Busca formación para 3 mandos intermedios.",
  },
  {
    name: "Silvia Herrera Blanco",
    phone: "697 890 567",
    email: "silvia.herrera.b@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Copywriting y escritura persuasiva",
    stage: "contacted",
  },
  {
    name: "Francisco Lara Soto",
    phone: "608 901 678",
    email: "f.lara.soto@gmail.com",
    tipo_usuario: "profesional",
    motivo: "talleres",
    taller: "Negociación y cierre de ventas",
    stage: "contacted",
    notes: "Equipo comercial de 8 personas. Quiere el taller para todo el grupo.",
  },
  {
    name: "Rosa Domínguez Paredes",
    phone: "619 012 789",
    email: "rosa.dominguez.p@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Redes sociales para profesionales",
    stage: "contacted",
  },
  {
    name: "Iñaki Bermejo Alonso",
    phone: "630 123 890",
    email: "inaki.bermejo@gmail.com",
    tipo_usuario: "profesional",
    motivo: "diagnostico",
    mensaje: "Queremos medir el gap de competencias digitales en nuestros 4 departamentos.",
    stage: "contacted",
    notes: "CTO de empresa mediana. Alto interés. Prepararle propuesta esta semana.",
  },

  // ── Descartado (5) ──────────────────────────────────────────────────────────
  {
    name: "Patricia Cabrera Méndez",
    phone: "641 234 901",
    email: "patricia.cabrera@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Inglés de negocios — nivel intermedio",
    stage: "lost",
    notes: "No responde. Tres intentos en dos semanas. Cerrado por inactividad.",
  },
  {
    name: "Manuel Iglesias Vega",
    phone: "652 345 012",
    email: "manuel.iglesias.v@hotmail.com",
    tipo_usuario: "ciudadano",
    motivo: "talleres",
    taller: "Cómo hablar en público sin miedo",
    stage: "lost",
    notes: "Encontró alternativa gratuita en su empresa. Descartado.",
  },
  {
    name: "Susana Fuentes Ramos",
    phone: "663 456 123",
    email: "susana.fuentes.r@gmail.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Mentoría individual",
    stage: "lost",
    notes: "Presupuesto muy ajustado. No encaja con nuestras tarifas actuales.",
  },
  {
    name: "Diego Alarcón Prieto",
    phone: "674 567 234",
    email: "diego.alarcon@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "diagnostico",
    mensaje: "Busco orientación vocacional.",
    stage: "lost",
    notes: "Era menor de edad. Derivado a su centro educativo.",
  },
  {
    name: "Verónica Parra León",
    phone: "685 678 345",
    email: "veronica.parra.l@gmail.com",
    tipo_usuario: "profesional",
    motivo: "talleres",
    taller: "Gestión del estrés laboral",
    stage: "lost",
    notes: "Requería taller presencial en ubicación que no cubrimos actualmente.",
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write("  Aumenta — Seed inicial                    \n");
  process.stdout.write("════════════════════════════════════════════\n");

  // ── 1. Crear schema ──────────────────────────────────────────────────────────
  header("Creando schema PostgreSQL...");
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await rawDb.close();
  log(`✓ Schema "${SCHEMA}" listo`);

  // ── 2. Tablas master ─────────────────────────────────────────────────────────
  header("Sincronizando tablas master...");
  getMasterDb();

  // ── 3. Tablas del tenant ─────────────────────────────────────────────────────
  header(`Sincronizando tablas de ${SCHEMA}...`);
  const { sequelize: tenantSeq } = getTenantDb(SLUG);
  await tenantSeq.sync({ alter: true });
  log(`✓ Tablas en ${SCHEMA} actualizadas`);

  // ── 4. Tenant ────────────────────────────────────────────────────────────────
  header("Creando tenant Aumenta...");
  const { Tenant, User, TenantModule } = getMasterModels();

  const [tenant, tenantCreated] = await Tenant.findOrCreate({
    where: { slug: SLUG },
    defaults: {
      name: "Aumenta",
      slug: SLUG,
      dbName: "salamandra",
      plan: "pro",
      status: "active",
      settings: {
        brand: {
          primaryColor: "#FF1F96",
          secondaryColor: "#563FA6",
          logoUrl: null,
        },
      },
    },
  });
  log(`${tenantCreated ? "✓ Creado" : "· Ya existía"} tenant "${SLUG}" (id: ${tenant.id})`);

  // ── 5. Usuario ───────────────────────────────────────────────────────────────
  header("Creando usuario administrador...");
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 12);
  const [, userCreated] = await User.findOrCreate({
    where: { email: USER_EMAIL },
    defaults: {
      email: USER_EMAIL,
      passwordHash,
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: ["leads"],
    },
  });
  log(`${userCreated ? "✓ Creado" : "· Ya existía"} usuario "${USER_EMAIL}"`);

  // ── 6. Módulo leads ──────────────────────────────────────────────────────────
  header("Registrando módulo de leads...");
  const [, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "leads" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "leads",
      enabled: true,
      version: "1.0.0",
      uiOverride: "aumenta/LeadsModule",
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: {},
    },
  });
  log(`${modCreated ? "✓ Creado" : "· Ya existía"} módulo "leads" (uiOverride: aumenta/LeadsModule)`);

  // ── 7. Leads de prueba ───────────────────────────────────────────────────────
  header(`Sembrando ${LEADS_DATA.length} leads de prueba...`);
  const { models } = getTenantDb(SLUG);
  const { Lead } = models;

  const now = new Date("2026-04-10");
  let created = 0;

  for (let i = 0; i < LEADS_DATA.length; i++) {
    const d = LEADS_DATA[i];
    const daysAgo = Math.floor((LEADS_DATA.length - i) * (40 / LEADS_DATA.length));
    const createdAt = new Date(now);
    createdAt.setDate(createdAt.getDate() - daysAgo);

    const [, wasCreated] = await Lead.findOrCreate({
      where: { email: d.email },
      defaults: {
        name: d.name,
        phone: d.phone,
        email: d.email,
        title: d.name,
        stage: d.stage,
        notes: d.notes ?? null,
        tipo_usuario: d.tipo_usuario ?? null,
        motivo: d.motivo ?? null,
        servicio: d.servicio ?? null,
        curso: d.curso ?? null,
        taller: d.taller ?? null,
        mensaje: d.mensaje ?? null,
        customFields: {},
        createdAt,
        updatedAt: createdAt,
      },
    });
    if (wasCreated) created++;
  }
  log(`✓ ${created} leads creados, ${LEADS_DATA.length - created} ya existían`);

  // ── 8. Resumen ───────────────────────────────────────────────────────────────
  const byStage = LEADS_DATA.reduce((acc, l) => {
    acc[l.stage] = (acc[l.stage] ?? 0) + 1;
    return acc;
  }, {});

  const byMotivo = LEADS_DATA.reduce((acc, l) => {
    acc[l.motivo] = (acc[l.motivo] ?? 0) + 1;
    return acc;
  }, {});

  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Accede con estas credenciales:\n");
  process.stdout.write("════════════════════════════════════════════\n");
  process.stdout.write(`  URL:         http://localhost:3000/login\n`);
  process.stdout.write(`  Tenant:      x-tenant: ${SLUG}\n`);
  process.stdout.write(`  Email:       ${USER_EMAIL}\n`);
  process.stdout.write(`  Contraseña:  ${USER_PASSWORD}\n`);
  process.stdout.write("────────────────────────────────────────────\n");
  process.stdout.write(`  Leads totales: ${LEADS_DATA.length}\n`);
  process.stdout.write(`    Nuevo:       ${byStage.new ?? 0}\n`);
  process.stdout.write(`    Contactado:  ${byStage.contacted ?? 0}\n`);
  process.stdout.write(`    Descartado:  ${byStage.lost ?? 0}\n`);
  process.stdout.write("────────────────────────────────────────────\n");
  process.stdout.write(`  Por motivo:\n`);
  process.stdout.write(`    Diagnóstico: ${byMotivo.diagnostico ?? 0}\n`);
  process.stdout.write(`    Servicios:   ${byMotivo.servicios ?? 0}\n`);
  process.stdout.write(`    Cursos:      ${byMotivo.cursos ?? 0}\n`);
  process.stdout.write(`    Talleres:    ${byMotivo.talleres ?? 0}\n`);
  process.stdout.write("════════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
