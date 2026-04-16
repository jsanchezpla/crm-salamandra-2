/**
 * add-training-module-demo.js
 *
 * Activa el módulo "training" en el tenant demo y lo llena con datos ficticios:
 *   - 4 empresas
 *   - 8 cursos
 *   - asignaciones empresa↔curso
 *   - 46 alumnos (10 privados + 36 de empresa)
 *   - ~55 matrículas distribuidas
 *
 * Uso: npm run db:add-training-demo
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
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ─── Datos ficticios ──────────────────────────────────────────────────────────

const COMPANIES_DATA = [
  { name: "Tecnologías Solares Ibéricas", externalId: 101 },
  { name: "Grupo Hostelería Mediterráneo", externalId: 102 },
  { name: "Constructora Leal & Hijos", externalId: 103 },
  { name: "Clínica Dental Bravo", externalId: 104 },
];

const COURSES_DATA = [
  { name: "PRL Básico — Nivel I", wpCourseId: 1001, wcProductId: 2001 },
  { name: "Excel Avanzado para Empresas", wpCourseId: 1002, wcProductId: 2002 },
  { name: "Atención al Cliente de Excelencia", wpCourseId: 1003, wcProductId: 2003 },
  { name: "Manipulador de Alimentos — Nivel Superior", wpCourseId: 1004, wcProductId: 2004 },
  { name: "Primeros Auxilios Básicos", wpCourseId: 1005, wcProductId: 2005 },
  { name: "Marketing Digital para PYMEs", wpCourseId: 1006, wcProductId: 2006 },
  { name: "Gestión de Equipos y Liderazgo", wpCourseId: 1007, wcProductId: 2007 },
  { name: "Seguridad en Obras (PRL Construcción)", wpCourseId: 1008, wcProductId: 2008 },
];

// qué cursos tiene contratados cada empresa [por nombre de empresa → nombres de curso]
const COMPANY_COURSES = {
  "Tecnologías Solares Ibéricas": [
    "PRL Básico — Nivel I",
    "Excel Avanzado para Empresas",
    "Marketing Digital para PYMEs",
    "Gestión de Equipos y Liderazgo",
  ],
  "Grupo Hostelería Mediterráneo": [
    "PRL Básico — Nivel I",
    "Atención al Cliente de Excelencia",
    "Manipulador de Alimentos — Nivel Superior",
    "Primeros Auxilios Básicos",
  ],
  "Constructora Leal & Hijos": [
    "PRL Básico — Nivel I",
    "Seguridad en Obras (PRL Construcción)",
    "Primeros Auxilios Básicos",
  ],
  "Clínica Dental Bravo": [
    "PRL Básico — Nivel I",
    "Primeros Auxilios Básicos",
    "Atención al Cliente de Excelencia",
  ],
};

// Alumnos de empresa. companyName indica a qué empresa pertenecen.
const COMPANY_USERS = [
  // ── Tecnologías Solares Ibéricas (9 alumnos) ──────────────────────────────
  {
    company: "Tecnologías Solares Ibéricas",
    email: "ana.serrano@tsi.es",
    username: "aserrano",
    name: "Ana",
    lastName: "Serrano Vallejo",
    nif: "12345678A",
    birthDate: "1988-03-15",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Excel Avanzado para Empresas"],
    enrolledDaysAgo: 90,
  },
  {
    company: "Tecnologías Solares Ibéricas",
    email: "miguel.plaza@tsi.es",
    username: "mplaza",
    name: "Miguel",
    lastName: "Plaza Herrero",
    nif: "23456789B",
    birthDate: "1992-07-22",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Marketing Digital para PYMEs"],
    enrolledDaysAgo: 85,
  },
  {
    company: "Tecnologías Solares Ibéricas",
    email: "laura.gimenez@tsi.es",
    username: "lgimenez",
    name: "Laura",
    lastName: "Giménez Campos",
    nif: "34567890C",
    birthDate: "1990-11-08",
    country: "ES",
    courses: ["Excel Avanzado para Empresas", "Gestión de Equipos y Liderazgo"],
    enrolledDaysAgo: 80,
  },
  {
    company: "Tecnologías Solares Ibéricas",
    email: "carlos.vega@tsi.es",
    username: "cvega",
    name: "Carlos",
    lastName: "Vega Morales",
    nif: "45678901D",
    birthDate: "1985-05-30",
    country: "ES",
    courses: ["Gestión de Equipos y Liderazgo"],
    enrolledDaysAgo: 75,
  },
  {
    company: "Tecnologías Solares Ibéricas",
    email: "patricia.ramos@tsi.es",
    username: "pramos",
    name: "Patricia",
    lastName: "Ramos Delgado",
    nif: "56789012E",
    birthDate: "1994-09-14",
    country: "ES",
    courses: ["PRL Básico — Nivel I"],
    enrolledDaysAgo: 70,
  },
  {
    company: "Tecnologías Solares Ibéricas",
    email: "jorge.ibañez@tsi.es",
    username: "jibanez",
    name: "Jorge",
    lastName: "Ibáñez Romero",
    nif: "67890123F",
    birthDate: "1987-02-19",
    country: "ES",
    courses: ["Excel Avanzado para Empresas", "Marketing Digital para PYMEs"],
    enrolledDaysAgo: 65,
  },
  {
    company: "Tecnologías Solares Ibéricas",
    email: "sofia.reyes@tsi.es",
    username: "sreyes",
    name: "Sofía",
    lastName: "Reyes Castillo",
    nif: "78901234G",
    birthDate: "1996-04-03",
    country: "ES",
    courses: ["Marketing Digital para PYMEs"],
    enrolledDaysAgo: 60,
  },
  {
    company: "Tecnologías Solares Ibéricas",
    email: "david.mora@tsi.es",
    username: "dmora",
    name: "David",
    lastName: "Mora Lozano",
    nif: "89012345H",
    birthDate: "1991-12-27",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Gestión de Equipos y Liderazgo"],
    enrolledDaysAgo: 55,
  },
  {
    company: "Tecnologías Solares Ibéricas",
    email: "elena.cano@tsi.es",
    username: "ecano",
    name: "Elena",
    lastName: "Cano Fuentes",
    nif: "90123456I",
    birthDate: "1993-06-16",
    country: "ES",
    courses: ["Excel Avanzado para Empresas"],
    enrolledDaysAgo: 50,
  },

  // ── Grupo Hostelería Mediterráneo (10 alumnos) ────────────────────────────
  {
    company: "Grupo Hostelería Mediterráneo",
    email: "roberto.santos@ghm.es",
    username: "rsantos",
    name: "Roberto",
    lastName: "Santos Pérez",
    nif: "01234567J",
    birthDate: "1989-08-11",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Atención al Cliente de Excelencia", "Manipulador de Alimentos — Nivel Superior"],
    enrolledDaysAgo: 120,
  },
  {
    company: "Grupo Hostelería Mediterráneo",
    email: "maria.blanco@ghm.es",
    username: "mblanco",
    name: "María",
    lastName: "Blanco Ortega",
    nif: "12340567K",
    birthDate: "1995-01-25",
    country: "ES",
    courses: ["Atención al Cliente de Excelencia", "Manipulador de Alimentos — Nivel Superior"],
    enrolledDaysAgo: 115,
  },
  {
    company: "Grupo Hostelería Mediterráneo",
    email: "antonio.ruiz@ghm.es",
    username: "aruiz",
    name: "Antonio",
    lastName: "Ruiz Navarro",
    nif: "23450678L",
    birthDate: "1983-10-07",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 110,
  },
  {
    company: "Grupo Hostelería Mediterráneo",
    email: "carmen.flores@ghm.es",
    username: "cflores",
    name: "Carmen",
    lastName: "Flores Medina",
    nif: "34560789M",
    birthDate: "1997-04-20",
    country: "ES",
    courses: ["Manipulador de Alimentos — Nivel Superior"],
    enrolledDaysAgo: 100,
  },
  {
    company: "Grupo Hostelería Mediterráneo",
    email: "jose.garcia@ghm.es",
    username: "jgarcia",
    name: "José",
    lastName: "García Espinosa",
    nif: "45670890N",
    birthDate: "1986-07-13",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Atención al Cliente de Excelencia"],
    enrolledDaysAgo: 95,
  },
  {
    company: "Grupo Hostelería Mediterráneo",
    email: "lucia.pardo@ghm.es",
    username: "lpardo",
    name: "Lucía",
    lastName: "Pardo Gutiérrez",
    nif: "56780901O",
    birthDate: "1999-03-02",
    country: "ES",
    courses: ["Atención al Cliente de Excelencia", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 90,
  },
  {
    company: "Grupo Hostelería Mediterráneo",
    email: "raul.mendez@ghm.es",
    username: "rmendez",
    name: "Raúl",
    lastName: "Méndez Soler",
    nif: "67891012P",
    birthDate: "1991-11-29",
    country: "ES",
    courses: ["Manipulador de Alimentos — Nivel Superior", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 85,
  },
  {
    company: "Grupo Hostelería Mediterráneo",
    email: "pilar.cazorla@ghm.es",
    username: "pcazorla",
    name: "Pilar",
    lastName: "Cazorla Montero",
    nif: "78901123Q",
    birthDate: "1994-05-18",
    country: "ES",
    courses: ["PRL Básico — Nivel I"],
    enrolledDaysAgo: 80,
  },
  {
    company: "Grupo Hostelería Mediterráneo",
    email: "fernando.soto@ghm.es",
    username: "fsoto",
    name: "Fernando",
    lastName: "Soto Aguilar",
    nif: "89012234R",
    birthDate: "1988-09-05",
    country: "ES",
    courses: ["Atención al Cliente de Excelencia"],
    enrolledDaysAgo: 75,
  },
  {
    company: "Grupo Hostelería Mediterráneo",
    email: "nuria.cabello@ghm.es",
    username: "ncabello",
    name: "Nuria",
    lastName: "Cabello Pascual",
    nif: "90123345S",
    birthDate: "1993-02-14",
    country: "ES",
    courses: ["Manipulador de Alimentos — Nivel Superior"],
    enrolledDaysAgo: 70,
  },

  // ── Constructora Leal & Hijos (9 alumnos) ─────────────────────────────────
  {
    company: "Constructora Leal & Hijos",
    email: "francisco.leal@construleal.es",
    username: "fleal",
    name: "Francisco",
    lastName: "Leal Domínguez",
    nif: "01235678T",
    birthDate: "1975-06-23",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Seguridad en Obras (PRL Construcción)", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 150,
  },
  {
    company: "Constructora Leal & Hijos",
    email: "marcos.prieto@construleal.es",
    username: "mprieto",
    name: "Marcos",
    lastName: "Prieto Vidal",
    nif: "12345689U",
    birthDate: "1982-09-01",
    country: "ES",
    courses: ["Seguridad en Obras (PRL Construcción)", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 145,
  },
  {
    company: "Constructora Leal & Hijos",
    email: "rosa.iglesias@construleal.es",
    username: "riglesias",
    name: "Rosa",
    lastName: "Iglesias Vázquez",
    nif: "23456790V",
    birthDate: "1990-04-17",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Seguridad en Obras (PRL Construcción)"],
    enrolledDaysAgo: 140,
  },
  {
    company: "Constructora Leal & Hijos",
    email: "manuel.berrio@construleal.es",
    username: "mberrio",
    name: "Manuel",
    lastName: "Berrío Quijano",
    nif: "34567801W",
    birthDate: "1978-12-09",
    country: "ES",
    courses: ["Seguridad en Obras (PRL Construcción)"],
    enrolledDaysAgo: 130,
  },
  {
    company: "Constructora Leal & Hijos",
    email: "isabel.duran@construleal.es",
    username: "iduran",
    name: "Isabel",
    lastName: "Durán Molina",
    nif: "45678912X",
    birthDate: "1987-03-26",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 120,
  },
  {
    company: "Constructora Leal & Hijos",
    email: "javier.leon@construleal.es",
    username: "jleon",
    name: "Javier",
    lastName: "León Carrasco",
    nif: "56789023Y",
    birthDate: "1984-08-13",
    country: "ES",
    courses: ["Seguridad en Obras (PRL Construcción)", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 110,
  },
  {
    company: "Constructora Leal & Hijos",
    email: "lucia.aranda@construleal.es",
    username: "laranda",
    name: "Lucía",
    lastName: "Aranda Rubio",
    nif: "67890134Z",
    birthDate: "1993-05-04",
    country: "ES",
    courses: ["PRL Básico — Nivel I"],
    enrolledDaysAgo: 100,
  },
  {
    company: "Constructora Leal & Hijos",
    email: "pedro.acosta@construleal.es",
    username: "pacosta",
    name: "Pedro",
    lastName: "Acosta Santamaría",
    nif: "78901245A",
    birthDate: "1980-11-21",
    country: "ES",
    courses: ["Seguridad en Obras (PRL Construcción)"],
    enrolledDaysAgo: 90,
  },
  {
    company: "Constructora Leal & Hijos",
    email: "silvia.tovar@construleal.es",
    username: "stovar",
    name: "Silvia",
    lastName: "Tovar Herrera",
    nif: "89012356B",
    birthDate: "1995-07-08",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 80,
  },

  // ── Clínica Dental Bravo (8 alumnos) ─────────────────────────────────────
  {
    company: "Clínica Dental Bravo",
    email: "elena.bravo@clinicabravo.es",
    username: "ebravo",
    name: "Elena",
    lastName: "Bravo Fernández",
    nif: "90123467C",
    birthDate: "1979-01-30",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Primeros Auxilios Básicos", "Atención al Cliente de Excelencia"],
    enrolledDaysAgo: 180,
  },
  {
    company: "Clínica Dental Bravo",
    email: "alberto.nieto@clinicabravo.es",
    username: "anieto",
    name: "Alberto",
    lastName: "Nieto Gómez",
    nif: "01234578D",
    birthDate: "1985-04-14",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 175,
  },
  {
    company: "Clínica Dental Bravo",
    email: "marta.rios@clinicabravo.es",
    username: "mrios",
    name: "Marta",
    lastName: "Ríos Castellano",
    nif: "12345689E",
    birthDate: "1991-10-03",
    country: "ES",
    courses: ["Atención al Cliente de Excelencia", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 170,
  },
  {
    company: "Clínica Dental Bravo",
    email: "victor.palacios@clinicabravo.es",
    username: "vpalacios",
    name: "Víctor",
    lastName: "Palacios Vera",
    nif: "23456790F",
    birthDate: "1988-07-19",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Atención al Cliente de Excelencia"],
    enrolledDaysAgo: 160,
  },
  {
    company: "Clínica Dental Bravo",
    email: "ana.quintero@clinicabravo.es",
    username: "aquintero",
    name: "Ana",
    lastName: "Quintero Ibáñez",
    nif: "34567801G",
    birthDate: "1996-02-28",
    country: "ES",
    courses: ["Primeros Auxilios Básicos"],
    enrolledDaysAgo: 150,
  },
  {
    company: "Clínica Dental Bravo",
    email: "ignacio.soriano@clinicabravo.es",
    username: "isoriano",
    name: "Ignacio",
    lastName: "Soriano Alcalde",
    nif: "45678912H",
    birthDate: "1983-06-11",
    country: "ES",
    courses: ["PRL Básico — Nivel I"],
    enrolledDaysAgo: 140,
  },
  {
    company: "Clínica Dental Bravo",
    email: "beatriz.trujillo@clinicabravo.es",
    username: "btrujillo",
    name: "Beatriz",
    lastName: "Trujillo Mena",
    nif: "56789023I",
    birthDate: "1994-11-07",
    country: "ES",
    courses: ["Atención al Cliente de Excelencia"],
    enrolledDaysAgo: 130,
  },
  {
    company: "Clínica Dental Bravo",
    email: "rafael.crespo@clinicabravo.es",
    username: "rcrespo",
    name: "Rafael",
    lastName: "Crespo Alvarado",
    nif: "67890134J",
    birthDate: "1981-09-24",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 120,
  },
];

// Alumnos privados (sin empresa)
const PRIVATE_USERS = [
  {
    email: "sara.mendoza@gmail.com",
    username: "smendoza",
    name: "Sara",
    lastName: "Mendoza Torres",
    nif: "78901245K",
    birthDate: "1990-05-12",
    country: "ES",
    courses: ["Marketing Digital para PYMEs", "Gestión de Equipos y Liderazgo"],
    enrolledDaysAgo: 60,
  },
  {
    email: "andres.parra@gmail.com",
    username: "aparra",
    name: "Andrés",
    lastName: "Parra Jiménez",
    nif: "89012356L",
    birthDate: "1987-08-30",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Primeros Auxilios Básicos"],
    enrolledDaysAgo: 55,
  },
  {
    email: "monica.villanueva@hotmail.com",
    username: "mvillanueva",
    name: "Mónica",
    lastName: "Villanueva Sanz",
    nif: "90123467M",
    birthDate: "1993-12-05",
    country: "ES",
    courses: ["Atención al Cliente de Excelencia"],
    enrolledDaysAgo: 50,
  },
  {
    email: "raquel.esteve@gmail.com",
    username: "resteve",
    name: "Raquel",
    lastName: "Esteve Barrera",
    nif: "01234578N",
    birthDate: "1989-03-21",
    country: "ES",
    courses: ["Excel Avanzado para Empresas", "Marketing Digital para PYMEs"],
    enrolledDaysAgo: 45,
  },
  {
    email: "pablo.carmona@gmail.com",
    username: "pcarmona",
    name: "Pablo",
    lastName: "Carmona Valero",
    nif: "12345689O",
    birthDate: "1995-07-16",
    country: "ES",
    courses: ["Gestión de Equipos y Liderazgo"],
    enrolledDaysAgo: 40,
  },
  {
    email: "teresa.exposito@gmail.com",
    username: "texposito",
    name: "Teresa",
    lastName: "Expósito Molina",
    nif: "23456790P",
    birthDate: "1982-10-08",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Marketing Digital para PYMEs"],
    enrolledDaysAgo: 35,
  },
  {
    email: "victor.huertas@outlook.com",
    username: "vhuertas",
    name: "Víctor",
    lastName: "Huertas Pascual",
    nif: "34567801Q",
    birthDate: "1998-01-27",
    country: "ES",
    courses: ["Excel Avanzado para Empresas"],
    enrolledDaysAgo: 25,
  },
  {
    email: "cristina.zamora@gmail.com",
    username: "czamora",
    name: "Cristina",
    lastName: "Zamora Cortés",
    nif: "45678912R",
    birthDate: "1986-06-03",
    country: "ES",
    courses: ["Atención al Cliente de Excelencia", "Gestión de Equipos y Liderazgo"],
    enrolledDaysAgo: 20,
  },
  {
    email: "hugo.segovia@gmail.com",
    username: "hsegovia",
    name: "Hugo",
    lastName: "Segovia Ramos",
    nif: "56789023S",
    birthDate: "1991-04-14",
    country: "ES",
    courses: ["Marketing Digital para PYMEs"],
    enrolledDaysAgo: 15,
  },
  {
    email: "alba.fuentes@gmail.com",
    username: "afuentes",
    name: "Alba",
    lastName: "Fuentes Guerrero",
    nif: "67890134T",
    birthDate: "1997-11-19",
    country: "ES",
    courses: ["PRL Básico — Nivel I", "Excel Avanzado para Empresas"],
    enrolledDaysAgo: 10,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Demo — Activar módulo Training          \n");
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

  // ── 2. Registrar módulo training ─────────────────────────────────────────────
  header("Registrando módulo training...");
  const [mod, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "training" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "training",
      enabled: true,
      version: "1.0.0",
      schemaExtensions: {},
      logicOverrides: {},
      featureFlags: {},
    },
  });
  if (!modCreated) {
    await mod.update({ enabled: true });
    log("· Módulo ya existía — marcado como habilitado");
  } else {
    log("✓ Módulo training creado");
  }

  // ── 3. Añadir training al moduleAccess del usuario admin ─────────────────────
  header("Actualizando acceso del usuario admin...");
  const user = await User.findOne({ where: { email: DEMO_ADMIN_EMAIL } });
  if (!user) {
    process.stderr.write(`\n✗ Usuario ${DEMO_ADMIN_EMAIL} no encontrado.\n`);
    process.exit(1);
  }
  const currentAccess = user.moduleAccess ?? [];
  if (!currentAccess.includes("training")) {
    await user.update({ moduleAccess: [...currentAccess, "training"] });
    log(`✓ "training" añadido al moduleAccess de ${DEMO_ADMIN_EMAIL}`);
  } else {
    log(`· ${DEMO_ADMIN_EMAIL} ya tenía acceso al módulo training`);
  }

  // ── 4. Obtener modelos del schema crm_demo ────────────────────────────────────
  const { models } = getTenantDb(DEMO_SLUG);
  const { Company, Course, CompanyCourse, TrainingUser, CourseEnrollment } = models;

  // ── 5. Crear cursos ───────────────────────────────────────────────────────────
  header(`Creando ${COURSES_DATA.length} cursos...`);
  const courseMap = {};
  for (const c of COURSES_DATA) {
    const [course, created] = await Course.findOrCreate({
      where: { name: c.name },
      defaults: { ...c, active: true },
    });
    courseMap[c.name] = course;
    log(`${created ? "✓" : "·"} ${c.name}`);
  }

  // ── 6. Crear empresas ─────────────────────────────────────────────────────────
  header(`Creando ${COMPANIES_DATA.length} empresas...`);
  const companyMap = {};
  for (const comp of COMPANIES_DATA) {
    const [company, created] = await Company.findOrCreate({
      where: { name: comp.name },
      defaults: { ...comp, active: true, settings: {} },
    });
    companyMap[comp.name] = company;
    log(`${created ? "✓" : "·"} ${comp.name}`);
  }

  // ── 7. Asignar cursos a empresas ──────────────────────────────────────────────
  header("Asignando cursos a empresas...");
  let assignments = 0;
  for (const [compName, courseNames] of Object.entries(COMPANY_COURSES)) {
    const company = companyMap[compName];
    for (const courseName of courseNames) {
      const course = courseMap[courseName];
      const [, created] = await CompanyCourse.findOrCreate({
        where: { companyId: company.id, courseId: course.id },
      });
      if (created) assignments++;
    }
  }
  log(`✓ ${assignments} asignaciones empresa↔curso creadas`);

  // ── 8. Crear alumnos de empresa + matrículas ──────────────────────────────────
  header(`Creando ${COMPANY_USERS.length} alumnos de empresa...`);
  let usersCreated = 0;
  let enrollmentsCreated = 0;

  for (const u of COMPANY_USERS) {
    const company = companyMap[u.company];
    const [trainingUser, uCreated] = await TrainingUser.findOrCreate({
      where: { email: u.email },
      defaults: {
        companyId: company.id,
        type: "company",
        username: u.username,
        email: u.email,
        name: u.name,
        lastName: u.lastName,
        nif: u.nif,
        birthDate: u.birthDate,
        country: u.country,
        active: true,
      },
    });
    if (uCreated) usersCreated++;

    for (const courseName of u.courses) {
      const course = courseMap[courseName];
      const enrolledAt = daysAgo(u.enrolledDaysAgo);
      const [, eCreated] = await CourseEnrollment.findOrCreate({
        where: { trainingUserId: trainingUser.id, courseId: course.id },
        defaults: {
          companyId: company.id,
          enrolledAt,
          metadata: {},
        },
      });
      if (eCreated) enrollmentsCreated++;
    }
  }
  log(`✓ ${usersCreated} alumnos de empresa creados`);
  log(`✓ ${enrollmentsCreated} matrículas de empresa creadas`);

  // ── 9. Crear alumnos privados + matrículas ────────────────────────────────────
  header(`Creando ${PRIVATE_USERS.length} alumnos privados...`);
  let privateCreated = 0;
  let privateEnrollments = 0;

  for (const u of PRIVATE_USERS) {
    const [trainingUser, uCreated] = await TrainingUser.findOrCreate({
      where: { email: u.email },
      defaults: {
        companyId: null,
        type: "private",
        username: u.username,
        email: u.email,
        name: u.name,
        lastName: u.lastName,
        nif: u.nif,
        birthDate: u.birthDate,
        country: u.country,
        active: true,
      },
    });
    if (uCreated) privateCreated++;

    for (const courseName of u.courses) {
      const course = courseMap[courseName];
      const enrolledAt = daysAgo(u.enrolledDaysAgo);
      const [, eCreated] = await CourseEnrollment.findOrCreate({
        where: { trainingUserId: trainingUser.id, courseId: course.id },
        defaults: {
          companyId: null,
          enrolledAt,
          metadata: {},
        },
      });
      if (eCreated) privateEnrollments++;
    }
  }
  log(`✓ ${privateCreated} alumnos privados creados`);
  log(`✓ ${privateEnrollments} matrículas privadas creadas`);

  // ── 10. Resumen ───────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo!\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Cursos:              ${COURSES_DATA.length}\n`);
  process.stdout.write(`  Empresas:            ${COMPANIES_DATA.length}\n`);
  process.stdout.write(`  Alumnos empresa:     ${COMPANY_USERS.length}\n`);
  process.stdout.write(`  Alumnos privados:    ${PRIVATE_USERS.length}\n`);
  process.stdout.write(`  Total alumnos:       ${COMPANY_USERS.length + PRIVATE_USERS.length}\n`);
  process.stdout.write(`  Total matrículas:    ${enrollmentsCreated + privateEnrollments}\n`);
  process.stdout.write(`  Cuenta:              ${DEMO_ADMIN_EMAIL}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
