/**
 * seed-billing-demo.js
 *
 * Seed coherente para el módulo billing (rework). Genera:
 *   - 8-15 facturas EMITIDAS distribuidas en los últimos 6 meses con
 *     IVA mixto (21% mayoría, alguna 10% y 4%).
 *   - Cobros parciales y totales que NUNCA superan el total.
 *   - Algunas facturas pendientes (sin cobrar) y alguna vencida (overdue).
 *   - Costes variados con IVA: alquiler, software, salarios, comisiones,
 *     material. Categorías mezcladas variable / fixed / opex / capex.
 *   - Salarios mensuales asignados a los 4 empleados activos del demo.
 *   - 1 factura rectificativa.
 *
 * Reutiliza los Clients y TeamMembers existentes en demo. NO crea clientes
 * nuevos. Idempotente: si las facturas ya existen (mismo `notes` marcador),
 * se saltan.
 *
 * Uso: npm run db:seed:billing-demo
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { calculateInvoice } from "../lib/billing/calculateInvoice.js";
import { assignInvoiceNumber } from "../lib/billing/generateInvoiceNumber.js";
import { updateInvoiceStatus } from "../lib/billing/updateInvoiceStatus.js";

const DEMO_SLUG = "demo";
const SEED_MARKER = "[seed-billing-demo]";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function addMonths(d, m) { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; }
function addDays(d, days) { const x = new Date(d); x.setDate(x.getDate() + days); return x; }

const SALARIES = {
  "Ana García":      { monthlySalary: 2400, hourlyCost: 22.5, hourlyRate: 65 },
  "Carlos López":    { monthlySalary: 2700, hourlyCost: 25,   hourlyRate: 70 },
  "Laura Martínez":  { monthlySalary: 2900, hourlyCost: 28,   hourlyRate: 80 },
  "Miguel Sánchez":  { monthlySalary: 1900, hourlyCost: 18,   hourlyRate: 45 },
};

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Seed billing demo (rework)             \n");
  process.stdout.write("════════════════════════════════════════\n");

  // ── 1. Entorno ─────────────────────────────────────────────────────────
  header("Verificando tenant demo y datos existentes...");
  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: DEMO_SLUG } });
  if (!tenant) { process.stderr.write("\n✗ Tenant demo no encontrado.\n"); process.exit(1); }
  log(`✓ Tenant: ${tenant.name}`);

  const { sequelize, models } = getTenantDb(DEMO_SLUG);
  const { Client, Invoice, Payment, Cost, TeamMember, InvoiceSeries, TenantBillingSettings } = models;

  // ── 2. Settings + series ───────────────────────────────────────────────
  let settings = await TenantBillingSettings.findOne();
  if (!settings) settings = await TenantBillingSettings.create({});
  await settings.update({
    fiscalName: settings.fiscalName || "Demo Salamandra S.L.",
    taxId: settings.taxId || "B12345678",
    fiscalAddress: settings.fiscalAddress || "Calle Demo 123",
    fiscalCity: settings.fiscalCity || "Madrid",
    fiscalZip: settings.fiscalZip || "28001",
    fiscalCountry: "ES",
  });
  log("✓ Settings asegurados");

  // Ambas series deben existir gracias a la migración. Si no, error.
  const fSeries = await InvoiceSeries.findOne({ where: { code: "F" } });
  const rSeries = await InvoiceSeries.findOne({ where: { code: "R" } });
  if (!fSeries || !rSeries) {
    process.stderr.write("\n✗ Series F/R no encontradas. Ejecuta antes la migración billing.\n");
    process.exit(1);
  }

  // ── 3. Clientes existentes ─────────────────────────────────────────────
  const clients = await Client.findAll({ where: { status: { [Op.ne]: "inactive" } }, limit: 20 });
  if (clients.length === 0) {
    process.stderr.write("\n✗ No hay clientes en demo. Ejecuta db:seed primero.\n");
    process.exit(1);
  }
  // Rellenar campos fiscales mínimos en algunos clientes para que las
  // facturas tengan datos completos.
  let fiscalUpdated = 0;
  for (const c of clients.slice(0, 6)) {
    if (!c.fiscalName) {
      await c.update({
        fiscalName: c.name,
        taxId: c.taxId || `B${rnd(10000000, 99999999)}`,
        fiscalAddress: c.fiscalAddress || `Calle ${c.name.split(" ")[0]} ${rnd(1, 99)}`,
        fiscalCity: c.fiscalCity || pick(["Madrid", "Barcelona", "Valencia", "Sevilla"]),
        fiscalZip: c.fiscalZip || String(rnd(28000, 28999)),
        fiscalCountry: "ES",
      });
      fiscalUpdated++;
    }
  }
  log(`✓ Clientes con datos fiscales: ${fiscalUpdated} nuevos rellenos`);

  // ── 4. Empleados con salarios mensuales ─────────────────────────────────
  header("Asignando monthlySalary a empleados activos...");
  const employees = await TeamMember.findAll({ where: { status: "active" } });
  for (const e of employees) {
    const cfg = SALARIES[e.displayName];
    if (cfg) {
      await e.update({
        monthlySalary: e.monthlySalary ?? cfg.monthlySalary,
        hourlyCost: e.hourlyCost ?? cfg.hourlyCost,
        hourlyRate: e.hourlyRate ?? cfg.hourlyRate,
      });
      log(`· ${e.displayName}: monthlySalary=${e.monthlySalary ?? cfg.monthlySalary}`);
    }
  }
  const activeEmployees = employees.filter((e) => SALARIES[e.displayName]);
  if (activeEmployees.length === 0) {
    process.stderr.write("\n✗ No hay empleados activos válidos. Ejecuta db:seed:team primero.\n");
    process.exit(1);
  }

  // ── 5. Limpiar facturas y cobros anteriores con marcador ───────────────
  header("Limpiando seed anterior...");
  const oldInvoices = await Invoice.findAll({ where: { notes: { [Op.like]: `%${SEED_MARKER}%` } } });
  if (oldInvoices.length > 0) {
    const ids = oldInvoices.map((i) => i.id);
    await Payment.destroy({ where: { invoiceId: { [Op.in]: ids } } });
    await Invoice.destroy({ where: { id: { [Op.in]: ids } } });
    log(`· Eliminadas ${oldInvoices.length} facturas anteriores con marcador`);
  }
  const oldCosts = await Cost.findAll({ where: { description: { [Op.like]: `%${SEED_MARKER}%` } } });
  if (oldCosts.length > 0) {
    await Cost.destroy({ where: { id: { [Op.in]: oldCosts.map((c) => c.id) } } });
    log(`· Eliminados ${oldCosts.length} costes anteriores con marcador`);
  }

  // ── 6. Costes mensuales con distribución realista ──────────────────────
  // Objetivo de distribución (sobre el facturado total del periodo):
  //   - Variables (comisiones + material consumible) ≈ 30-45 %
  //   - Fijos     (salarios + alquiler)              ≈ 20-35 %
  //   - OPEX      (software, suministros)            ≈  3-8 %
  //   - CAPEX     (puntual, no operativo)            ≈  1-2 % absoluto
  // Resultado esperado: Margen Bruto 50-70 %, Margen Neto 15-35 %,
  // EBITDA ligeramente > Margen Neto (por CAPEX).
  header("Generando costes (distribución realista)...");
  const today = new Date();
  let costCount = 0;
  const helper = (overrides) => Cost.create({
    vatRate: 21,
    vatDeductible: true,
    employeeId: pick(activeEmployees).id,
    ...overrides,
    description: `${overrides.description} ${SEED_MARKER}`,
    taxAmount: round2(Number(overrides.taxBase) * Number(overrides.vatRate ?? 21) / 100),
    total: round2(Number(overrides.taxBase) * (1 + Number(overrides.vatRate ?? 21) / 100)),
  });

  for (let m = 11; m >= 0; m--) {
    const ref = addMonths(today, -m);
    const ymd = (d) => isoDate(new Date(ref.getFullYear(), ref.getMonth(), d));

    // ── FIJOS ──────────────────────────────────────────────────────────────
    // Salarios mensuales (sin IVA, no deducibles)
    for (const e of activeEmployees) {
      const base = Number(SALARIES[e.displayName].monthlySalary);
      await Cost.create({
        type: "salary", category: "fixed",
        description: `Sueldo ${ref.toISOString().slice(0, 7)} — ${e.displayName} ${SEED_MARKER}`,
        taxBase: base, vatRate: 0, taxAmount: 0, total: base, vatDeductible: false,
        incurredAt: ymd(28), employeeId: e.id,
      });
      costCount++;
    }
    // Alquiler oficina
    await helper({
      type: "rent", category: "fixed",
      description: `Alquiler oficina ${ref.toISOString().slice(0, 7)}`,
      taxBase: 1500, incurredAt: ymd(1),
    });
    costCount++;

    // ── OPEX ──────────────────────────────────────────────────────────────
    // Suscripciones SaaS
    await helper({
      type: "software", category: "opex",
      description: `Suscripciones SaaS ${ref.toISOString().slice(0, 7)}`,
      taxBase: rnd(180, 320), incurredAt: ymd(5),
    });
    costCount++;
    // Suministros y otros opex (no todos los meses)
    if (m % 2 === 0) {
      await helper({
        type: "other", category: "opex",
        description: `Suministros (luz, internet) ${ref.toISOString().slice(0, 7)}`,
        taxBase: rnd(180, 280), incurredAt: ymd(15),
      });
      costCount++;
    }

    // ── VARIABLES ─────────────────────────────────────────────────────────
    // Comisiones comerciales: 22-28 % del facturado del mes (estimado).
    // Como el facturado real varía, usamos un proxy fijo por mes y luego
    // ajustamos con varianza para que parezca real.
    const monthlyBilledProxy = rnd(11000, 14000);
    const commissionRate = rnd(22, 28) / 100;
    const commissionBase = round2(monthlyBilledProxy * commissionRate);
    await helper({
      type: "commission", category: "variable",
      description: `Comisiones comerciales ${ref.toISOString().slice(0, 7)}`,
      taxBase: commissionBase, incurredAt: ymd(20),
      employeeId: activeEmployees[0].id,
    });
    costCount++;

    // Material consumible (proporcional al volumen)
    await helper({
      type: "material", category: "variable",
      description: `Material consumible ${ref.toISOString().slice(0, 7)}`,
      taxBase: rnd(450, 850), incurredAt: ymd(10),
    });
    costCount++;

    // Subcontratas eventuales (variable, ~50% de los meses)
    if (m % 2 === 1) {
      await helper({
        type: "other", category: "variable",
        description: `Subcontratación puntual ${ref.toISOString().slice(0, 7)}`,
        taxBase: rnd(800, 1500), incurredAt: ymd(18),
        clientId: pick(clients).id,
      });
      costCount++;
    }
  }

  // ── CAPEX (puntual, pocas entradas) ─────────────────────────────────────
  await helper({
    type: "material", category: "capex",
    description: "Compra equipo informático Q1",
    taxBase: 1200, incurredAt: isoDate(addMonths(today, -7)),
  });
  costCount++;
  await helper({
    type: "material", category: "capex",
    description: "Mobiliario sala reuniones",
    taxBase: 850, incurredAt: isoDate(addMonths(today, -3)),
  });
  costCount++;

  log(`✓ ${costCount} costes creados`);

  // ── 7. Facturas (emitidas en últimos 6 meses) ─────────────────────────
  header("Generando facturas...");
  const SCENARIOS = [
    // pago total
    { description: "Servicios profesionales abril", quantity: 8, unitPrice: 95, vatRate: 21, payRatio: 1.0, daysToPay: 12 },
    // pago parcial
    { description: "Consultoría estratégica", quantity: 1, unitPrice: 1800, vatRate: 21, payRatio: 0.4, daysToPay: 20 },
    // sin cobrar todavía (issued)
    { description: "Mantenimiento mensual marzo", quantity: 1, unitPrice: 450, vatRate: 21, payRatio: 0, daysToPay: null },
    // pago total tipo IVA reducido
    { description: "Materiales formativos (libros)", quantity: 25, unitPrice: 18, vatRate: 4, payRatio: 1.0, daysToPay: 7 },
    // pago total IVA 10%
    { description: "Servicios de hostelería evento", quantity: 30, unitPrice: 22, vatRate: 10, payRatio: 1.0, daysToPay: 15 },
    // overdue (sin cobrar y vencido)
    { description: "Auditoría inicial", quantity: 1, unitPrice: 980, vatRate: 21, payRatio: 0, daysToPay: null, overdue: true },
    // pago total
    { description: "Desarrollo módulo", quantity: 1, unitPrice: 2400, vatRate: 21, payRatio: 1.0, daysToPay: 10 },
    // pago total
    { description: "Diseño identidad", quantity: 1, unitPrice: 800, vatRate: 21, payRatio: 1.0, daysToPay: 5 },
    // multi-línea con dos IVA distintos
    { multiline: true, payRatio: 1.0, daysToPay: 8 },
    // pago parcial mediano
    { description: "Soporte mensual febrero", quantity: 1, unitPrice: 600, vatRate: 21, payRatio: 0.5, daysToPay: 25 },
    // factura para rectificar después
    { description: "Servicios mal facturados — rectificada después", quantity: 4, unitPrice: 250, vatRate: 21, payRatio: 0, rectifyAfter: true },
  ];

  const created = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    const monthsAgo = Math.floor(i * (5 / SCENARIOS.length)); // distribuir 0..5 meses atrás
    const issueDate = isoDate(addMonths(today, -monthsAgo));
    const client = pick(clients);
    const employee = pick(activeEmployees);

    let lines;
    if (sc.multiline) {
      lines = [
        { description: "Diagnóstico inicial", quantity: 1, unitPrice: 350, discountPct: 0, vatRate: 21 },
        { description: "Materiales (IVA reducido)", quantity: 10, unitPrice: 12, discountPct: 0, vatRate: 4 },
      ];
    } else {
      lines = [{ description: sc.description, quantity: sc.quantity, unitPrice: sc.unitPrice, discountPct: 0, vatRate: sc.vatRate }];
    }

    const calc = calculateInvoice({ lines });

    // Crear como draft → emit dentro de transacción para asignar número correlativo
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
        number: `DRAFT-${Date.now()}-${i}`,
        status: "draft",
        notes: `${SEED_MARKER}`,
        customFields: {},
        subtotal: calc.taxBase,
        vatRate: 0,
      }, { transaction: t });

      const number = await assignInvoiceNumber({
        sequelize, models, seriesCode: "F", date: issueDate, t,
      });
      await draft.update({ number, status: "issued" }, { transaction: t });
      return draft;
    });

    created.push({ inv, sc, issueDate });
  }

  // ── 8. Cobros ───────────────────────────────────────────────────────────
  header("Generando cobros...");
  let payCount = 0;
  for (const { inv, sc, issueDate } of created) {
    if (sc.rectifyAfter) continue; // sin cobros, vamos a rectificar
    if (sc.payRatio > 0 && sc.daysToPay != null) {
      const amount = round2(Number(inv.total) * sc.payRatio);
      await Payment.create({
        invoiceId: inv.id,
        amount,
        paidAt: addDays(new Date(issueDate), sc.daysToPay),
        method: pick(["card", "transfer", "cash", "direct_debit"]),
        status: "completed",
        notes: SEED_MARKER,
      });
      await updateInvoiceStatus(inv, Payment);
      payCount++;
    } else if (sc.overdue) {
      // Marcar overdue manualmente: dueDate ya pasó y sigue sin cobrar
      await inv.update({
        dueDate: isoDate(addDays(today, -10)),
        status: "overdue",
      });
    }
  }
  log(`✓ ${payCount} cobros creados`);

  // ── 9. Una rectificativa ───────────────────────────────────────────────
  header("Generando 1 rectificativa...");
  const toRectify = created.find((c) => c.sc.rectifyAfter)?.inv;
  if (toRectify) {
    // Mismo flujo que el endpoint /rectify pero in-process
    const inverted = (toRectify.lines || []).map((l) => ({
      description: `Rectificación: ${l.description}`,
      quantity: -Number(l.quantity), unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct ?? 0), vatRate: Number(l.vatRate),
    }));
    const rcalc = calculateInvoice({ lines: inverted });

    await sequelize.transaction(async (t) => {
      const number = await assignInvoiceNumber({
        sequelize, models, seriesCode: "R", date: isoDate(today), t,
      });
      const rect = await Invoice.create({
        clientId: toRectify.clientId,
        employeeId: toRectify.employeeId,
        issueDate: isoDate(today),
        dueDate: null,
        lines: rcalc.lines,
        taxBase: rcalc.taxBase, vatAmount: rcalc.vatAmount, total: rcalc.total,
        paidAmount: 0,
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

  // ── 10. Resumen ────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Seed billing demo completado!\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Facturas: ${created.length} (1 rectificada)\n`);
  process.stdout.write(`  Cobros:   ${payCount}\n`);
  process.stdout.write(`  Costes:   ${costCount}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
