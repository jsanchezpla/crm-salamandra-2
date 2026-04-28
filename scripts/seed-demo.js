/**
 * seed-demo.js — Tenant demo "show-room" con datos realistas en español
 *
 * Configura el tenant `demo` con la paleta Salamandra (#1F3B34) y activa los
 * 5 módulos con UI funcional: clients, sales (leads), inventory, billing,
 * training. Genera datos coherentes entre módulos para enseñar a clientes.
 *
 * Uso local:        node --env-file=.env.local scripts/seed-demo.js
 * Limpiar y repobblar: node --env-file=.env.local scripts/seed-demo.js --reset
 * Uso VPS:          docker compose exec app node scripts/seed-demo.js
 */

import { Sequelize } from "sequelize";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

const SLUG = "demo";
const SCHEMA = `crm_${SLUG}`;
const ADMIN_EMAIL = "admin@demo.salamandra";
const ADMIN_PASSWORD = "Admin1234!";
const MODULES = ["clients", "leads", "calendar", "inventory", "billing", "training"];

const BRAND = {
  primaryColor: "#1F3B34",
  secondaryColor: "#152722",
  accentColor: "#F5F2EB",
  logoUrl: null,
};

const RESET = process.argv.includes("--reset");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max, dec = 0) {
  const v = Math.random() * (max - min) + min;
  return dec ? +v.toFixed(dec) : Math.round(v);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function monthAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 7);
}
function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// ─── Datos maestros (reutilizables, en español) ──────────────────────────────

const NOMBRES_PILA = [
  "Carlos", "Ana", "Miguel", "Laura", "Javier", "Marta", "David", "Elena",
  "Pedro", "Sofía", "Alejandro", "Carmen", "Rubén", "Lucía", "Andrés",
  "Patricia", "Daniel", "Cristina", "Sergio", "Beatriz", "Pablo", "Sara",
  "Francisco", "Isabel", "Luis", "Paula", "Roberto", "Natalia", "Adrián", "Inés",
];

const APELLIDOS = [
  "García", "Rodríguez", "Martínez", "López", "Sánchez", "Pérez", "Gómez",
  "Fernández", "Jiménez", "Ruiz", "Hernández", "Díaz", "Moreno", "Álvarez",
  "Romero", "Gutiérrez", "Navarro", "Torres", "Domínguez", "Vázquez",
];

const EMPRESAS_GENERICAS = [
  "Innovatech S.L.", "Distribuciones Marbella", "Consultora Atlántica",
  "Servicios Mediterráneos", "Logística del Sur", "Estudios Cantábrica",
  "TecnoIberia S.A.", "Grupo Vértice", "Consultoría Norte", "Suministros Levante",
  "Industrial Pirineos", "Comercial Galicia", "Tecnología Andalucía",
  "Servicios Catalanes", "Distribuidora Madrid", "Asesoría Castilla",
  "Gestión Aragonesa", "Industria Vasca", "Comercio Valencia",
  "Consultora Murcia",
];

const PAISES = [
  "España", "Portugal", "Francia", "Italia", "Alemania", "Países Bajos",
  "Bélgica", "México", "Argentina", "Colombia",
];

const CIUDADES = {
  "España": ["Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao", "Málaga", "Zaragoza", "Granada"],
  "Portugal": ["Lisboa", "Oporto", "Coímbra"],
  "Francia": ["París", "Lyon", "Marsella"],
  "Italia": ["Milán", "Roma", "Turín"],
  "Alemania": ["Múnich", "Berlín", "Hamburgo"],
  "Países Bajos": ["Ámsterdam", "Rotterdam"],
  "Bélgica": ["Bruselas", "Amberes"],
  "México": ["Ciudad de México", "Guadalajara", "Monterrey"],
  "Argentina": ["Buenos Aires", "Córdoba"],
  "Colombia": ["Bogotá", "Medellín"],
};

// ─── Reset (opcional) ─────────────────────────────────────────────────────────

