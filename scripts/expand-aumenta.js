/**
 * expand-aumenta.js — Activa todos los módulos restantes (sin overrides)
 * en el tenant `aumenta` y siembra datos demo coherentes con su sector
 * (psicología y formación).
 *
 * Módulos activados (8):
 *   clients, calendar, citas, projects, billing, team, inventory, orders
 *
 * NO toca leads (ya existe con override) ni training (excluido por
 * decisión de negocio).
 *
 * Idempotente: re-ejecutable sin duplicar módulos, pero los datos demo
 * se vuelven a insertar (cada ejecución añade ~N filas más). Para
 * resetear datos, vaciar el schema crm_aumenta a mano.
 *
 * Uso: node --env-file=.env.local scripts/expand-aumenta.js
 */

import { Sequelize } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

const SLUG = "aumenta";
const SCHEMA = `crm_${SLUG}`;
const NEW_MODULES = [
  "clients",
  "calendar",
  "citas",
  "projects",
  "billing",
  "team",
  "inventory",
  "orders",
];

// ─── Helpers ────────────────────────────────────────────────────────────────
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
function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// ─── Datos sectoriales (psicología y formación) ──────────────────────────────
const NOMBRES = ["Carmen", "Roberto", "Lucía", "Andrés", "Mónica", "Javier", "Natalia", "Daniel", "Sara", "Pablo", "Beatriz", "Sergio", "Marta", "Adrián", "Elena"];
const APELLIDOS = ["Soler", "Fuentes", "Marín", "Castellano", "Herrero", "Pizarro", "Guerrero", "Crespo", "Romero", "Navarro", "Jiménez", "Vázquez", "Ortiz", "Delgado", "Cano"];

const EMPRESAS_CLIENTE = [
  "Centro Educativo Aurora",
  "Clínica Psicológica Bienestar",
  "Academia Formativa Norte",
  "Fundación Apoyo Familiar",
  "Centro de Día Mediterráneo",
  "Colegio Las Palmeras",
  "Gabinete Psicoeducativo Avanza",
  "Escuela Infantil El Roble",
];

const PROVEEDORES = [
  "Editorial Pedagógica S.L.",
  "Material Didáctico Ibérica",
  "Distribuidora de Libros Educa",
  "Papelería Profesional Madrid",
];

const SERVICIOS = [
  { desc: "Sesión de mentoría individual (60min)", price: 75 },
  { desc: "Curso intensivo de liderazgo (8h)", price: 380 },
  { desc: "Taller productividad personal (4h)", price: 180 },
  { desc: "Programa formativo trimestral", price: 990 },
  { desc: "Diagnóstico competencias digitales", price: 250 },
  { desc: "Pack 10 sesiones acompañamiento", price: 650 },
  { desc: "Workshop gestión del estrés (1 día)", price: 420 },
];

const ROLES_EQUIPO = [
  { position: "Psicóloga", department: "Clínica" },
  { position: "Coordinadora Formación", department: "Formación" },
  { position: "Coach ejecutivo", department: "Mentoring" },
  { position: "Administración", department: "Soporte" },
  { position: "Responsable Comercial", department: "Ventas" },
];

const CALENDAR_TITLES = [
  "Reunión equipo semanal",
  "Sesión con cliente VIP",
  "Preparación taller productividad",
  "Llamada seguimiento cliente",
  "Revisión planificación mes",
  "Visita centro educativo Aurora",
  "Sesión coaching ejecutivo",
  "Diseño nuevo curso de liderazgo",
];

const PROYECTOS = [
  { name: "Programa formación 2026 — Colegio Aurora", description: "Diseño e impartición de 4 módulos formativos." },
  { name: "Diagnóstico clima laboral — Clínica Bienestar", description: "Evaluación inicial + plan de mejora a 6 meses." },
  { name: "Mentoring directivos — Academia Norte", description: "Acompañamiento individual a 5 directivos durante 3 meses." },
  { name: "Material didáctico digital", description: "Conversión de manuales en formato interactivo." },
  { name: "Renovación web corporativa", description: "Migración a Next.js con CMS propio." },
];

