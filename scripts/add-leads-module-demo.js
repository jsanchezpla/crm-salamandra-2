/**
 * add-leads-module-demo.js
 *
 * Registra el módulo "leads" en el tenant demo y siembra 35 leads ficticios
 * en crm_demo para usar como cuenta de demostración a clientes.
 * Sin conexión con WordPress — los leads se crean directamente en BD.
 *
 * Uso: npm run db:add-leads-demo
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const DEMO_SLUG = "demo";
const DEMO_ADMIN_EMAIL = "admin@demo.salamandra";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

// ─── Datos ficticios ──────────────────────────────────────────────────────────

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
    daysAgo: 8,
  },
  {
    name: "Roberto Fuentes Méndez",
    phone: "622 345 012",
    email: "r.fuentes@hotmail.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Mentoría individual",
    stage: "new",
    daysAgo: 7,
  },
  {
    name: "Lucía Marín Pascual",
    phone: "633 456 123",
    email: "lucia.marin.p@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Liderazgo y comunicación efectiva",
    stage: "new",
    daysAgo: 7,
  },
  {
    name: "Andrés Castellano Vega",
    phone: "644 567 234",
    email: "andres.castellano@gmail.com",
    tipo_usuario: "profesional",
    motivo: "talleres",
    taller: "Taller de productividad personal",
    stage: "new",
    daysAgo: 6,
  },
  {
    name: "Mónica Herrero Santana",
    phone: "655 678 345",
    email: "m.herrero.santana@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "diagnostico",
    mensaje: "Quiero hacer un diagnóstico de mis competencias digitales.",
    stage: "new",
    daysAgo: 6,
  },
  {
    name: "Javier Pizarro Alonso",
    phone: "666 789 456",
    email: "javier.pizarro@outlook.com",
    tipo_usuario: "profesional",
    motivo: "cursos",
    curso: "Marketing digital avanzado",
    stage: "new",
    daysAgo: 5,
  },
  {
    name: "Natalia Guerrero Ortiz",
    phone: "677 890 567",
    email: "natalia.guerrero@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "talleres",
    taller: "Gestión del estrés laboral",
    stage: "new",
    daysAgo: 5,
  },
  {
    name: "Daniel Crespo Iglesias",
    phone: "688 901 678",
    email: "d.crespo.iglesias@gmail.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Consultoría de transformación digital",
    stage: "new",
    daysAgo: 4,
  },
  {
    name: "Pilar Montoya Campos",
    phone: "699 012 789",
    email: "pilar.montoya@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Excel y análisis de datos para no técnicos",
    stage: "new",
    daysAgo: 4,
  },
  {
    name: "Alberto Lozano Rueda",
    phone: "610 123 890",
    email: "alberto.lozano@gmail.com",
    tipo_usuario: "profesional",
    motivo: "diagnostico",
    mensaje: "Necesito orientación sobre cómo mejorar las habilidades de mi equipo.",
    stage: "new",
    daysAgo: 3,
  },
  {
    name: "Cristina Baena Molina",
    phone: "621 234 901",
    email: "cristina.baena@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "talleres",
    taller: "Marca personal y presencia digital",
    stage: "new",
    daysAgo: 3,
  },
  {
    name: "Fernando Rivas Cortés",
    phone: "632 345 012",
    email: "f.rivas.cortes@hotmail.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Formación in-company para equipos",
    stage: "new",
    daysAgo: 2,
  },
  {
    name: "Sara Delgado Peña",
    phone: "643 456 123",
    email: "sara.delgado.p@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Inglés de negocios — nivel intermedio",
    stage: "new",
    daysAgo: 2,
  },
  {
    name: "Tomás Blanco Serrano",
    phone: "654 567 234",
    email: "tomas.blanco.s@gmail.com",
    tipo_usuario: "profesional",
    motivo: "talleres",
    taller: "Inteligencia emocional en el trabajo",
    stage: "new",
    daysAgo: 1,
  },
  {
    name: "Elena Vidal Romero",
    phone: "665 678 345",
    email: "elena.vidal.r@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "diagnostico",
    mensaje: "Estoy buscando reorientar mi carrera y no sé por dónde empezar.",
    stage: "new",
    daysAgo: 1,
  },
  {
    name: "Pablo Mora Aguilar",
    phone: "676 789 456",
    email: "pablo.mora.a@outlook.com",
    tipo_usuario: "profesional",
    motivo: "servicios",
    servicio: "Programa de aceleración para startups",
    stage: "new",
    daysAgo: 0,
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
    daysAgo: 25,
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
    daysAgo: 24,
  },
  {
    name: "Beatriz Castro Flores",
    phone: "609 012 789",
    email: "beatriz.castro.f@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "talleres",
    taller: "Cómo hablar en público sin miedo",
    stage: "contacted",
    daysAgo: 23,
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
    daysAgo: 22,
  },
  {
    name: "Virginia Sanz Espinosa",
    phone: "631 234 901",
    email: "virginia.sanz@hotmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Design thinking e innovación",
    stage: "contacted",
    daysAgo: 21,
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
    daysAgo: 20,
  },
  {
    name: "Marta Pedraza Ibáñez",
    phone: "653 456 123",
    email: "marta.pedraza@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "talleres",
    taller: "Mindfulness y bienestar corporativo",
    stage: "contacted",
    daysAgo: 18,
  },
  {
    name: "Gonzalo Vargas Ortega",
    phone: "664 567 234",
    email: "g.vargas.ortega@gmail.com",
    tipo_usuario: "profesional",
    motivo: "cursos",
    curso: "Gestión ágil de proyectos (Scrum y Kanban)",
    stage: "contacted",
    daysAgo: 17,
  },
  {
    name: "Amparo Molina Cortés",
    phone: "675 678 345",
    email: "amparo.molina@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "diagnostico",
    mensaje: "He terminado mis estudios y no sé qué formación complementaria hacer.",
    stage: "contacted",
    daysAgo: 15,
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
    daysAgo: 14,
  },
  {
    name: "Silvia Herrera Blanco",
    phone: "697 890 567",
    email: "silvia.herrera.b@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Copywriting y escritura persuasiva",
    stage: "contacted",
    daysAgo: 12,
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
    daysAgo: 11,
  },
  {
    name: "Rosa Domínguez Paredes",
    phone: "619 012 789",
    email: "rosa.dominguez.p@gmail.com",
    tipo_usuario: "ciudadano",
    motivo: "cursos",
    curso: "Redes sociales para profesionales",
    stage: "contacted",
    daysAgo: 10,
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
    daysAgo: 9,
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
    daysAgo: 40,
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
    daysAgo: 38,
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
    daysAgo: 35,
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
    daysAgo: 32,
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
    daysAgo: 30,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Demo — Activar módulo Leads            \n");
  process.stdout.write("════════════════════════════════════════\n");

  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  // ── 1. Verificar tenant demo ─────────────────────────────────────────────────
  header("Verificando tenant demo...");
  const tenant = await Tenant.findOne({ where: { slug: DEMO_SLUG } });
  if (!tenant) {
    process.stderr.write("\n✗ Tenant demo no encontrado. Ejecuta npm run db:sync primero.\n");
    process.exit(1);
  }
  log(`✓ Tenant encontrado: ${tenant.name} (id: ${tenant.id})`);

  // ── 2. Registrar módulo leads con uiOverride ──────────────────────────────────
  header("Registrando módulo leads...");
  const [module, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "leads" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "leads",
      enabled: true,
      version: "1.0.0",
      uiOverride: "demo/LeadsModule",
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: {},
    },
  });

  if (!modCreated) {
    await module.update({ enabled: true, uiOverride: "demo/LeadsModule" });
    log("· Módulo ya existía — actualizado con uiOverride: demo/LeadsModule");
  } else {
    log("✓ Módulo leads creado con uiOverride: demo/LeadsModule");
  }

  // ── 3. Añadir leads al moduleAccess del usuario admin ────────────────────────
  header("Actualizando acceso del usuario admin...");
  const user = await User.findOne({ where: { email: DEMO_ADMIN_EMAIL } });
  if (!user) {
    process.stderr.write(`\n✗ Usuario ${DEMO_ADMIN_EMAIL} no encontrado.\n`);
    process.exit(1);
  }

  const currentAccess = user.moduleAccess ?? [];
  if (!currentAccess.includes("leads")) {
    await user.update({ moduleAccess: [...currentAccess, "leads"] });
    log(`✓ "leads" añadido al moduleAccess de ${DEMO_ADMIN_EMAIL}`);
  } else {
    log(`· ${DEMO_ADMIN_EMAIL} ya tenía acceso al módulo leads`);
  }

  // ── 4. Sembrar leads en crm_demo ─────────────────────────────────────────────
  header(`Sembrando ${LEADS_DATA.length} leads en crm_demo...`);
  const { models } = getTenantDb(DEMO_SLUG);
  const { Lead } = models;

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

  // ── 5. Resumen ────────────────────────────────────────────────────────────────
  const byStage = LEADS_DATA.reduce((acc, l) => {
    acc[l.stage] = (acc[l.stage] ?? 0) + 1;
    return acc;
  }, {});

  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo!\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Leads en crm_demo:  ${LEADS_DATA.length}\n`);
  process.stdout.write(`    Nuevo:            ${byStage.new ?? 0}\n`);
  process.stdout.write(`    Contactado:       ${byStage.contacted ?? 0}\n`);
  process.stdout.write(`    Descartado:       ${byStage.lost ?? 0}\n`);
  process.stdout.write(`  Cuenta:             ${DEMO_ADMIN_EMAIL}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