async function resetTenantData(models) {
  header("Limpiando datos existentes (--reset)...");
  // Orden importa: hijos antes que padres por foreign keys
  await models.QuizAttempt?.destroy({ where: {}, truncate: false });
  await models.CourseEnrollment?.destroy({ where: {}, truncate: false });
  await models.TrainingUser?.destroy({ where: {}, truncate: false });
  await models.CompanyCourse?.destroy({ where: {}, truncate: false });
  await models.Course?.destroy({ where: {}, truncate: false });
  await models.Company?.destroy({ where: {}, truncate: false });
  await models.Payment?.destroy({ where: {}, truncate: false });
  await models.Invoice?.destroy({ where: {}, truncate: false });
  await models.Cost?.destroy({ where: {}, truncate: false });
  await models.InventoryProduct?.destroy({ where: {}, truncate: false });
  await models.Interaction?.destroy({ where: {}, truncate: false });
  await models.Lead?.destroy({ where: {}, truncate: false });
  await models.Client?.destroy({ where: {}, truncate: false });
  log("✓ Datos existentes eliminados");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write("    Demo Salamandra — Seed completo show-room      \n");
  process.stdout.write("══════════════════════════════════════════════════\n");
  if (RESET) process.stdout.write("    Modo: --reset (limpiar y repobblar)            \n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  // ─── 1. Schema PostgreSQL ────────────────────────────────────────────────
  header("Creando schema PostgreSQL...");
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await rawDb.close();
  log(`✓ Schema "${SCHEMA}" listo`);

  // ─── 2. Master + tenant ──────────────────────────────────────────────────
  header("Configurando tenant 'demo' en master...");
  getMasterDb();
  const { Tenant, User, TenantModule } = getMasterModels();

  let tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    tenant = await Tenant.create({
      name: "Demo Salamandra",
      slug: SLUG,
      dbName: "salamandra",
      plan: "pro",
      status: "active",
      settings: { brand: BRAND },
    });
    log(`✓ Tenant creado (id: ${tenant.id})`);
  } else {
    await tenant.update({
      name: "Demo Salamandra",
      settings: { ...(tenant.settings || {}), brand: BRAND },
    });
    log(`· Tenant actualizado (id: ${tenant.id})`);
  }

  // ─── 3. Usuario admin ────────────────────────────────────────────────────
  header("Configurando usuario admin...");
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const [adminUser, userCreated] = await User.findOrCreate({
    where: { email: ADMIN_EMAIL },
    defaults: {
      email: ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: MODULES,
    },
  });
  if (!userCreated) {
    // No tocamos el passwordHash existente para no romper credenciales en uso
    await adminUser.update({ moduleAccess: MODULES, tenantId: tenant.id });
  }
  log(`${userCreated ? "✓ Creado" : "· Actualizado (password preservado)"} usuario "${ADMIN_EMAIL}"`);

  // ─── 4. Activar módulos (5) ──────────────────────────────────────────────
  header("Activando módulos demo...");
  // Desactivar TODOS los módulos primero para que el sidebar quede limpio
  await TenantModule.update({ enabled: false }, { where: { tenantId: tenant.id } });
  for (const moduleKey of MODULES) {
    const [mod, created] = await TenantModule.findOrCreate({
      where: { tenantId: tenant.id, moduleKey },
      defaults: {
        tenantId: tenant.id,
        moduleKey,
        enabled: true,
        version: "1.0.0",
        schemaExtensions: {},
        logicOverrides: {},
        featureFlags: {},
      },
    });
    if (!created) await mod.update({ enabled: true });
    log(`${created ? "✓ Creado" : "· Activado"} módulo "${moduleKey}"`);
  }

  // ─── 5. Tablas del tenant ────────────────────────────────────────────────
  header(`Sincronizando tablas en ${SCHEMA}...`);
  const { sequelize: tenantSeq, models } = getTenantDb(SLUG);
  await tenantSeq.sync({ alter: true });
  log("✓ Tablas sincronizadas");

  invalidateTenantCache(SLUG);

  // ─── 6. Reset (opcional) ─────────────────────────────────────────────────
  if (RESET) await resetTenantData(models);

  const { Lead, Client, Interaction, InventoryProduct, Invoice, Payment, Cost,
          Company, Course, TrainingUser, CourseEnrollment, QuizAttempt } = models;

  // ─── 7. Clientes (40) ────────────────────────────────────────────────────
  header("Creando clientes...");
  const SE_STATUSES = ["new", "contacted", "following", "converted", "discarded"];
  const TEMAS = [
    "Consultoría estratégica", "Desarrollo software", "Marketing digital",
    "Coaching ejecutivo", "Formación corporativa", "Auditoría operativa",
    "Diseño de marca", "Transformación digital", "Asesoría legal",
  ];

  const clientes = [];
  for (let i = 0; i < 40; i++) {
    const pais = pick(PAISES);
    const ciudad = pick(CIUDADES[pais] || ["—"]);
    const nombrePersona = pick(NOMBRES_PILA) + " " + pick(APELLIDOS);
    const empresa = i < EMPRESAS_GENERICAS.length
      ? EMPRESAS_GENERICAS[i]
      : `${pick(["Servicios","Comercial","Industrial","Grupo","Estudios"])} ${pick(APELLIDOS)} S.L.`;
    const seStatus = i < 6 ? "new" : i < 14 ? "contacted" : i < 28 ? "following" : i < 36 ? "converted" : "discarded";

    const c = await Client.create({
      name: nombrePersona,
      email: `contacto@${slugify(empresa.split(" ")[0])}.com`,
      phone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`,
      notes: i % 5 === 0 ? "Cliente clave. Reunión trimestral programada." : null,
      customFields: {
        company: empresa,
        country: pais,
        city: ciudad,
        topic: pick(TEMAS),
        seStatus,
        origin: pick(["manual", "feria", "referido", "web"]),
      },
    });
    clientes.push(c);

    // 1-3 interacciones por cliente
    const numInt = rand(1, 3);
    for (let j = 0; j < numInt; j++) {
      await Interaction.create({
        clientId: c.id,
        type: pick(["call", "email", "meeting", "note"]),
        content: pick([
          "Llamada inicial. Muy interesado en la propuesta.",
          "Email enviado con presupuesto detallado.",
          "Reunión presencial. Definidos próximos pasos.",
          "Aclaramos dudas técnicas sobre el alcance.",
          "Confirma fechas para el kick-off del proyecto.",
          "Pendiente respuesta sobre cláusula de exclusividad.",
        ]),
        date: daysAgo(rand(1, 180)),
        createdBy: pick(["Jorge", "María", "Antonio"]),
      });
    }
  }
  log(`✓ ${clientes.length} clientes con interacciones`);

  // ─── 8. Leads (80) ───────────────────────────────────────────────────────
  // Override demo usa stages: new, contacted, lost
  // Custom fields: motivo (diagnostico|servicios|cursos|talleres), mensaje, servicio, curso, taller
  header("Creando leads...");
  const MOTIVOS = ["diagnostico", "servicios", "cursos", "talleres"];
  const SERVICIOS = [
    "Consultoría 360", "Auditoría operativa", "Mentoring ejecutivo",
    "Diagnóstico empresarial", "Plan estratégico anual", "Optimización procesos",
  ];
  const CURSOS_LEAD = [
    "Liderazgo ágil", "Comunicación efectiva", "Gestión del cambio",
    "Inteligencia emocional", "Negociación avanzada", "Toma de decisiones",
  ];
  const TALLERES = [
    "Workshop equipos de alto rendimiento", "Resolución de conflictos",
    "Diseño thinking aplicado", "Time management ejecutivo",
  ];
  const MENSAJES_LEAD = [
    "Quería pediros más información sobre el diagnóstico inicial.",
    "¿Hacéis sesiones individuales para directivos?",
    "Tenemos un equipo de 25 personas, ¿qué nos recomendáis?",
    "He visto vuestro programa y me interesa para mi empresa.",
    "¿Cuál es el precio aproximado para una pyme?",
    "Necesitamos algo presencial en Madrid, ¿es posible?",
    "Solicito información sobre disponibilidad este trimestre.",
    "Vimos vuestro caso de éxito en LinkedIn, queremos hablar.",
  ];

  const leads = [];
  for (let i = 0; i < 80; i++) {
    const motivo = pick(MOTIVOS);
    const stage = i < 35 ? "new" : i < 65 ? "contacted" : "lost";
    const nombre = pick(NOMBRES_PILA) + " " + pick(APELLIDOS);
    const empresa = pick(EMPRESAS_GENERICAS);
    const customFields = { motivo };
    if (motivo === "servicios") customFields.servicio = pick(SERVICIOS);
    if (motivo === "cursos") customFields.curso = pick(CURSOS_LEAD);
    if (motivo === "talleres") customFields.taller = pick(TALLERES);
    if (motivo === "diagnostico") customFields.mensaje = pick(MENSAJES_LEAD);

    const l = await Lead.create({
      name: nombre,
      email: `${slugify(nombre.split(" ")[0])}.${slugify(nombre.split(" ")[1])}@${slugify(empresa.split(" ")[0])}.com`,
      phone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`,
      stage,
      source: pick(["web", "linkedin", "referido", "feria", "evento"]),
      notes: pick([
        "Contactó por el formulario de la web.",
        "Referido por cliente actual.",
        null,
        "Vino del evento de noviembre.",
        null,
      ]),
      customFields,
    });
    leads.push(l);
  }
  log(`✓ ${leads.length} leads (35 nuevos, 30 contactados, 15 perdidos)`);

  // ─── 9. Inventario (30) ──────────────────────────────────────────────────
  header("Creando productos de inventario...");
  const PRODUCTOS = [
    "Material formativo Pack Pro", "Kit Diagnóstico Empresarial",
    "Caja libros Liderazgo", "Set tarjetas Coaching",
    "Pack ejercicios Comunicación", "Material taller Equipos",
    "Manual Programa Ejecutivo", "Cuaderno trabajo Mentoría",
    "Suite digital Liderazgo", "Plataforma evaluación 360",
    "Pack starter consultoría", "Caja casos de estudio",
  ];
  const PROVEEDORES = ["Editorial Profesional", "Imprenta Vértice", "Distribuciones Norte", "BookSupply Iberia"];
  const EMBALAJES = ["Caja 10 unidades", "Pack 25", "Pallet 100", "Unidad", "Pack 50"];

  let invCount = 0;
  for (let i = 0; i < 12; i++) {
    const productName = pick(PRODUCTOS);
    const kg = rand(20, 250, 1);
    const purchasePrice = rand(15, 80, 2);
    const hasOutput = i < 5;
    const cliente = hasOutput ? clientes[i % clientes.length] : null;
    const outputKg = hasOutput ? rand(5, Math.floor(kg * 0.6), 1) : null;
    const salePrice = hasOutput ? +(purchasePrice * rand(13, 22, 1) / 10).toFixed(2) : null;
    const status = !hasOutput ? "stock" : (outputKg >= kg ? "sold" : "partial");

    await InventoryProduct.create({
      supplier: pick(PROVEEDORES),
      entryDate: daysAgo(rand(15, 180)),
      productName, units: rand(5, 30), kg, packaging: pick(EMBALAJES),
      lot: `D${rand(1000, 9999)}`,
      purchasePrice,
      outputName: hasOutput ? productName : null,
      clientId: cliente?.id ?? null,
      exitDate: hasOutput ? daysAgo(rand(1, 60)) : null,
      outputKg, salePrice, status,
    });
    invCount++;
  }
  for (let i = 0; i < 10; i++) {
    const productName = pick(PRODUCTOS);
    const kg = rand(15, 200, 1);
    const purchasePrice = rand(18, 90, 2);
    const salePrice = +(purchasePrice * rand(14, 23, 1) / 10).toFixed(2);
    await InventoryProduct.create({
      supplier: pick(PROVEEDORES),
      entryDate: daysAgo(rand(60, 300)),
      productName, units: rand(3, 15), kg, packaging: pick(EMBALAJES),
      lot: `D${rand(1000, 9999)}`,
      purchasePrice,
      outputName: productName,
      clientId: clientes[(i + 3) % clientes.length].id,
      exitDate: daysAgo(rand(5, 90)),
      outputKg: kg, salePrice,
      status: "sold",
    });
    invCount++;
  }
  for (let i = 0; i < 8; i++) {
    await InventoryProduct.create({
      supplier: pick(PROVEEDORES),
      entryDate: daysAgo(rand(1, 30)),
      productName: pick(PRODUCTOS),
      units: rand(3, 25), kg: rand(20, 300, 1),
      packaging: pick(EMBALAJES),
      lot: `D${rand(1000, 9999)}`,
      purchasePrice: rand(20, 100, 2),
      outputName: null, clientId: null, exitDate: null,
      outputKg: null, salePrice: null,
      status: "stock",
    });
    invCount++;
  }
  log(`✓ ${invCount} productos de inventario`);

  // ─── 10. Facturación (50 facturas, 60 pagos, 30 costes) ──────────────────
  header("Creando facturación (facturas, cobros, costes)...");

  const SERVICIO_LINEAS = [
    { desc: "Consultoría estratégica · 10h", price: 1200 },
    { desc: "Auditoría operativa · informe completo", price: 2500 },
    { desc: "Sesión coaching individual", price: 180 },
    { desc: "Programa formación equipo (8h)", price: 1800 },
    { desc: "Diagnóstico empresarial inicial", price: 950 },
    { desc: "Workshop liderazgo (1 día)", price: 2200 },
    { desc: "Mentoring trimestral (12 sesiones)", price: 3600 },
    { desc: "Plan estratégico anual", price: 4800 },
    { desc: "Material formativo licencia anual", price: 480 },
    { desc: "Acompañamiento mensual", price: 600 },
  ];

  let invNumber = 1000;
  const facturas = [];
  for (let i = 0; i < 50; i++) {
    const cliente = pick(clientes);
    const issueDate = daysAgo(rand(1, 365));
    const numLines = rand(1, 3);
    const lines = [];
    let subtotal = 0;
    for (let j = 0; j < numLines; j++) {
      const tpl = pick(SERVICIO_LINEAS);
      const qty = rand(1, 3);
      const lineTotal = tpl.price * qty;
      subtotal += lineTotal;
      lines.push({ description: tpl.desc, quantity: qty, unitPrice: tpl.price, total: lineTotal });
    }
    const vatRate = 21;
    const vatAmount = +(subtotal * vatRate / 100).toFixed(2);
    const total = subtotal + vatAmount;

    // Estado: 60% pagada, 20% enviada, 10% parcial, 5% draft, 5% overdue
    const r = Math.random();
    let status = "paid", paidAt = null;
    if (r < 0.05) status = "draft";
    else if (r < 0.10) status = "overdue";
    else if (r < 0.20) status = "partial";
    else if (r < 0.40) status = "sent";
    else { status = "paid"; paidAt = new Date(daysAgo(rand(0, 30))); }

    invNumber++;
    const inv = await Invoice.create({
      clientId: cliente.id,
      number: `F-2026-${String(invNumber).padStart(4, "0")}`,
      status, issueDate,
      dueDate: daysAgo(rand(-30, 30) - 15),
      paidAt,
      lines, subtotal, vatRate, vatAmount, total,
      notes: i % 7 === 0 ? "Servicio prestado conforme a contrato marco." : null,
    });
    facturas.push(inv);
  }
  log(`✓ ${facturas.length} facturas`);

  // Pagos: para cada factura paid + algunas partial
  let pagoCount = 0;
  for (const inv of facturas) {
    if (inv.status === "paid") {
      await Payment.create({
        invoiceId: inv.id,
        amount: inv.total,
        paidAt: inv.paidAt ?? new Date(),
        method: pick(["transfer", "card", "direct_debit"]),
        status: "completed",
        notes: null,
      });
      pagoCount++;
    } else if (inv.status === "partial") {
      const partialAmount = +(parseFloat(inv.total) * 0.5).toFixed(2);
      await Payment.create({
        invoiceId: inv.id,
        amount: partialAmount,
        paidAt: new Date(daysAgo(rand(5, 60))),
        method: pick(["transfer", "card"]),
        status: "completed",
        notes: "Pago parcial — pendiente segundo plazo",
      });
      pagoCount++;
    }
  }
  log(`✓ ${pagoCount} pagos registrados`);

  // Costes: 30 distribuidos en últimos 6 meses
  const COSTES_TPL = [
    { type: "salary", category: "fixed", desc: "Nómina equipo consultor", amount: [4500, 6800] },
    { type: "salary", category: "fixed", desc: "Nómina dirección", amount: [5200, 7500] },
    { type: "rent", category: "fixed", desc: "Alquiler oficina central", amount: [1800, 2400] },
    { type: "software", category: "fixed", desc: "Suite herramientas SaaS", amount: [180, 380] },
    { type: "software", category: "fixed", desc: "Licencias CRM y email", amount: [120, 240] },
    { type: "material", category: "variable", desc: "Material formación", amount: [200, 800] },
    { type: "material", category: "variable", desc: "Edición manuales", amount: [400, 1200] },
    { type: "commission", category: "variable", desc: "Comisiones comerciales", amount: [600, 2400] },
    { type: "other", category: "variable", desc: "Desplazamientos cliente", amount: [180, 700] },
    { type: "other", category: "fixed", desc: "Suministros oficina", amount: [80, 180] },
  ];
  let costCount = 0;
  for (let m = 0; m < 6; m++) {
    const month = monthAgo(m);
    const numCostsThisMonth = rand(4, 6);
    for (let k = 0; k < numCostsThisMonth; k++) {
      const tpl = pick(COSTES_TPL);
      await Cost.create({
        month, type: tpl.type, category: tpl.category, description: tpl.desc,
        amount: rand(tpl.amount[0], tpl.amount[1], 2),
      });
      costCount++;
    }
  }
  log(`✓ ${costCount} costes (últimos 6 meses)`);

  // ─── 11. Formación ──────────────────────────────────────────────────────
  header("Creando módulo formación (empresas, cursos, alumnos)...");

  // Empresas (15)
  const empresasFormacion = [];
  for (let i = 0; i < 15; i++) {
    const c = await Company.create({
      name: i < EMPRESAS_GENERICAS.length ? EMPRESAS_GENERICAS[i] : `Grupo ${pick(APELLIDOS)} S.L.`,
      active: true,
      settings: {
        sector: pick(["Tecnología", "Industria", "Servicios", "Salud", "Educación", "Retail"]),
        size: pick(["pyme", "mediana", "grande"]),
      },
    });
    empresasFormacion.push(c);
  }
  log(`✓ ${empresasFormacion.length} empresas formación`);

  // Cursos (8)
  const CURSOS = [
    "Liderazgo y gestión de equipos",
    "Comunicación efectiva ejecutiva",
    "Inteligencia emocional aplicada",
    "Gestión del cambio organizacional",
    "Negociación avanzada",
    "Toma de decisiones bajo presión",
    "Pensamiento estratégico",
    "Productividad y gestión del tiempo",
  ];
  const cursos = [];
  for (let i = 0; i < CURSOS.length; i++) {
    const c = await Course.create({
      name: CURSOS[i],
      active: i < 7,
    });
    cursos.push(c);
  }
  log(`✓ ${cursos.length} cursos`);

  // Alumnos (60) — 80% en empresas, 20% privados
  const trainingUsers = [];
  for (let i = 0; i < 60; i++) {
    const isCompany = Math.random() < 0.8;
    const empresa = isCompany ? pick(empresasFormacion) : null;
    const nombre = pick(NOMBRES_PILA);
    const apellido = pick(APELLIDOS);
    const u = await TrainingUser.create({
      companyId: empresa?.id ?? null,
      type: isCompany ? "company" : "private",
      name: nombre,
      lastName: apellido,
      email: `${slugify(nombre)}.${slugify(apellido)}${i}@${empresa ? slugify(empresa.name.split(" ")[0]) : "alumno"}.com`,
      country: "España",
      active: true,
    });
    trainingUsers.push(u);
  }
  log(`✓ ${trainingUsers.length} alumnos (80% empresas, 20% privados)`);

  // Matrículas (~120 — cada alumno en 1-3 cursos)
  let enrollCount = 0;
  for (const u of trainingUsers) {
    const numCursos = rand(1, 3);
    const cursosAlumno = new Set();
    while (cursosAlumno.size < numCursos) cursosAlumno.add(pick(cursos).id);
    for (const courseId of cursosAlumno) {
      await CourseEnrollment.create({
        trainingUserId: u.id,
        courseId,
        companyId: u.companyId,
        enrolledAt: new Date(daysAgo(rand(1, 250))),
      });
      enrollCount++;
    }
  }
  log(`✓ ${enrollCount} matrículas`);

  // Intentos de cuestionarios (80 sobre alumnos aleatorios)
  let quizCount = 0;
  // wpAttemptId es INTEGER UNIQUE. Minutos desde epoch (~29M en 2026) cabe en INT32
  const baseId = Math.floor(Date.now() / 60000);
  for (let i = 0; i < 80; i++) {
    const u = pick(trainingUsers);
    const earned = rand(45, 100, 0);
    const courseTitle = pick(CURSOS);
    await QuizAttempt.create({
      wpAttemptId: baseId + i,
      wpQuizId: rand(1000, 9999),
      wpCourseId: rand(100, 999),
      wpUserId: rand(1, 999),
      studentEmail: u.email,
      studentName: `${u.name} ${u.lastName}`,
      quizTitle: pick([`Evaluación final · ${courseTitle}`, `Test módulo ${rand(1, 5)}`, "Quiz de progreso"]),
      courseTitle,
      attemptDate: new Date(daysAgo(rand(1, 200))),
      totalQuestions: 10,
      totalPoints: 100,
      earnedPoints: earned,
      passingPoints: 60,
      correctAnswers: Math.round(earned / 10),
      incorrectAnswers: 10 - Math.round(earned / 10),
      result: earned >= 60 ? "pass" : "fail",
    });
    quizCount++;
  }
  log(`✓ ${quizCount} intentos de cuestionarios`);

  // ─── 12. Resumen ──────────────────────────────────────────────────────────
  invalidateTenantCache(SLUG);

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ¡Demo lista! Credenciales de acceso\n");
  process.stdout.write("══════════════════════════════════════════════════\n");
  process.stdout.write(`  Tenant:     ${SLUG}\n`);
  process.stdout.write(`  Email:      ${ADMIN_EMAIL}\n`);
  process.stdout.write(`  Contraseña: ${ADMIN_PASSWORD}\n`);
  process.stdout.write(`  Módulos:    ${MODULES.join(", ")}\n`);
  process.stdout.write(`  Brand:      primary=${BRAND.primaryColor} accent=${BRAND.accentColor}\n`);
  process.stdout.write("══════════════════════════════════════════════════\n");
  process.stdout.write(` Datos cargados:\n`);
  process.stdout.write(`  · 40 clientes con interacciones\n`);
  process.stdout.write(`  · 80 leads (motivos: diagnóstico/servicios/cursos/talleres)\n`);
  process.stdout.write(`  · 30 productos inventario\n`);
  process.stdout.write(`  · 50 facturas + ${pagoCount} pagos + ${costCount} costes\n`);
  process.stdout.write(`  · 15 empresas + 8 cursos + 60 alumnos + ${enrollCount} matrículas\n`);
  process.stdout.write(`  · ${quizCount} intentos de cuestionarios\n`);
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