const EVENT_TYPES = [
  { name: "Primera consulta", slug: "primera-consulta", duration: 60, color: "#3B82F6", modalities: ["presencial", "online"], description: "Consulta inicial de valoración." },
  { name: "Sesión seguimiento", slug: "sesion-seguimiento", duration: 45, color: "#10B981", modalities: ["presencial", "online", "phone"], description: "Sesión de continuidad." },
  { name: "Mentoría directivos", slug: "mentoria-directivos", duration: 90, color: "#F59E0B", modalities: ["online"], description: "Sesión de mentoría 1:1." },
];

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write("  expand-aumenta — Activar módulos + datos demo    \n");
  process.stdout.write("══════════════════════════════════════════════════\n");

  // ─── 1. Conexión master + tenant ────────────────────────────────────────
  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`\n✗ Tenant '${SLUG}' no encontrado. Ejecuta primero seed-aumenta.js\n`);
    process.exit(1);
  }
  log(`✓ Tenant '${SLUG}' (id: ${tenant.id})`);

  // ─── 2. Schema PostgreSQL ────────────────────────────────────────────────
  header(`Asegurando schema "${SCHEMA}"...`);
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await rawDb.close();
  log(`✓ Schema "${SCHEMA}" listo`);

  // ─── 3. Activar módulos sin overrides ────────────────────────────────────
  header("Activando módulos (sin overrides)...");
  for (const moduleKey of NEW_MODULES) {
    const [mod, created] = await TenantModule.findOrCreate({
      where: { tenantId: tenant.id, moduleKey },
      defaults: {
        tenantId: tenant.id,
        moduleKey,
        enabled: true,
        version: "1.0.0",
        schemaExtensions: {},
        logicOverrides: {},
        uiOverride: null,
        featureFlags: {},
      },
    });
    if (!created && (!mod.enabled || mod.uiOverride)) {
      await mod.update({ enabled: true, uiOverride: null });
    }
    log(`${created ? "✓ Creado" : "· Ya existía"} módulo "${moduleKey}"`);
  }

  // ─── 4. Sync de tablas del tenant ────────────────────────────────────────
  // Usamos {alter:true} para añadir columnas/índices que falten en tablas
  // ya existentes (caso de schemas tenant viejos como crm_aumenta en prod,
  // donde Project no tenía aún la columna `code`).
  header(`Sincronizando tablas en ${SCHEMA}...`);
  const { sequelize: tenantSeq, models } = getTenantDb(SLUG);
  await tenantSeq.sync({ alter: true });
  log("✓ Tablas sincronizadas");

  invalidateTenantCache(SLUG);

  const {
    Client, TeamMember, Project, Invoice, Payment, Cost,
    CalendarTask, EventType, Booking,
    InboundProduct, InboundBatch, OutboundProduct,
    Order, OrderLine, Asset,
  } = models;

  // ─── 5. Datos demo ──────────────────────────────────────────────────────

  // 5.1 — Clientes (10)
  header("Creando clientes...");
  const clientes = [];
  for (let i = 0; i < 10; i++) {
    const isCompany = i < 7;
    const name = isCompany
      ? pick(EMPRESAS_CLIENTE) + " " + (i + 1)
      : `${pick(NOMBRES)} ${pick(APELLIDOS)}`;
    const c = await Client.create({
      type: isCompany ? "company" : "individual",
      name,
      email: `${slugify(name).slice(0, 18)}@${isCompany ? "empresa" : "gmail"}.com`,
      phone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`,
      taxId: isCompany ? `B${rand(10000000, 99999999)}` : null,
      status: pick(["active", "active", "active", "prospect"]),
      fiscalName: isCompany ? name : null,
      fiscalAddress: isCompany ? `C/ ${pick(["Mayor", "Real", "Gran Vía", "Castellana"])}, ${rand(1, 200)}` : null,
      fiscalCity: pick(["Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao"]),
      fiscalZip: String(rand(28000, 48999)),
      fiscalCountry: "ES",
      notes: i % 4 === 0 ? "Cliente clave. Revisión trimestral." : null,
      customFields: { sector: pick(["Educación", "Salud", "Consultoría", "Industria"]) },
    });
    clientes.push(c);
  }
  log(`✓ ${clientes.length} clientes`);

  // 5.2 — Equipo (5)
  header("Creando equipo (TeamMember)...");
  const equipo = [];
  for (let i = 0; i < ROLES_EQUIPO.length; i++) {
    const rol = ROLES_EQUIPO[i];
    const nombre = pick(NOMBRES);
    const apellido = pick(APELLIDOS);
    const displayName = `${nombre} ${apellido}`;
    const m = await TeamMember.create({
      displayName,
      email: `${slugify(nombre)}.${slugify(apellido)}${i}@aumenta.es`,
      position: rol.position,
      department: rol.department,
      phone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`,
      hourlyCost: rand(15, 35, 2),
      hourlyRate: rand(45, 90, 2),
      monthlySalary: rand(1800, 3200, 2),
      status: "active",
      hiredAt: daysAgo(rand(60, 1200)),
    });
    equipo.push(m);
  }
  log(`✓ ${equipo.length} miembros del equipo`);

  // 5.3 — Proyectos (5)
  header("Creando proyectos...");
  const proyectos = [];
  for (let i = 0; i < PROYECTOS.length; i++) {
    const p = PROYECTOS[i];
    const cliente = pick(clientes);
    const start = daysAgo(rand(15, 90));
    const due = daysAgo(rand(-60, -15));
    const proj = await Project.create({
      code: `PRY-2026-${String(i + 1).padStart(4, "0")}`,
      clientId: cliente.id,
      name: p.name,
      description: p.description,
      status: pick(["active", "active", "draft", "completed"]),
      priority: pick(["medium", "high", "medium", "low"]),
      startDate: start,
      dueDate: due,
      budgetAmount: rand(3000, 15000, 2),
      budgetCurrency: "EUR",
      estimatedHours: rand(40, 200, 2),
      tags: pick([["formación"], ["consultoría"], ["mentoring"], ["formación", "digital"]]),
    });
    proyectos.push(proj);
  }
  log(`✓ ${proyectos.length} proyectos`);

  // 5.4 — Calendar tasks (12)
  header("Creando eventos de calendario...");
  let calCount = 0;
  for (let i = 0; i < 12; i++) {
    await CalendarTask.create({
      title: pick(CALENDAR_TITLES),
      notes: pick(["Recordar preparar el guion.", null, "Confirmar asistencia 24h antes.", null]),
      priority: pick(["high", "medium", "medium", "low"]),
      status: pick(["pending", "pending", "done"]),
      startDate: daysAgo(rand(-30, 30)),
      startTime: `${String(rand(9, 18)).padStart(2, "0")}:${pick(["00", "15", "30", "45"])}:00`,
      endDate: null,
      endTime: null,
      allDay: false,
      color: pick(["#3B82F6", "#10B981", "#F59E0B", "#EF4444"]),
    });
    calCount++;
  }
  log(`✓ ${calCount} eventos de calendario`);

  // 5.5 — Citas (EventType + Booking)
  header("Creando tipos de cita y reservas...");
  const eventTypes = [];
  for (const et of EVENT_TYPES) {
    const [e] = await EventType.findOrCreate({
      where: { slug: et.slug },
      defaults: {
        ...et,
        bufferBefore: 5,
        bufferAfter: 5,
        active: true,
        order: eventTypes.length,
        location: et.modalities.includes("presencial") ? "C/ Gran Vía 42, Madrid" : null,
        meetUrl: et.modalities.includes("online") ? "https://meet.google.com/abc-defg-hij" : null,
        phoneNumber: et.modalities.includes("phone") ? "+34 911 234 567" : null,
        minNoticeHours: 3,
        maxAdvanceDays: 60,
      },
    });
    eventTypes.push(e);
  }
  log(`✓ ${eventTypes.length} tipos de cita`);

  let bookingCount = 0;
  for (let i = 0; i < 15; i++) {
    const et = pick(eventTypes);
    const modality = pick(et.modalities);
    const dayOffset = rand(-20, 20);
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    date.setHours(rand(9, 18), pick([0, 15, 30, 45]), 0, 0);
    const status = dayOffset < 0
      ? pick(["completed", "completed", "no_show", "cancelled"])
      : "confirmed";
    await Booking.create({
      eventTypeId: et.id,
      clientName: `${pick(NOMBRES)} ${pick(APELLIDOS)}`,
      clientEmail: `cliente${i}@example.com`,
      clientPhone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`,
      scheduledAt: date,
      duration: et.duration,
      modality,
      meetUrl: modality === "online" ? et.meetUrl : null,
      status,
      notes: i % 3 === 0 ? "Cliente derivado por colaborador." : null,
    });
    bookingCount++;
  }
  log(`✓ ${bookingCount} reservas`);

  // 5.6 — Inventario (productos formativos)
  header("Creando inventario (materiales formativos)...");
  const INBOUND_NAMES = [
    { name: "Cuaderno de ejercicios", tags: ["material", "papel"] },
    { name: "Libro de lectura formativa", tags: ["material", "libro"] },
    { name: "Pack bolígrafos premium", tags: ["material", "escritorio"] },
    { name: "Memorias USB 32GB", tags: ["material", "digital"] },
    { name: "Manual del formador", tags: ["material", "libro"] },
  ];
  const inboundProducts = [];
  for (const ip of INBOUND_NAMES) {
    const p = await InboundProduct.create({
      name: ip.name,
      tags: ip.tags,
      notes: null,
    });
    inboundProducts.push(p);
    const kg = rand(20, 200, 2);
    await InboundBatch.create({
      inboundProductId: p.id,
      supplier: pick(PROVEEDORES),
      lot: `LOT-${rand(1000, 9999)}`,
      entryDate: daysAgo(rand(10, 180)),
      kg,
      kgRemaining: rand(5, kg, 2),
      packaging: pick(["caja 50u", "pallet", "saco 25kg", "caja 100u"]),
      purchasePrice: rand(50, 500, 2),
    });
  }
  log(`✓ ${inboundProducts.length} productos entrantes + lote inicial cada uno`);

  const OUTBOUND_NAMES = [
    { name: "Kit Formación Inicial", tags: ["kit", "alumno"], price: 35 },
    { name: "Pack Mentoring Premium", tags: ["kit", "mentoring"], price: 120 },
    { name: "Material Curso Liderazgo", tags: ["kit", "liderazgo"], price: 65 },
  ];
  const outboundProducts = [];
  for (const op of OUTBOUND_NAMES) {
    const p = await OutboundProduct.create({
      name: op.name,
      tags: op.tags,
      defaultSalePrice: op.price,
    });
    outboundProducts.push(p);
  }
  log(`✓ ${outboundProducts.length} productos salientes`);

  // 5.7 — Activos internos (Asset)
  header("Creando activos internos...");
  const ASSETS = [
    { type: "hardware", name: "MacBook Pro 14\"", serial: "SN-MBP-001", value: 2400 },
    { type: "hardware", name: "iPad Pro 12.9\"", serial: "SN-IPAD-001", value: 1300 },
    { type: "software", name: "Licencia Office 365", serial: "L-OFF-2026", value: 99 },
    { type: "license", name: "Adobe Creative Cloud", serial: "L-ADC-2026", value: 600 },
    { type: "material", name: "Proyector portátil", serial: "PR-001", value: 450 },
  ];
  for (const a of ASSETS) {
    await Asset.create({
      type: a.type,
      name: a.name,
      serialNumber: a.serial,
      status: pick(["available", "assigned", "available"]),
      assignedTo: Math.random() < 0.6 ? pick(equipo).id : null,
      purchaseDate: daysAgo(rand(30, 800)),
      value: a.value,
    });
  }
  log(`✓ ${ASSETS.length} activos internos`);

  // 5.8 — Facturación (12 facturas + cobros + 10 costes)
  header("Creando facturación...");
  let invNumber = 1000;
  const facturas = [];
  for (let i = 0; i < 12; i++) {
    const cli = pick(clientes);
    const issueDate = daysAgo(rand(1, 180));
    const numLines = rand(1, 3);
    const lines = [];
    let taxBase = 0;
    let vatAmount = 0;
    for (let j = 0; j < numLines; j++) {
      const s = pick(SERVICIOS);
      const qty = rand(1, 3);
      const lineBase = +(s.price * qty).toFixed(2);
      const vatRate = 21;
      const lineVat = +((lineBase * vatRate) / 100).toFixed(2);
      const lineTotal = +(lineBase + lineVat).toFixed(2);
      taxBase += lineBase;
      vatAmount += lineVat;
      lines.push({
        description: s.desc,
        quantity: qty,
        unitPrice: s.price,
        discountPct: 0,
        vatRate,
        lineBase,
        lineVat,
        lineTotal,
      });
    }
    const total = +(taxBase + vatAmount).toFixed(2);
    const r = Math.random();
    let status = "paid", paidAt = null, paidAmount = 0;
    if (r < 0.10) status = "draft";
    else if (r < 0.20) status = "overdue";
    else if (r < 0.30) { status = "partially_paid"; paidAmount = +(total * 0.5).toFixed(2); }
    else if (r < 0.50) status = "sent";
    else { status = "paid"; paidAt = new Date(daysAgo(rand(0, 30))); paidAmount = total; }

    invNumber++;
    const inv = await Invoice.create({
      clientId: cli.id,
      employeeId: pick(equipo).id,
      series: "F",
      number: `F-2026-${String(invNumber).padStart(4, "0")}`,
      status,
      issueDate,
      dueDate: daysAgo(rand(-30, 30) - 15),
      paidAt,
      lines,
      taxBase: +taxBase.toFixed(2),
      vatAmount: +vatAmount.toFixed(2),
      total,
      paidAmount,
      subtotal: +taxBase.toFixed(2),
      vatRate: 21,
    });
    facturas.push(inv);
  }
  log(`✓ ${facturas.length} facturas`);

  let pagoCount = 0;
  for (const inv of facturas) {
    if (inv.status === "paid") {
      await Payment.create({
        invoiceId: inv.id,
        amount: inv.total,
        paidAt: inv.paidAt ?? new Date(),
        method: pick(["transfer", "card", "direct_debit"]),
        status: "completed",
      });
      pagoCount++;
    } else if (inv.status === "partially_paid") {
      await Payment.create({
        invoiceId: inv.id,
        amount: inv.paidAmount,
        paidAt: new Date(daysAgo(rand(5, 60))),
        method: pick(["transfer", "card"]),
        status: "completed",
        notes: "Pago parcial",
      });
      pagoCount++;
    }
  }
  log(`✓ ${pagoCount} cobros`);

  const COSTES_TPL = [
    { type: "salary", category: "fixed", desc: "Nómina equipo formación", amount: [1800, 3000] },
    { type: "rent", category: "fixed", desc: "Alquiler oficina centro Madrid", amount: [1200, 1800] },
    { type: "software", category: "fixed", desc: "Licencias SaaS", amount: [80, 250] },
    { type: "material", category: "variable", desc: "Material formativo", amount: [150, 600] },
    { type: "commission", category: "variable", desc: "Comisiones colaboradores", amount: [200, 800] },
  ];
  let costCount = 0;
  for (let m = 0; m < 5; m++) {
    for (let k = 0; k < 2; k++) {
      const tpl = pick(COSTES_TPL);
      const taxBase = rand(tpl.amount[0], tpl.amount[1], 2);
      const vatRate = 21;
      const taxAmount = +((taxBase * vatRate) / 100).toFixed(2);
      await Cost.create({
        type: tpl.type,
        category: tpl.category,
        description: tpl.desc,
        taxBase,
        vatRate,
        taxAmount,
        total: +(taxBase + taxAmount).toFixed(2),
        vatDeductible: true,
        incurredAt: daysAgo(m * 30 + rand(1, 25)),
        employeeId: tpl.type === "salary" ? pick(equipo).id : null,
      });
      costCount++;
    }
  }
  log(`✓ ${costCount} costes`);

  // 5.9 — Pedidos (8)
  header("Creando pedidos...");
  let orderCount = 0;
  for (let i = 0; i < 8; i++) {
    const cli = pick(clientes);
    const numLines = rand(1, 3);
    const linesData = [];
    let subtotal = 0;
    for (let j = 0; j < numLines; j++) {
      const op = pick(outboundProducts);
      const qty = rand(1, 5);
      const unitPrice = Number(op.defaultSalePrice);
      const lineTotal = +(unitPrice * qty).toFixed(2);
      subtotal += lineTotal;
      linesData.push({ outboundProductId: op.id, productName: op.name, quantity: qty, unitPrice, lineTotal });
    }
    const transport = rand(0, 30, 2);
    const order = await Order.create({
      clientId: cli.id,
      status: pick(["draft", "confirmed", "preparing", "shipped", "completed"]),
      subtotal: +subtotal.toFixed(2),
      transportAmount: transport,
      total: +(subtotal + transport).toFixed(2),
      scheduledDate: daysAgo(rand(-20, 5)),
      notes: i % 4 === 0 ? "Entrega antes del inicio del curso." : null,
    });
    for (const ld of linesData) {
      await OrderLine.create({ orderId: order.id, ...ld });
    }
    orderCount++;
  }
  log(`✓ ${orderCount} pedidos con líneas`);

  // ─── 6. Resumen ──────────────────────────────────────────────────────────
  invalidateTenantCache(SLUG);
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Aumenta ampliado con 8 módulos + datos\n");
  process.stdout.write("══════════════════════════════════════════════════\n");
  process.stdout.write(`  Tenant:     ${SLUG}\n`);
  process.stdout.write(`  Módulos:    leads (existente) + ${NEW_MODULES.join(", ")}\n`);
  process.stdout.write(`  Datos:      ${clientes.length} clientes · ${equipo.length} equipo · ${proyectos.length} proyectos\n`);
  process.stdout.write(`              ${calCount} eventos cal · ${eventTypes.length} tipos cita · ${bookingCount} reservas\n`);
  process.stdout.write(`              ${inboundProducts.length} inbound · ${outboundProducts.length} outbound · ${ASSETS.length} activos\n`);
  process.stdout.write(`              ${facturas.length} facturas · ${pagoCount} cobros · ${costCount} costes\n`);
  process.stdout.write(`              ${orderCount} pedidos\n`);
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  try { await closeAllConnections(); } catch {}
  process.exit(1);
});
