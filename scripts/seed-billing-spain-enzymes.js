/**
 * seed-billing-spain-enzymes.js
 *
 * Datos de prueba del módulo Facturación para el tenant `spain_enzymes`.
 * Perfil de la empresa: distribución / producción de enzimas industriales,
 * ventas B2B con pocas facturas grandes, costes de mercancía importantes
 * (variables), salarios y alquiler de nave (fijos), CAPEX puntual de
 * equipo de laboratorio.
 *
 * Idempotente vía marcador `[seed-billing-spain]` en notes/description.
 *
 * Uso: npm run db:seed:billing:spain
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { calculateInvoice } from "../lib/billing/calculateInvoice.js";
import { assignInvoiceNumber } from "../lib/billing/generateInvoiceNumber.js";
import { updateInvoiceStatus } from "../lib/billing/updateInvoiceStatus.js";

const SLUG = "spain_enzymes";
const SEED_MARKER = "[seed-billing-spain]";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function addMonths(d, m) { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; }
function addDays(d, days) { const x = new Date(d); x.setDate(x.getDate() + days); return x; }
function round2(n) { return Math.round(Number(n) * 100) / 100; }

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Seed billing — spain_enzymes           \n");
  process.stdout.write("════════════════════════════════════════\n");

  // ── 1. Verificar tenant + dependencias ────────────────────────────────
  header("Verificando tenant y precondiciones...");
  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) { process.stderr.write("\n✗ Tenant spain_enzymes no encontrado.\n"); process.exit(1); }
  log(`✓ Tenant: ${tenant.name}`);

  const { sequelize, models } = getTenantDb(SLUG);
  const { Client, Invoice, Payment, Cost, TeamMember, InvoiceSeries, TenantBillingSettings } = models;

  const clients = await Client.findAll({
    where: { fiscalName: { [Op.ne]: null }, taxId: { [Op.ne]: null } },
    limit: 20,
  });
  if (clients.length < 3) {
    process.stderr.write("\n✗ Faltan clientes con datos fiscales completos. Rellena fiscal_name y tax_id en algunos clientes antes.\n");
    process.exit(1);
  }
  log(`✓ ${clients.length} clientes con datos fiscales`);

  const fSeries = await InvoiceSeries.findOne({ where: { code: "F" } });
  const rSeries = await InvoiceSeries.findOne({ where: { code: "R" } });
  if (!fSeries || !rSeries) {
    process.stderr.write("\n✗ Series F/R no encontradas. Ejecuta antes la migración billing-rework.\n");
    process.exit(1);
  }

  const settings = await TenantBillingSettings.findOne();
  if (!settings || !settings.fiscalName) {
    process.stderr.write("\n✗ Datos fiscales del emisor no rellenados. Edita /facturacion/configuracion antes.\n");
    process.exit(1);
  }
  log(`✓ Settings: ${settings.fiscalName}`);

  // ── 2. Limpiar seed anterior con marcador ─────────────────────────────
  // Se hace ANTES de crear empleados para que una segunda pasada deje
  // un estado limpio y reproducible.
  header("Limpiando seed anterior...");
  const oldInv = await Invoice.findAll({ where: { notes: { [Op.like]: `%${SEED_MARKER}%` } } });
  if (oldInv.length > 0) {
    const ids = oldInv.map((i) => i.id);
    await Payment.destroy({ where: { invoiceId: { [Op.in]: ids } } });
    await Invoice.destroy({ where: { id: { [Op.in]: ids } } });
    log(`· Eliminadas ${oldInv.length} facturas anteriores`);
  }
  const oldCosts = await Cost.findAll({ where: { description: { [Op.like]: `%${SEED_MARKER}%` } } });
  if (oldCosts.length > 0) {
    await Cost.destroy({ where: { id: { [Op.in]: oldCosts.map((c) => c.id) } } });
    log(`· Eliminados ${oldCosts.length} costes anteriores`);
  }
  // Empleados creados por seed previo (notes contiene el marcador)
  const oldEmployees = await TeamMember.findAll({ where: { notes: { [Op.like]: `%${SEED_MARKER}%` } } });
  if (oldEmployees.length > 0) {
    await TeamMember.destroy({ where: { id: { [Op.in]: oldEmployees.map((e) => e.id) } } });
    log(`· Eliminados ${oldEmployees.length} empleados anteriores`);
  }

  // ── 2b. Empleados: validar o crear los 3 ficticios ─────────────────────
  let employees = await TeamMember.findAll({ where: { status: "active" } });
  if (employees.length < 1) {
    const TO_CREATE = [
      { displayName: "Marta Ruiz",   email: "marta.ruiz@spain-enzymes.test",   position: "Directora",      department: "Dirección",   monthlySalary: 3200, hourlyCost: 30, hourlyRate: 90 },
      { displayName: "David Torres", email: "david.torres@spain-enzymes.test", position: "Comercial",      department: "Ventas",      monthlySalary: 2400, hourlyCost: 22, hourlyRate: 65 },
      { displayName: "Lucía Vega",   email: "lucia.vega@spain-enzymes.test",   position: "Administración", department: "Operaciones", monthlySalary: 2100, hourlyCost: 20, hourlyRate: 50 },
    ];
    for (const cfg of TO_CREATE) {
      const emp = await TeamMember.create({
        ...cfg,
        status: "active",
        hiredAt: isoDate(addMonths(new Date(), -12)),
        notes: SEED_MARKER,
        customFields: {},
      });
      log(`· empleado creado: ${emp.displayName} (${emp.position})`);
    }
    employees = await TeamMember.findAll({ where: { status: "active" } });
  }
  log(`✓ ${employees.length} empleados activos`);

  // ── 3. Costes (3 meses, perfil empresa B2B con stock) ────────────────
  header("Generando costes...");
  const today = new Date();
  let costCount = 0;

  const helper = (overrides) => Cost.create({
    vatRate: 21,
    vatDeductible: true,
    employeeId: pick(employees).id,
    ...overrides,
    description: `${overrides.description} ${SEED_MARKER}`,
    taxAmount: round2(Number(overrides.taxBase) * Number(overrides.vatRate ?? 21) / 100),
    total: round2(Number(overrides.taxBase) * (1 + Number(overrides.vatRate ?? 21) / 100)),
  });

  for (let m = 2; m >= 0; m--) {
    const ref = addMonths(today, -m);
    const ymd = (d) => isoDate(new Date(ref.getFullYear(), ref.getMonth(), d));

    // ── FIJOS ──────────────────────────────────────────────────────────
    // Salarios
    for (const e of employees) {
      const monthly = Number(e.monthlySalary || 2500);
      await Cost.create({
        type: "salary", category: "fixed",
        description: `Sueldo ${ref.toISOString().slice(0, 7)} — ${e.displayName} ${SEED_MARKER}`,
        taxBase: monthly, vatRate: 0, taxAmount: 0, total: monthly, vatDeductible: false,
        incurredAt: ymd(28), employeeId: e.id,
      });
      costCount++;
    }
    // Alquiler nave
    await helper({
      type: "rent", category: "fixed",
      description: `Alquiler nave Castellbisbal ${ref.toISOString().slice(0, 7)}`,
      taxBase: 2200, incurredAt: ymd(1),
    });
    costCount++;
    // Seguros (capital + responsabilidad civil)
    if (m % 6 === 0) {
      await helper({
        type: "other", category: "fixed",
        description: `Seguro semestral nave + RC`,
        taxBase: rnd(1100, 1400), incurredAt: ymd(10),
      });
      costCount++;
    }

    // ── OPEX ──────────────────────────────────────────────────────────
    await helper({
      type: "software", category: "opex",
      description: `Suscripciones SaaS (CRM, ERP) ${ref.toISOString().slice(0, 7)}`,
      taxBase: rnd(220, 380), incurredAt: ymd(5),
    });
    costCount++;
    if (m % 2 === 0) {
      await helper({
        type: "other", category: "opex",
        description: `Suministros nave (luz, gas) ${ref.toISOString().slice(0, 7)}`,
        taxBase: rnd(380, 620), incurredAt: ymd(15),
      });
      costCount++;
    }

    // ── VARIABLES ─────────────────────────────────────────────────────
    // Compra de mercancía (la principal partida variable de la empresa)
    await helper({
      type: "material", category: "variable",
      description: `Compra enzimas a proveedor ${pick(["BiotechNorth","NordicLab","Chemika EU","Asian Bio Supply"])} ${ref.toISOString().slice(0, 7)}`,
      taxBase: rnd(4200, 7800), incurredAt: ymd(8),
      clientId: pick(clients).id, // imputable a la venta de ese mes
    });
    costCount++;
    // Comisiones comerciales (Laia)
    await helper({
      type: "commission", category: "variable",
      description: `Comisiones comerciales ${ref.toISOString().slice(0, 7)}`,
      taxBase: rnd(1200, 2400), incurredAt: ymd(20),
      employeeId: employees.find((e) => e.position?.includes("Comercial"))?.id ?? employees[0].id,
    });
    costCount++;
    // Envíos / logística internacional (variable, no todos los meses)
    if (m % 2 === 1) {
      await helper({
        type: "other", category: "variable",
        description: `Envíos internacionales mercancía ${ref.toISOString().slice(0, 7)}`,
        taxBase: rnd(600, 1500), incurredAt: ymd(18),
      });
      costCount++;
    }
    // Material laboratorio puntual
    if (m % 3 === 0) {
      await helper({
        type: "material", category: "variable",
        description: `Material laboratorio (reactivos)`,
        taxBase: rnd(350, 700), incurredAt: ymd(12),
      });
      costCount++;
    }
  }

  // ── CAPEX (puntual) ───────────────────────────────────────────────────
  await helper({
    type: "material", category: "capex",
    description: "Centrífuga laboratorio",
    taxBase: 4500, incurredAt: isoDate(addMonths(today, -8)),
  });
  costCount++;
  await helper({
    type: "material", category: "capex",
    description: "Estantería industrial almacén",
    taxBase: 1850, incurredAt: isoDate(addMonths(today, -4)),
  });
  costCount++;

  log(`✓ ${costCount} costes creados`);

  // ── 4. Facturas (B2B, pocas pero grandes) ─────────────────────────────
  header("Generando facturas...");
  const PRODUCTS = [
    { desc: "Lipasa industrial 5L", price: 280, vat: 21 },
    { desc: "Amilasa concentrada 1kg", price: 420, vat: 21 },
    { desc: "Proteasa alimentaria 10kg", price: 1850, vat: 10 }, // alimentación humana
    { desc: "Celulasa enzimática 25kg", price: 3200, vat: 21 },
    { desc: "Pectinasa 5kg", price: 980, vat: 21 },
    { desc: "Lactasa farmacéutica 1kg", price: 2400, vat: 4 }, // tipo super-reducido (medicamentos)
    { desc: "Servicio asistencia técnica (h)", price: 90, vat: 21 },
  ];

  const SCENARIOS = [
    // pago total 30d (IVA 21%)
    { lines: [{ qty: 8, prod: 0 }, { qty: 4, prod: 1 }], payRatio: 1.0, daysToPay: 22 },
    // pago parcial 50%
    { lines: [{ qty: 1, prod: 5 }, { qty: 6, prod: 0 }], payRatio: 0.5, daysToPay: 15 },
    // multi-tipo IVA (21 / 4 / 21)
    { lines: [{ qty: 6, prod: 2 }, { qty: 4, prod: 5 }, { qty: 2, prod: 6 }], payRatio: 1.0, daysToPay: 12 },
    // sin cobrar (issued, próxima a vencer)
    { lines: [{ qty: 4, prod: 1 }, { qty: 8, prod: 6 }], payRatio: 0, daysToPay: null },
    // a rectificar después (sin cobrar)
    { lines: [{ qty: 5, prod: 0 }], payRatio: 0, rectifyAfter: true },
  ];

  const created = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    const monthsAgo = Math.floor(i * (2 / SCENARIOS.length));
    const issueDate = isoDate(addMonths(today, -monthsAgo));
    const client = pick(clients);
    const employee = pick(employees);

    const lines = sc.lines.map((l) => {
      const p = PRODUCTS[l.prod];
      return {
        description: p.desc,
        quantity: l.qty,
        unitPrice: p.price,
        discountPct: 0,
        vatRate: p.vat,
      };
    });
    const calc = calculateInvoice({ lines });

    const inv = await sequelize.transaction(async (t) => {
      const draft = await Invoice.create({
        clientId: client.id,
        employeeId: employee.id,
        issueDate,
        dueDate: isoDate(addDays(new Date(issueDate), 30)),
        lines: calc.lines,
        taxBase: calc.taxBase,
        vatAmount: calc.vatAmount,
        total: calc.total,
        paidAmount: 0,
        series: "F",
        number: `DRAFT-SE-${Date.now()}-${i}`,
        status: "draft",
        notes: `${SEED_MARKER}`,
        customFields: {},
        subtotal: calc.taxBase,
        vatRate: 0,
      }, { transaction: t });

      const number = await assignInvoiceNumber({ sequelize, models, seriesCode: "F", date: issueDate, t });
      await draft.update({ number, status: "issued" }, { transaction: t });
      return draft;
    });

    created.push({ inv, sc, issueDate });
  }

  // ── 5. Cobros ────────────────────────────────────────────────────────
  header("Generando cobros...");
  let payCount = 0;
  for (const { inv, sc, issueDate } of created) {
    if (sc.rectifyAfter) continue;
    if (sc.payRatio > 0 && sc.daysToPay != null) {
      const amount = round2(Number(inv.total) * sc.payRatio);
      await Payment.create({
        invoiceId: inv.id,
        amount,
        paidAt: addDays(new Date(issueDate), sc.daysToPay),
        method: pick(["transfer", "transfer", "card", "direct_debit"]),
        status: "completed",
        notes: SEED_MARKER,
      });
      await updateInvoiceStatus(inv, Payment);
      payCount++;
    } else if (sc.overdue) {
      await inv.update({
        dueDate: isoDate(addDays(today, -10)),
        status: "overdue",
      });
    }
  }
  log(`✓ ${payCount} cobros creados`);

  // ── 6. Una rectificativa ──────────────────────────────────────────────
  header("Generando rectificativa...");
  const toRectify = created.find((c) => c.sc.rectifyAfter)?.inv;
  if (toRectify) {
    const inverted = (toRectify.lines || []).map((l) => ({
      description: `Rectificación: ${l.description}`,
      quantity: -Number(l.quantity), unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct ?? 0), vatRate: Number(l.vatRate),
    }));
    const rcalc = calculateInvoice({ lines: inverted });

    // Bug #6: la rectificativa hereda paid_amount negativo de la original
    // para que el KPI Cobrado/Facturado no exceda 100% al excluir la
    // original por status='rectified'. Ver docs/modules/billing.md.
    const rectPaidAmount = -Number(toRectify.paidAmount ?? 0);

    await sequelize.transaction(async (t) => {
      const number = await assignInvoiceNumber({ sequelize, models, seriesCode: "R", date: isoDate(today), t });
      const rect = await Invoice.create({
        clientId: toRectify.clientId,
        employeeId: toRectify.employeeId,
        issueDate: isoDate(today),
        dueDate: null,
        lines: rcalc.lines,
        taxBase: rcalc.taxBase, vatAmount: rcalc.vatAmount, total: rcalc.total,
        paidAmount: rectPaidAmount,
        series: "R", number, status: "issued",
        notes: `Rectificativa de ${toRectify.number} ${SEED_MARKER}`,
        customFields: {},
        subtotal: rcalc.taxBase, vatRate: 0,
        rectifiesInvoiceId: toRectify.id,
      }, { transaction: t });
      await toRectify.update({ status: "rectified", rectifiedByInvoiceId: rect.id }, { transaction: t });
      log(`✓ Rectificativa ${number} creada`);
    });
  }

  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Seed billing spain_enzymes completado\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Facturas: ${created.length} (1 rectificada)\n`);
  process.stdout.write(`  Cobros:   ${payCount}\n`);
  process.stdout.write(`  Costes:   ${costCount}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
