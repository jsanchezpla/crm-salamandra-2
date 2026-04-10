/**
 * db-seed.js — Migra columnas nuevas y siembra datos de prueba
 *
 * 1. Altera el schema tenant con las columnas nuevas (billing)
 * 2. Crea terapeutas, clientes, tarifas, facturas, cobros y costes realistas
 *
 * Uso: npm run db:seed
 */

import { randomUUID } from "crypto";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const DEMO_SLUG = "demo";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

// ─── Helpers de fecha ────────────────────────────────────────────────────────

function date(y, m, d) {
  return new Date(y, m - 1, d);
}

function isoDate(y, m, d) {
  return date(y, m, d).toISOString().slice(0, 10);
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Salamandra CRM — Seed de datos demo    \n");
  process.stdout.write("════════════════════════════════════════\n");

  // ── 1. Migrate schema con alter ────────────────────────────────────────────
  header("Migrando columnas nuevas (alter: true)...");
  getMasterDb();
  const { sequelize: tenantSeq } = getTenantDb(DEMO_SLUG);
  await tenantSeq.sync({ alter: true });
  log("✓ Schema crm_demo actualizado con todas las columnas");

  // ── 2. Obtener modelos ──────────────────────────────────────────────────────
  header("Cargando modelos...");
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: DEMO_SLUG } });
  if (!tenant) throw new Error("Tenant demo no encontrado. Ejecuta npm run db:sync primero.");

  const { models } = getTenantDb(DEMO_SLUG);
  const { Client, TeamMember, Invoice, Payment, Rate, Cost } = models;

  // ── 3. Terapeutas ───────────────────────────────────────────────────────────
  header("Creando terapeutas...");

  const therapistsData = [
    { displayName: "Ana García", position: "Terapeuta Infantil", department: "Infantil" },
    { displayName: "Carlos López", position: "Psicólogo Adultos", department: "Adultos" },
    { displayName: "Laura Martínez", position: "Neuropsicóloga", department: "Neuropsicología" },
    { displayName: "Miguel Sánchez", position: "Terapeuta Familiar", department: "Familia" },
  ];

  const therapists = [];
  for (const t of therapistsData) {
    const [member, created] = await TeamMember.findOrCreate({
      where: { displayName: t.displayName },
      defaults: { ...t, userId: randomUUID(), status: "active", customFields: {} },
    });
    therapists.push(member);
    log(`${created ? "✓" : "·"} ${t.displayName}`);
  }

  // ── 4. Tarifas ──────────────────────────────────────────────────────────────
  header("Creando tarifas...");

  // Tarifa general del centro
  const ratesData = [
    // Tarifa general
    { therapistId: null, serviceType: "sesion_individual", pricePerSession: 75.00, validFrom: isoDate(2026, 1, 1) },
    { therapistId: null, serviceType: "sesion_pareja", pricePerSession: 90.00, validFrom: isoDate(2026, 1, 1) },
    { therapistId: null, serviceType: "sesion_familiar", pricePerSession: 100.00, validFrom: isoDate(2026, 1, 1) },
    { therapistId: null, serviceType: "evaluacion", pricePerSession: 150.00, validFrom: isoDate(2026, 1, 1) },
    // Tarifa específica Ana (especialista infantil, precio distinto)
    { therapistId: therapists[0].id, serviceType: "sesion_infantil", pricePerSession: 80.00, validFrom: isoDate(2026, 1, 1) },
    // Tarifa específica Laura (neuropsicología)
    { therapistId: therapists[2].id, serviceType: "evaluacion", pricePerSession: 200.00, validFrom: isoDate(2026, 1, 1) },
  ];

  for (const r of ratesData) {
    await Rate.findOrCreate({
      where: {
        therapistId: r.therapistId ?? null,
        serviceType: r.serviceType,
        validFrom: r.validFrom,
      },
      defaults: { ...r, packConfig: {}, validTo: null },
    });
  }
  log(`✓ ${ratesData.length} tarifas creadas`);

  // ── 5. Clientes ─────────────────────────────────────────────────────────────
  header("Creando clientes...");

  const clientsData = [
    { name: "Familia Rodríguez", email: "rodriguez@gmail.com", phone: "611 234 567", type: "company", customFields: {} },
    { name: "Familia Torres", email: "torres@hotmail.com", phone: "622 345 678", type: "company", customFields: {} },
    { name: "Pedro Alonso", email: "pedro.alonso@gmail.com", phone: "633 456 789", type: "individual", customFields: {} },
    { name: "Carmen Vega", email: "carmen.vega@gmail.com", phone: "644 567 890", type: "individual", customFields: {} },
    { name: "Roberto Iglesias", email: "r.iglesias@empresa.es", phone: "655 678 901", type: "individual", customFields: {} },
    { name: "Familia Moreno", email: "moreno.familia@gmail.com", phone: "666 789 012", type: "company", customFields: {} },
    { name: "Sofía Castro", email: "sofia.castro@gmail.com", phone: "677 890 123", type: "individual", customFields: {} },
    { name: "Andrés Jiménez", email: "andres.j@gmail.com", phone: "688 901 234", type: "individual", customFields: {} },
  ];

  const clients = [];
  for (const c of clientsData) {
    const [client, created] = await Client.findOrCreate({
      where: { email: c.email },
      defaults: { ...c, status: "active" },
    });
    clients.push(client);
    log(`${created ? "✓" : "·"} ${c.name}`);
  }

  // ── 6. Facturas ─────────────────────────────────────────────────────────────
  header("Creando facturas e invoices...");

  const serviceTypes = ["sesion_individual", "sesion_pareja", "sesion_familiar", "evaluacion", "sesion_infantil"];
  const invoiceTypes = ["session", "pack", "session"];

  let invoiceCount = 0;
  const createdInvoices = [];

  // Enero a Marzo: facturas pagadas
  for (let month = 1; month <= 3; month++) {
    for (const therapist of therapists) {
      const clientsForMonth = clients.slice(0, randomBetween(3, 6));

      for (const client of clientsForMonth) {
        const svcType = pick(serviceTypes);
        const pricePerUnit = svcType === "evaluacion" ? 150 : svcType === "sesion_pareja" ? 90 : 75;
        const qty = randomBetween(1, 4);
        const total = pricePerUnit * qty;
        const dayOfMonth = randomBetween(1, 25);

        const [inv, created] = await Invoice.findOrCreate({
          where: {
            clientId: client.id,
            therapistId: therapist.id,
            issueDate: isoDate(2026, month, dayOfMonth),
          },
          defaults: {
            number: `F-2026-${String(++invoiceCount).padStart(4, "0")}`,
            clientId: client.id,
            therapistId: therapist.id,
            serviceType: svcType,
            invoiceType: pick(invoiceTypes),
            issueDate: isoDate(2026, month, dayOfMonth),
            dueDate: isoDate(2026, month + 1, 5),
            lines: [{ description: svcType.replace(/_/g, " "), qty, unitPrice: pricePerUnit }],
            subtotal: total,
            vatRate: 0,
            vatAmount: 0,
            discountAmount: 0,
            total,
            status: "paid",
            paidAt: isoDate(2026, month, dayOfMonth + randomBetween(1, 7)),
            customFields: {},
            recurringConfig: {},
          },
        });
        if (created) createdInvoices.push(inv);
      }
    }
  }

  // Abril (mes actual): mix de estados
  for (const therapist of therapists) {
    const clientsForMonth = clients.slice(0, randomBetween(4, 7));
    for (const client of clientsForMonth) {
      const svcType = pick(serviceTypes);
      const pricePerUnit = svcType === "evaluacion" ? 150 : svcType === "sesion_pareja" ? 90 : 75;
      const qty = randomBetween(1, 3);
      const total = pricePerUnit * qty;
      const dayOfMonth = randomBetween(1, 8);
      const status = pick(["sent", "sent", "paid", "partial", "draft"]);

      const [inv, created] = await Invoice.findOrCreate({
        where: {
          clientId: client.id,
          therapistId: therapist.id,
          issueDate: isoDate(2026, 4, dayOfMonth),
        },
        defaults: {
          number: `F-2026-${String(++invoiceCount).padStart(4, "0")}`,
          clientId: client.id,
          therapistId: therapist.id,
          serviceType: svcType,
          invoiceType: "session",
          issueDate: isoDate(2026, 4, dayOfMonth),
          dueDate: isoDate(2026, 4, dayOfMonth + 15),
          lines: [{ description: svcType.replace(/_/g, " "), qty, unitPrice: pricePerUnit }],
          subtotal: total,
          vatRate: 0,
          vatAmount: 0,
          discountAmount: 0,
          total,
          status,
          paidAt: status === "paid" ? isoDate(2026, 4, dayOfMonth + 2) : null,
          customFields: {},
          recurringConfig: {},
        },
      });
      if (created) createdInvoices.push(inv);
    }
  }

  log(`✓ ${invoiceCount} facturas creadas`);

  // ── 7. Cobros para facturas pagadas ─────────────────────────────────────────
  header("Creando cobros...");

  const methods = ["card", "transfer", "cash", "card", "transfer"];
  let paymentCount = 0;

  const paidInvoices = await Invoice.findAll({ where: { status: "paid" } });
  for (const inv of paidInvoices) {
    const [, created] = await Payment.findOrCreate({
      where: { invoiceId: inv.id },
      defaults: {
        invoiceId: inv.id,
        amount: inv.total,
        paidAt: inv.paidAt || inv.issueDate,
        method: pick(methods),
        status: "completed",
      },
    });
    if (created) paymentCount++;
  }

  // Cobro parcial
  const partialInvoices = await Invoice.findAll({ where: { status: "partial" } });
  for (const inv of partialInvoices) {
    const [, created] = await Payment.findOrCreate({
      where: { invoiceId: inv.id },
      defaults: {
        invoiceId: inv.id,
        amount: Number(inv.total) / 2,
        paidAt: new Date().toISOString(),
        method: "transfer",
        status: "completed",
      },
    });
    if (created) paymentCount++;
  }

  log(`✓ ${paymentCount} cobros creados`);

  // ── 8. Costes ───────────────────────────────────────────────────────────────
  header("Creando costes operativos...");

  const costsData = [
    // Ene-Abr: salarios fijos
    ...["2026-01", "2026-02", "2026-03", "2026-04"].flatMap((month) => [
      { month, type: "salary", category: "fixed", description: "Sueldo — Ana García", amount: 1800, therapistId: therapists[0].id },
      { month, type: "salary", category: "fixed", description: "Sueldo — Carlos López", amount: 2000, therapistId: therapists[1].id },
      { month, type: "salary", category: "fixed", description: "Sueldo — Laura Martínez", amount: 2200, therapistId: therapists[2].id },
      { month, type: "salary", category: "fixed", description: "Sueldo — Miguel Sánchez", amount: 1900, therapistId: therapists[3].id },
      { month, type: "rent", category: "fixed", description: "Alquiler consultas", amount: 1500, therapistId: null },
      { month, type: "software", category: "fixed", description: "Software CRM + herramientas", amount: 120, therapistId: null },
    ]),
    // Material trimestral
    { month: "2026-01", type: "material", category: "variable", description: "Material de oficina Q1", amount: 180, therapistId: null },
    { month: "2026-03", type: "material", category: "variable", description: "Tests psicológicos", amount: 340, therapistId: null },
    // CAPEX
    { month: "2026-02", type: "material", category: "capex", description: "Equipamiento sala espera", amount: 850, therapistId: null },
  ];

  let costCount = 0;
  for (const c of costsData) {
    const [, created] = await Cost.findOrCreate({
      where: { month: c.month, description: c.description },
      defaults: c,
    });
    if (created) costCount++;
  }
  log(`✓ ${costCount} costes creados`);

  // ── 9. Resumen ──────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Seed completado!\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Terapeutas: ${therapists.length}\n`);
  process.stdout.write(`  Clientes:   ${clients.length}\n`);
  process.stdout.write(`  Facturas:   ${invoiceCount}\n`);
  process.stdout.write(`  Cobros:     ${paymentCount}\n`);
  process.stdout.write(`  Costes:     ${costCount}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
