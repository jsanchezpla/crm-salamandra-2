/**
 * seed-sandbox-data.js — Llena de datos demo TODOS los módulos del tenant sandbox.
 *
 * Para probar el CRM entero con pantallas pobladas. Cada módulo se siembra en
 * su propio try/catch: si uno falla, se registra y sigue el resto.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-sandbox-data.js
 *
 * NO idempotente puro: cada ejecución añade más filas (usa findOrCreate donde
 * hay unique). Para empezar limpio, re-crea el tenant o vacía crm_sandbox.
 */

import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { calculateInvoice } from "../lib/billing/calculateInvoice.js";
import { TIPOS_CITA_DEMO } from "../lib/demo/tiposCitaDemo.js";
import { validateModalityFields } from "../lib/citas/validation.js";

// Tenant destino: por defecto "sandbox", pero acepta un slug como argumento
// (p.ej. "demo") para reutilizar este seed en otros tenants de escaparate.
const SLUG = process.argv[2] || "sandbox";

// ── helpers ──────────────────────────────────────────────────────────────────
function log(m) { process.stdout.write(`  ${m}\n`); }
function header(m) { process.stdout.write(`\n▶ ${m}\n`); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rand(min, max, dec = 0) { const v = Math.random() * (max - min) + min; return dec ? +v.toFixed(dec) : Math.round(v); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function dateAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function slugify(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }

const NOMBRES = ["Carmen", "Roberto", "Lucía", "Andrés", "Mónica", "Javier", "Natalia", "Daniel", "Sara", "Pablo", "Beatriz", "Sergio", "Marta", "Adrián", "Elena", "Nuria", "Iván", "Rocío"];
const APELLIDOS = ["Soler", "Fuentes", "Marín", "Castellano", "Herrero", "Pizarro", "Guerrero", "Crespo", "Romero", "Navarro", "Jiménez", "Vázquez", "Ortiz", "Delgado", "Cano", "Vidal", "Prieto"];
const EMPRESAS = ["Innovatech S.L.", "Grupo Marbella", "Estudio Norte", "Laboratori Blau", "Nórdica Films", "Cercle Media", "Aurora Digital", "Construcciones Vega", "Editorial Faro", "Clínica Bienestar"];
const PARTNERS = ["jorge", "rodrigo"];

const SERVICIOS = [
  { desc: "Consultoría estratégica (jornada)", price: 850 },
  { desc: "Desarrollo web a medida", price: 4200 },
  { desc: "Campaña de marketing trimestral", price: 2400 },
  { desc: "Diseño de identidad de marca", price: 3100 },
  { desc: "Mantenimiento mensual", price: 450 },
  { desc: "Auditoría técnica", price: 1200 },
  { desc: "Sesión de formación (8h)", price: 680 },
];

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write("  Sandbox — sembrando datos en todos los módulos\n");
  process.stdout.write("══════════════════════════════════════════════\n");

  const { models } = getTenantDb(SLUG);
  const results = {};
  const tryModule = async (name, fn) => {
    header(name);
    try { const n = await fn(); results[name] = `✓ ${n ?? "ok"}`; log(`✓ ${name} listo`); }
    catch (e) { results[name] = `✗ ${e.message}`; log(`✗ ${name}: ${e.message}`); }
  };

  // ── 1. CLIENTES ────────────────────────────────────────────────────────────
  let clientes = [];
  await tryModule("Clientes", async () => {
    const { Client, Contact, ClientNote } = models;
    for (let i = 0; i < 14; i++) {
      const isCompany = i < 9;
      const name = isCompany ? EMPRESAS[i % EMPRESAS.length] : `${pick(NOMBRES)} ${pick(APELLIDOS)}`;
      const c = await Client.create({
        type: isCompany ? "company" : "individual",
        name,
        email: `${slugify(name).slice(0, 16)}@${isCompany ? "empresa" : "gmail"}.com`,
        phone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`,
        taxId: isCompany ? `B${rand(10000000, 99999999)}` : `${rand(10000000, 99999999)}X`,
        status: pick(["active", "active", "active", "prospect"]),
        fiscalName: isCompany ? name : null,
        fiscalAddress: `C/ ${pick(["Mayor", "Real", "Gran Vía", "Castellana", "Colón"])}, ${rand(1, 200)}`,
        fiscalCity: pick(["Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao", "Girona"]),
        fiscalZip: String(rand(28000, 48999)),
        fiscalCountry: "ES",
        notes: i % 4 === 0 ? "Cliente clave. Revisión trimestral." : null,
        customFields: { sector: pick(["Educación", "Salud", "Consultoría", "Industria", "Retail"]) },
      });
      clientes.push(c);
      if (isCompany) {
        await Contact.create({ clientId: c.id, name: `${pick(NOMBRES)} ${pick(APELLIDOS)}`, role: pick(["Gerente", "Compras", "Finanzas"]), email: `contacto${i}@empresa.com`, phone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`, isPrimary: true });
      }
      if (i % 3 === 0) await ClientNote.create({ clientId: c.id, content: pick(["Interesado en ampliar servicios.", "Pendiente de enviar propuesta.", "Muy satisfecho con el último proyecto."]), createdBy: "seed" });
    }
    return `${clientes.length} clientes`;
  });

  // ── 2. EQUIPO ──────────────────────────────────────────────────────────────
  // `weeklyDirectHours` es el objetivo semanal de horas directas: el
  // denominador de la «Ocupación del equipo» de la portada (29/08/2026). Sin
  // él, nadie tiene porcentaje y la vista sale vacía. Valores desiguales a
  // mano —quien dirige pasa poca consulta, quien atiende pasa mucha— y
  // Administración SIN objetivo a propósito: la demo también enseña que quien
  // no lo tiene configurado no sale en la gráfica.
  let equipo = [];
  await tryModule("Equipo", async () => {
    const { TeamMember } = models;
    const roles = [
      { position: "Socio · Consultor", department: "Dirección", weeklyDirectHours: 4 },
      { position: "Socio · Desarrollo", department: "Tecnología", weeklyDirectHours: 6 },
      { position: "Diseñadora", department: "Creatividad", weeklyDirectHours: 10 },
      { position: "Project Manager", department: "Operaciones", weeklyDirectHours: 8 },
      { position: "Comercial", department: "Ventas", weeklyDirectHours: 6 },
      { position: "Administración", department: "Soporte", weeklyDirectHours: null },
    ];
    for (let i = 0; i < roles.length; i++) {
      const nombre = pick(NOMBRES), apellido = pick(APELLIDOS);
      const m = await TeamMember.create({
        displayName: `${nombre} ${apellido}`,
        email: `${slugify(nombre)}.${slugify(apellido)}${i}@${SLUG}.local`,
        position: roles[i].position, department: roles[i].department,
        phone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`,
        hourlyCost: rand(18, 40, 2), hourlyRate: rand(50, 95, 2), monthlySalary: rand(1900, 3400, 2),
        weeklyDirectHours: roles[i].weeklyDirectHours,
        status: "active", hiredAt: daysAgo(rand(60, 1400)),
        avatarColor: "#" + Math.floor(rand(0, 16777215)).toString(16).padStart(6, "0"),
      });
      equipo.push(m);
    }
    return `${equipo.length} miembros`;
  });

  // ── 3. LEADS + REFERIDOS ────────────────────────────────────────────────────
  await tryModule("Leads / Referidos", async () => {
    const { Lead } = models;
    // Estados tal como los pinta la UI de leads (embudo new/contacted/lost).
    const stages = ["new", "new", "new", "contacted", "contacted", "lost"];
    const MOTIVOS = ["diagnostico", "servicios", "cursos", "talleres"];
    const SERVICIOS_LEAD = ["Desarrollo web a medida", "Campaña de marketing 360", "Consultoría CRM", "Branding e identidad", "App móvil", "Automatización de procesos"];
    const CURSOS = ["Marketing digital para pymes", "Introducción a la IA aplicada", "Ventas B2B", "Automatización con n8n"];
    const TALLERES = ["Taller de redes sociales", "Taller de copywriting", "Taller de analítica web"];
    const MENSAJES = [
      "Quiero renovar mi web y no sé por dónde empezar.",
      "Mi web no convierte, necesito captar más clientes.",
      "Busco automatizar procesos que hoy hacemos a mano.",
      "Me gustaría lanzar campañas en redes pero no tengo equipo.",
      "Necesito un CRM para ordenar clientes, proyectos y facturas.",
    ];
    let n = 0;
    for (let i = 0; i < 16; i++) {
      const esReferido = i >= 12;
      const motivo = pick(MOTIVOS);
      await Lead.create({
        name: `${pick(NOMBRES)} ${pick(APELLIDOS)}`,
        email: `lead${i}@example.com`,
        phone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`,
        title: pick(["Web corporativa", "Rebranding", "Campaña digital", "App móvil", "Consultoría"]),
        stage: pick(stages),
        probability: rand(10, 90),
        value: rand(1000, 15000),
        expectedCloseDate: daysAgo(rand(-60, 30)),
        notes: "Contacto inicial vía formulario web.",
        source: esReferido ? "referido" : pick(["web", "linkedin", "recomendacion"]),
        // Campos de consulta web: los que pinta la UI de leads del demo/sandbox.
        tipo_usuario: pick(["ciudadano", "ciudadano", "profesional"]),
        motivo,
        servicio: motivo === "servicios" ? pick(SERVICIOS_LEAD) : null,
        curso: motivo === "cursos" ? pick(CURSOS) : null,
        taller: motivo === "talleres" ? pick(TALLERES) : null,
        mensaje: motivo === "diagnostico" ? pick(MENSAJES) : null,
        customFields: esReferido ? { origin: "referido", referidoPor: pick(EMPRESAS) } : {},
      });
      n++;
    }
    return `${n} leads (incl. referidos)`;
  });

  // ── 4. PROYECTOS + TAREAS ───────────────────────────────────────────────────
  await tryModule("Proyectos", async () => {
    const { Project, BoardColumn, Phase, Task } = models;
    const proyectos = [
      "Web corporativa — Innovatech", "Rebranding Laboratori Blau", "Campaña Q3 Nórdica Films",
      "App interna de gestión", "Migración a Next.js",
    ];
    let nProj = 0, nTask = 0;
    for (let i = 0; i < proyectos.length; i++) {
      const proj = await Project.create({
        code: `PRY-2026-${String(i + 1).padStart(4, "0")}`,
        clientId: pick(clientes)?.id ?? null,
        name: proyectos[i], description: "Proyecto de ejemplo con tareas en el tablero.",
        status: pick(["active", "active", "draft", "completed"]),
        priority: pick(["low", "medium", "high"]),
        startDate: daysAgo(rand(20, 90)), dueDate: daysAgo(rand(-60, -10)),
        budgetAmount: rand(4000, 18000, 2), budgetCurrency: "EUR", estimatedHours: rand(40, 220, 2),
        tags: pick([["web"], ["branding"], ["marketing"], ["dev"]]),
      });
      nProj++;
      const cols = [];
      const colDefs = [{ name: "Por hacer", done: false }, { name: "En curso", done: false }, { name: "Hecho", done: true }];
      for (let ci = 0; ci < colDefs.length; ci++) {
        cols.push(await BoardColumn.create({ projectId: proj.id, name: colDefs[ci].name, order: ci, color: pick(["#94A3B8", "#F59E0B", "#10B981"]), isDoneColumn: colDefs[ci].done }));
      }
      const fase = await Phase.create({ projectId: proj.id, name: "Fase 1 · Arranque", order: 0, startDate: daysAgo(60), endDate: daysAgo(20), color: "#7C6BD6" });
      const tareas = ["Kickoff con cliente", "Diseño de wireframes", "Desarrollo del módulo principal", "Revisión interna", "Entrega y feedback", "Ajustes finales"];
      for (let ti = 0; ti < tareas.length; ti++) {
        await Task.create({
          projectId: proj.id, boardColumnId: pick(cols).id, phaseId: fase.id, order: ti,
          title: tareas[ti], description: "Tarea de ejemplo.",
          assigneeId: pick(equipo)?.id ?? null, estimatedHours: rand(2, 24), dueDate: daysAgo(rand(-30, 20)),
          checklist: ti % 2 === 0 ? [{ text: "Subtarea A", done: true }, { text: "Subtarea B", done: false }] : [],
          tags: pick([["frontend"], ["backend"], ["diseño"], []]),
        });
        nTask++;
      }
    }
    return `${nProj} proyectos · ${nTask} tareas`;
  });

  // ── 5. INVENTARIO ───────────────────────────────────────────────────────────
  //
  // Reescrito el 18/08/2026. Este bloque seguía creando `InboundProduct`,
  // `InboundBatch` y `OutboundProduct`: tres modelos que el rework del
  // 02/08/2026 BORRÓ. Y como `tryModule` se traga lo que salga mal, no reventaba
  // el sembrado — pintaba una ✗ entre veinte ✓ y seguía adelante.
  //
  // Lo que costaba, comprobado en la demo local antes de tocar una línea:
  //   · el almacén de las CUATRO demos quedaba vacío;
  //   · y los 22 pedidos salían sin UNA SOLA LÍNEA, porque cada línea apunta al
  //     catálogo y el catálogo no llegaba a existir.
  //
  // En producción no se veía porque su demo se sembró ANTES del rework y nadie
  // la ha reconstruido desde entonces (22 pedidos con 42 líneas, comprobado el
  // 18/08). Era una mina bajo el escaparate, no un problema ya resuelto: habría
  // estallado en la primera reconstrucción, que es justo cuando nadie mira.
  //
  // El catálogo es genérico y lo comparten las cuatro demos (decisión de Jorge,
  // 18/08/2026), que hasta hoy no tenían ninguno.
  let catalogo = [];
  await tryModule("Inventario", async () => {
    const { Product, Supplier, StockEntry, StockMovement, Asset } = models;

    const proveedores = [];
    for (const nm of ["Suministros Norte", "Distribuciones Sur", "Import Global"]) {
      proveedores.push(await Supplier.create({ name: nm, active: true }));
    }

    // `salida` va puesta A MANO y no al azar para que tres productos queden por
    // debajo de su mínimo: el aviso de bajo mínimo es media pantalla del módulo,
    // y una demo donde no salta nunca no lo enseña.
    const PRODUCTOS = [
      { name: "Folios A4 80g", sku: "A4-80", category: "Oficina", unit: "paquete", purchasePrice: 3.95, salePrice: 6.5, minStock: 8, entrada: 30, salida: 26 },
      { name: "Tóner láser negro", sku: "TN-NEG", category: "Oficina", unit: "ud", purchasePrice: 48, salePrice: 79, minStock: 4, entrada: 12, salida: 3 },
      { name: "Carpeta archivador", sku: "ARCH-1", category: "Oficina", unit: "ud", purchasePrice: 2.4, salePrice: 4.5, minStock: 20, entrada: 24, salida: 12 },
      { name: "Caja de bolígrafos (50 u)", sku: "BOLI-50", category: "Oficina", unit: "caja", purchasePrice: 11, salePrice: 18, minStock: 3, entrada: 9, salida: 2 },
      { name: "Cable HDMI 2 m", sku: "HDMI-2", category: "Material técnico", unit: "ud", purchasePrice: 6.2, salePrice: 12, minStock: 5, entrada: 14, salida: 0 },
      { name: "Gel hidroalcohólico", sku: "GEL-1L", category: "Material fungible", unit: "l", purchasePrice: 4.1, salePrice: 7.5, minStock: 10, entrada: 18, salida: 13 },
    ];

    let movimientos = 0;
    for (const p of PRODUCTOS) {
      const prod = await Product.create({ name: p.name, sku: p.sku, category: p.category, unit: p.unit, purchasePrice: p.purchasePrice, salePrice: p.salePrice, minStock: p.minStock, active: true });
      catalogo.push(prod);

      const entrada = await StockEntry.create({ productId: prod.id, supplierId: pick(proveedores).id, entryDate: daysAgo(rand(20, 120)), quantity: p.entrada, unitCost: p.purchasePrice, lot: `L-${rand(1000, 9999)}` });
      // El stock es la SUMA de los movimientos (no hay columna de saldo), así
      // que una entrada de mercancía tiene que dejar el suyo o no cuenta para
      // nada. Y las salidas van en NEGATIVO, por lo mismo.
      await StockMovement.create({ productId: prod.id, quantity: p.entrada, type: "entrada", reason: `Entrada · lote ${entrada.lot}`, entryId: entrada.id, movedAt: entrada.entryDate });
      movimientos++;
      if (p.salida) {
        await StockMovement.create({ productId: prod.id, quantity: -p.salida, type: "salida", reason: pick(["Consumo interno", "Entregado a un cliente", "Reposición de oficina"]), movedAt: daysAgo(rand(1, 15)) });
        movimientos++;
      }
    }
    await StockMovement.create({ productId: catalogo[0].id, quantity: -1, type: "ajuste", reason: "Recuento: un paquete dañado", movedAt: daysAgo(2) });
    movimientos++;

    const assets = [{ type: "hardware", name: "MacBook Pro 14\"", value: 2400 }, { type: "hardware", name: "Monitor LG 27\"", value: 350 }, { type: "software", name: "Adobe Creative Cloud", value: 600 }, { type: "license", name: "Figma Organization", value: 540 }];
    for (const a of assets) await Asset.create({ type: a.type, name: a.name, serialNumber: `SN-${rand(1000, 9999)}`, status: pick(["available", "assigned"]), assignedTo: Math.random() < 0.6 ? pick(equipo)?.id : null, purchaseDate: daysAgo(rand(30, 800)), value: a.value });
    return `${catalogo.length} productos · ${movimientos} movimientos · ${assets.length} activos`;
  });

  // ── 6. CITAS ────────────────────────────────────────────────────────────────
  // Va ANTES de Facturación a propósito (29/08/2026): las facturas de cita se
  // ligan a estos tipos (invoices.event_type_id), que es de donde la portada
  // saca «Ingresos por servicio». Y cada reserva lleva su PROFESIONAL y cae en
  // el MES EN CURSO: sin eso, la «Ocupación del equipo» no tiene numerador.
  let tiposCita = [];
  await tryModule("Citas", async () => {
    const { EventType, Availability, Booking } = models;
    const types = TIPOS_CITA_DEMO;
    // La misma comprobación que hace la pantalla al guardar. Sembrar saltándose
    // esta regla es lo que dejó los 8 tipos de las demos imposibles de guardar
    // (28/08/2026): nacían aceptando presencial sin dirección. Aquí revienta el
    // seed en vez de dejarlo pasar en silencio.
    for (const t of types) {
      const error = validateModalityFields(t);
      if (error) throw new Error(`Tipo de cita "${t.name}" inválido: ${error}`);
    }
    for (let i = 0; i < types.length; i++) {
      const [e] = await EventType.findOrCreate({ where: { slug: types[i].slug }, defaults: { ...types[i], bufferBefore: 5, bufferAfter: 5, active: true, order: i, minNoticeHours: 3, maxAdvanceDays: 60, description: "Cita de ejemplo." } });
      tiposCita.push(e);
    }
    for (const day of [1, 2, 3, 4, 5]) await Availability.findOrCreate({ where: { eventTypeId: null, dayOfWeek: day, startTime: "09:00:00", endTime: "14:00:00" }, defaults: { eventTypeId: null, dayOfWeek: day, startTime: "09:00:00", endTime: "14:00:00" } });

    const diaHoy = new Date().getDate();
    let n = 0;
    const reserva = async (teamMemberId, off) => {
      const et = pick(tiposCita);
      const d = new Date(); d.setDate(d.getDate() + off); d.setHours(rand(9, 18), pick([0, 15, 30, 45]), 0, 0);
      await Booking.create({
        eventTypeId: et.id, teamMemberId,
        clientName: `${pick(NOMBRES)} ${pick(APELLIDOS)}`, clientEmail: `cita${n}@example.com`,
        clientPhone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`,
        scheduledAt: d, duration: et.duration, modality: pick(et.modalities),
        // Pasadas casi todas atendidas (la ocupación cuenta confirmed/completed;
        // un no_show de vez en cuando es lo realista); futuras, confirmadas.
        status: off < 0 ? pick(["completed", "completed", "completed", "completed", "no_show"]) : "confirmed",
      });
      n++;
    };
    // La agenda de cada profesional, repartida entre el día 1 y dentro de ~10
    // días. Cargas DESIGUALES a propósito: una ocupación donde todos rondan el
    // mismo % canta a dato inventado.
    for (const m of equipo) {
      const cuantas = rand(9, 18);
      for (let i = 0; i < cuantas; i++) await reserva(m.id, rand(1 - diaHoy, 10));
    }
    // Y unas pocas sin profesional: alimentan «Citas sin profesional» y la
    // barra «Sin asignar» de la vista por profesional.
    for (let i = 0; i < 5; i++) await reserva(null, rand(-10, 15));
    return `${tiposCita.length} tipos · ${n} reservas`;
  });

  // ── 7. FACTURACIÓN (con IRPF + socio) ───────────────────────────────────────
  await tryModule("Facturación", async () => {
    const { Invoice, Payment, Cost, InvoiceSeries, TenantBillingSettings, Rate } = models;
    await TenantBillingSettings.findOrCreate({ where: {}, defaults: { fiscalName: "Sandbox Consultores CB", taxId: "E12345678", fiscalCity: "Madrid", fiscalCountry: "ES", defaultVatRate: 21, defaultIrpfRate: 15, partners: [{ id: "jorge", name: "Jorge" }, { id: "rodrigo", name: "Rodrigo" }] } });
    await InvoiceSeries.findOrCreate({ where: { code: "F" }, defaults: { code: "F", name: "Facturas", prefix: "F", year: 2026, nextNumber: 100, isDefault: true } });
    for (const em of equipo) await Rate.findOrCreate({ where: { employeeId: em.id, serviceType: "hora" }, defaults: { employeeId: em.id, serviceType: "hora", pricePerSession: rand(50, 95, 2), validFrom: daysAgo(365) } });

    let num = 0, nInv = 0, nPay = 0;
    for (let i = 0; i < 14; i++) {
      const nLines = rand(1, 3);
      const rawLines = [];
      for (let j = 0; j < nLines; j++) { const s = pick(SERVICIOS); rawLines.push({ description: s.desc, quantity: rand(1, 3), unitPrice: s.price, discountPct: 0, vatRate: 21 }); }
      const calc = calculateInvoice({ lines: rawLines, irpfRate: 15 });
      const r = Math.random();
      let status = "paid", paidAt = null, paidAmount = 0;
      if (r < 0.12) status = "draft";
      else if (r < 0.25) { status = "overdue"; }
      else if (r < 0.35) { status = "partially_paid"; paidAmount = +(calc.total * 0.5).toFixed(2); }
      else if (r < 0.55) status = "sent";
      else { status = "paid"; paidAt = dateAgo(rand(0, 40)); paidAmount = calc.total; }
      num++;
      const inv = await Invoice.create({
        clientId: pick(clientes).id, employeeId: pick(equipo)?.id ?? null, partnerId: pick(PARTNERS),
        series: "F", number: status === "draft" ? `DRAFT-${Date.now()}-${i}` : `F-2026-${String(100 + num).padStart(4, "0")}`,
        status, issueDate: daysAgo(rand(1, 170)), dueDate: daysAgo(rand(-30, 25) - 15), paidAt,
        lines: calc.lines, taxBase: calc.taxBase, vatAmount: calc.vatAmount, irpfRate: calc.irpfRate, irpfAmount: calc.irpfAmount,
        total: calc.total, paidAmount, subtotal: calc.taxBase, vatRate: 0,
      });
      nInv++;
      if (paidAmount > 0) { await Payment.create({ invoiceId: inv.id, amount: paidAmount, paidAt: paidAt ?? dateAgo(rand(5, 40)), method: pick(["transfer", "card", "direct_debit"]), status: "completed" }); nPay++; }
    }

    // Facturas de CITAS del mes en curso, ligadas a su tipo (29/08/2026):
    // «Ingresos por servicio» de la portada agrupa facturas por
    // invoices.event_type_id — el precio del tipo de cita no pinta nada ahí
    // (el dinero se sabe por facturas, no por precios de agenda). Reparto e
    // importes desiguales a mano: tres barras clavadas en la misma cifra
    // cantan a dato inventado.
    let nCitas = 0;
    if (tiposCita.length) {
      const PRECIO_CITA = { "primera-consulta": 70, "sesion-seguimiento": 48, "sesion-online": 35 };
      const diaHoy = new Date().getDate();
      const cupo = [];
      // El rango de cada tipo mantiene el orden (seguimiento > primera > online)
      // pero el total cambia de una siembra a otra: cuatro demos con las tres
      // barras clavadas en la misma cifra también cantarían.
      for (const [slug, veces] of [["sesion-seguimiento", rand(7, 11)], ["primera-consulta", rand(4, 7)], ["sesion-online", rand(2, 6)]]) {
        const et = tiposCita.find((t) => t.slug === slug);
        if (et) for (let k = 0; k < veces; k++) cupo.push(et);
      }
      for (const et of cupo) {
        const unit = PRECIO_CITA[et.slug] ?? 45;
        const calc = calculateInvoice({ lines: [{ description: et.name, quantity: 1, unitPrice: unit, discountPct: 0, vatRate: 21 }], irpfRate: 0 });
        const pagada = Math.random() < 0.7;
        const emitida = daysAgo(rand(0, Math.max(0, diaHoy - 1)));
        num++;
        const inv = await Invoice.create({
          clientId: pick(clientes).id, employeeId: pick(equipo)?.id ?? null, partnerId: pick(PARTNERS),
          eventTypeId: et.id,
          series: "F", number: `F-2026-${String(100 + num).padStart(4, "0")}`,
          status: pagada ? "paid" : "sent", issueDate: emitida, dueDate: daysAgo(-15),
          paidAt: pagada ? dateAgo(rand(0, 3)) : null,
          lines: calc.lines, taxBase: calc.taxBase, vatAmount: calc.vatAmount,
          irpfRate: calc.irpfRate, irpfAmount: calc.irpfAmount,
          total: calc.total, paidAmount: pagada ? calc.total : 0, subtotal: calc.taxBase, vatRate: 0,
        });
        if (pagada) { await Payment.create({ invoiceId: inv.id, amount: calc.total, paidAt: inv.paidAt, method: pick(["card", "transfer"]), status: "completed" }); nPay++; }
        nInv++; nCitas++;
      }
    }

    const costTpl = [
      { type: "rent", category: "fixed", desc: "Alquiler oficina" }, { type: "software", category: "fixed", desc: "Licencias SaaS" },
      { type: "salary", category: "fixed", desc: "Nómina equipo" }, { type: "material", category: "variable", desc: "Material de oficina" },
      { type: "commission", category: "variable", desc: "Comisiones comerciales" }, { type: "other", category: "opex", desc: "Gastos de viaje" },
      { type: "other", category: "capex", desc: "Equipamiento informático" },
    ];
    let nCost = 0;
    for (let i = 0; i < 12; i++) {
      const t = pick(costTpl); const base = rand(150, 2500, 2); const vatRate = 21; const taxAmount = +(base * vatRate / 100).toFixed(2);
      await Cost.create({ type: t.type, category: t.category, description: t.desc, taxBase: base, vatRate, taxAmount, total: +(base + taxAmount).toFixed(2), vatDeductible: true, incurredAt: daysAgo(rand(1, 170)), employeeId: t.type === "salary" ? pick(equipo)?.id : null, partnerId: pick(PARTNERS) });
      nCost++;
    }
    return `${nInv} facturas (${nCitas} de citas) · ${nPay} cobros · ${nCost} gastos`;
  });

  // ── 8. PEDIDOS ──────────────────────────────────────────────────────────────
  await tryModule("Pedidos", async () => {
    const { Order, OrderLine, OrderSettings } = models;
    await OrderSettings.findOrCreate({ where: {}, defaults: { transportPrice: 15 } }).catch(() => {});
    let n = 0;
    for (let i = 0; i < 22; i++) {
      const nLines = rand(1, 3); let subtotal = 0; const lines = [];
      // `productId` y `salePrice`, no `outboundProductId` ni `defaultSalePrice`:
      // el rework del 02/08/2026 fusionó el catálogo de salida en `Product` y
      // renombró la columna. Sequelize se traga en silencio un atributo que no
      // existe, así que esto no daba error — daba pedidos vacíos.
      for (let j = 0; j < nLines; j++) { const op = pick(catalogo); if (!op) continue; const qty = rand(1, 5); const unit = Number(op.salePrice); const lt = +(unit * qty).toFixed(2); subtotal += lt; lines.push({ productId: op.id, productName: op.name, quantity: qty, unitPrice: unit, lineTotal: lt }); }
      const transport = rand(0, 30, 2);
      const order = await Order.create({ clientId: pick(clientes).id, status: pick(["draft", "confirmed", "preparing", "shipped", "completed"]), subtotal: +subtotal.toFixed(2), transportAmount: transport, total: +(subtotal + transport).toFixed(2), scheduledDate: daysAgo(rand(-20, 5)), notes: null });
      for (const ld of lines) await OrderLine.create({ orderId: order.id, ...ld });
      n++;
    }
    return `${n} pedidos`;
  });

  // ── 9. CALENDARIO ───────────────────────────────────────────────────────────
  await tryModule("Calendario", async () => {
    const { CalendarTask } = models;
    const titles = ["Reunión equipo semanal", "Llamada con cliente", "Revisión de proyecto", "Preparar propuesta", "Demo producto", "Planificación mensual", "Entrega a cliente", "Formación interna"];
    let n = 0;
    for (let i = 0; i < 14; i++) {
      await CalendarTask.create({ title: pick(titles), notes: pick(["Confirmar asistencia 24h antes.", null, "Preparar guion.", null]), priority: pick(["low", "medium", "high"]), status: pick(["pending", "pending", "done"]), startDate: daysAgo(rand(-30, 30)), startTime: `${String(rand(9, 18)).padStart(2, "0")}:${pick(["00", "15", "30", "45"])}:00`, allDay: false, color: pick(["#3B82F6", "#10B981", "#F59E0B", "#EF4444"]) });
      n++;
    }
    return `${n} eventos`;
  });

  // ── 10. FORMACIÓN + CUESTIONARIOS ───────────────────────────────────────────
  await tryModule("Formación / Cuestionarios", async () => {
    const { Course, Company, TrainingUser, CourseEnrollment, QuizAttempt } = models;
    const courses = [];
    for (const nm of ["Introducción a la gestión", "Ofimática avanzada", "Prevención de riesgos"]) courses.push(await Course.create({ name: nm, active: true, wpCourseId: rand(100, 999) }));
    const companies = [];
    for (const nm of ["Colegio Aurora", "Grupo Industrial Vega"]) companies.push(await Company.create({ name: nm, nif: `A${rand(10000000, 99999999)}`, active: true }));
    const users = [];
    for (let i = 0; i < 12; i++) {
      const comp = Math.random() < 0.6 ? pick(companies) : null;
      const u = await TrainingUser.create({ companyId: comp?.id ?? null, type: comp ? "company" : "private", username: `alumno${i}`, email: `alumno${i}@example.com`, name: pick(NOMBRES), lastName: pick(APELLIDOS), active: true });
      users.push(u);
      const cur = pick(courses);
      await CourseEnrollment.create({ trainingUserId: u.id, courseId: cur.id, companyId: comp?.id ?? null, enrolledAt: dateAgo(rand(10, 120)) });
    }
    let nq = 0;
    for (let i = 0; i < 18; i++) {
      const total = rand(5, 15); const correct = rand(2, total); const passing = Math.ceil(total * 0.6);
      await QuizAttempt.create({
        wpAttemptId: 1000 + i, wpQuizId: rand(1, 5), wpCourseId: rand(100, 999), wpUserId: rand(1, 9999),
        studentName: `${pick(NOMBRES)} ${pick(APELLIDOS)}`, studentEmail: `alumno${i}@example.com`,
        quizTitle: pick(["Test módulo 1", "Evaluación final", "Prueba intermedia"]), courseTitle: pick(courses).name,
        empresa: pick([...companies.map((c) => c.name), "Particular"]), attemptDate: dateAgo(rand(1, 90)),
        totalQuestions: total, totalPoints: total, earnedPoints: correct, passingPoints: passing, correctAnswers: correct, incorrectAnswers: total - correct,
        result: correct >= passing ? "pass" : "fail", answers: [],
      });
      nq++;
    }
    return `${courses.length} cursos · ${users.length} alumnos · ${nq} intentos`;
  });

  // ── 11. PACIENTES ───────────────────────────────────────────────────────────
  // Cada paciente cuelga de su FAMILIA (una ficha de cliente que paga) por
  // patients.client_id. Sin ese enlace, todo lo que cruza paciente↔pagador sale
  // vacío en la demo: el buscador por paciente de facturas y presupuestos
  // (lib/clients/familiasPorPaciente.js), el reparto de cuotas y el portal
  // (comprobado en producción el 31/08/2026: los 9 de crm_demo con client_id
  // NULL). Y sus citas van a nombre de la familia CON el paciente puesto — la
  // cadena pagador → paciente → cita que anuncia la demo de clínica.
  let pacientes = [];
  await tryModule("Pacientes", async () => {
    const { Patient, Client, Booking } = models;
    const FAMILIAS = [2, 2, 1, 1, 1, 1, 1]; // 9 pacientes; dos familias con hermanos
    let nCitas = 0;
    for (const nHijos of FAMILIAS) {
      const apellido = pick(APELLIDOS);
      const familia = await Client.create({
        type: "individual",
        name: `${pick(NOMBRES)} ${apellido} ${pick(APELLIDOS)}`,
        email: `familia.${slugify(apellido)}${rand(10, 99)}@example.com`,
        phone: `+34 ${rand(600, 699)} ${rand(100, 999)} ${rand(100, 999)}`,
        status: "active",
        customFields: { showcase: "familia" },
      });
      clientes.push(familia);
      for (let h = 0; h < nHijos; h++) {
        const p = await Patient.create({
          clientId: familia.id, relationship: pick(["hijo", "hija"]),
          firstName: pick(NOMBRES), lastName: `${apellido} ${pick(APELLIDOS)}`,
          birthDate: daysAgo(rand(2500, 6000)), age: rand(7, 16),
          educationCenter: pick(["Colegio Aurora", "CEIP Las Palmeras", "IES Norte"]),
          educationLevel: pick(["Primaria", "ESO", "Infantil"]),
          referralReason: pick(["Dificultades de atención", "Apoyo en lectoescritura", "Regulación emocional"]),
          referredBy: pick(["Orientador escolar", "Pediatra", "Familia"]),
          mainTherapistId: pick(equipo)?.id ?? null, enrollmentDate: daysAgo(rand(30, 400)),
          attendanceFrequency: pick(["semanal", "quincenal"]), status: pick(["active", "active", "paused"]),
        });
        pacientes.push(p);
        if (!tiposCita.length) continue;
        const offsets = [-rand(3, 25)];
        if (p.status === "active") offsets.push(rand(2, 12)); // solo el activo tiene próxima cita
        for (const off of offsets) {
          const et = pick(tiposCita);
          const d = new Date(); d.setDate(d.getDate() + off); d.setHours(rand(16, 19), pick([0, 30]), 0, 0);
          await Booking.create({
            eventTypeId: et.id, teamMemberId: p.mainTherapistId,
            patientId: p.id, clientId: familia.id,
            clientName: familia.name, clientEmail: familia.email, clientPhone: familia.phone,
            scheduledAt: d, duration: et.duration, modality: pick(et.modalities),
            status: off < 0 ? "completed" : "confirmed",
          });
          nCitas++;
        }
      }
    }
    return `${pacientes.length} pacientes · ${FAMILIAS.length} familias pagadoras · ${nCitas} citas con paciente`;
  });

  // ── 12. CLÍNICA ─────────────────────────────────────────────────────────────
  await tryModule("Clínica", async () => {
    const { ClinicSession, ClinicalReport, Coordination, PerformanceMetric } = models;
    let ns = 0, nr = 0;
    for (const pac of pacientes) {
      const sesiones = rand(2, 5);
      for (let s = 0; s < sesiones; s++) {
        // clientId: foto del pagador al crearse, como hace la app (lib/clinica/patientClient.js).
        await ClinicSession.create({ patientId: pac.id, clientId: pac.clientId, therapistId: pac.mainTherapistId, sessionDate: daysAgo(rand(1, 120)), duration: 50, objectives: "Trabajar atención sostenida y autorregulación.", activities: "Ejercicios de atención + juego simbólico.", performance: pick(["Buena evolución", "Estable", "Mejora leve"]), observations: "El menor participó activamente.", status: pick(["published", "published", "draft"]) });
        ns++;
      }
      if (Math.random() < 0.6) { await ClinicalReport.create({ patientId: pac.id, clientId: pac.clientId, therapistId: pac.mainTherapistId, reportType: pick(["evolution", "admission"]), reportDate: daysAgo(rand(10, 90)), aiGenerated: false, contentSections: { resumen: "Informe de ejemplo." }, status: pick(["draft", "reviewed", "delivered"]) }); nr++; }
    }
    await Coordination.create({ coordinationType: "colegio", participants: ["Orientador", "Familia", "Terapeuta"], coordinationDate: daysAgo(rand(5, 60)), topics: "Seguimiento del caso.", agreements: "Reforzar pautas en casa.", nextActions: "Revisión en 1 mes.", relatedPatientId: pacientes[0]?.id ?? null, clientId: pacientes[0]?.clientId ?? null, createdById: pick(equipo)?.id ?? null }).catch(() => {});
    for (const em of equipo.slice(0, 3)) await PerformanceMetric.create({ therapistId: em.id, periodMonth: 6, periodYear: 2026, totalScore: rand(60, 95), proposedIncentive: rand(100, 500, 2) }).catch(() => {});
    return `${ns} sesiones · ${nr} informes`;
  });

  // ── 13. NUTRICIÓN ───────────────────────────────────────────────────────────
  await tryModule("Nutrición", async () => {
    const { Food, Plan, PlanMeal, PlanMealOption, PlanMealOptionFood } = models;
    const foods = [];
    const foodDefs = [["Avena", "g"], ["Plátano", "unidad"], ["Leche desnatada", "ml"], ["Pechuga de pollo", "g"], ["Arroz integral", "g"], ["Huevo", "unidad"], ["Aceite de oliva", "ml"], ["Yogur natural", "g"], ["Salmón", "g"], ["Espinacas", "g"], ["Almendras", "g"], ["Pan integral", "g"], ["Manzana", "unidad"], ["Atún", "g"], ["Lentejas", "g"], ["Queso fresco", "g"], ["Tomate", "unidad"], ["Pavo", "g"]];
    for (const [nm, u] of foodDefs) foods.push(await Food.create({ name: nm, slug: slugify(nm), defaultUnit: u, source: "custom", tags: [] }));
    let nPlan = 0;
    const mk = async (plan) => {
      for (const [mealName, order] of [["Desayuno", 0], ["Comida", 1], ["Cena", 2]]) {
        const meal = await PlanMeal.create({ planId: plan.id, name: mealName, order });
        const opt = await PlanMealOption.create({ mealId: meal.id, name: "Opción 1", order: 0, isDefault: true });
        for (let k = 0; k < 2; k++) { const f = pick(foods); await PlanMealOptionFood.create({ optionId: opt.id, foodId: f.id, amount: rand(30, 200), unit: "g", order: k }); }
      }
    };
    const tpl = await Plan.create({ name: "Plantilla · Mantenimiento", description: "Plantilla base.", type: "template", visibleToClient: false });
    await mk(tpl); nPlan++;
    for (let i = 0; i < 8; i++) { const p = await Plan.create({ name: `Plan de ${pick(NOMBRES)}`, description: "Plan asignado.", type: "assigned", templateId: tpl.id, clientId: pick(clientes)?.id ?? null, visibleToClient: true, assignedAt: dateAgo(rand(5, 60)) }); await mk(p); nPlan++; }
    return `${foods.length} alimentos · ${nPlan} planes`;
  });

  // ── Resumen ────────────────────────────────────────────────────────────────
  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(" Resumen por módulo\n");
  process.stdout.write("══════════════════════════════════════════════\n");
  for (const [k, v] of Object.entries(results)) process.stdout.write(`  ${v.startsWith("✗") ? "✗" : "✓"} ${k.padEnd(26)} ${v.replace(/^[✓✗] /, "")}\n`);
  process.stdout.write("══════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch(async (err) => { process.stderr.write(`\n✗ Error fatal: ${err.message}\n${err.stack}\n`); try { await closeAllConnections(); } catch {} process.exit(1); });
