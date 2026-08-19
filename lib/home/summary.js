import { Op, fn, col, literal } from "sequelize";
import { getKpisForPeriod } from "../billing/billingSummary.js";
import { veTodaLaAgenda } from "../citas/visibilidad.js";

/**
 * Agregador de la home "Tu día".
 *
 * Compone, en el servidor (RSC), los bloques de resumen de cada módulo que el
 * usuario tiene activo. Principios:
 *
 *  - REUSE-ONLY: cada bloque reejecuta consultas triviales (counts + listas
 *    recientes) que ya computan endpoints existentes, o reutiliza directamente
 *    sus funciones de `lib/` (p.ej. `getKpisForPeriod`). No introduce
 *    agregaciones nuevas.
 *  - GATING: se usa `ctx.hasModule(key)`, que YA cruza módulo del tenant ∩
 *    `user.moduleAccess`. Las magnitudes sensibles de finanzas (cobrado,
 *    márgenes, EBITDA) se gatean además por rol admin.
 *  - TENANT-WIDE: todos los widgets muestran datos de todo el negocio, CON UNA
 *    EXCEPCIÓN: la agenda. Aquí decía que "lo mío" era inviable porque Booking no
 *    tenía FK a usuario. Hoy `bookings.team_member_id` existe y el listado de
 *    citas ya filtra por él, así que esa premisa caducó — y mientras siguió
 *    escrita, este bloque enseñaba a CUALQUIER usuario las próximas citas de todo
 *    el equipo CON EL NOMBRE DEL PACIENTE. Lo cazó Rocío en nutri_laura el
 *    19/08/2026: le salían en su portada las citas de Laura. Ahora la agenda
 *    respeta la misma regla que el listado y el calendario
 *    (`lib/citas/visibilidad.js`): admin lo ve todo, un tenant con agenda
 *    compartida también, y el resto solo lo suyo. `CalendarTask` sigue sin FK a
 *    usuario, así que el bloque de tareas sí es de todo el negocio.
 *  - TOLERANCIA A SCHEMA PARCIAL: tenants como nutri_laura no tienen todas las
 *    tablas. Cada bloque corre dentro de `safeBlock`, que degrada a `null`
 *    (bloque omitido) si la tabla no existe (42P01) o la query falla, en lugar
 *    de tumbar toda la home. Por la misma razón las listas recientes evitan
 *    `include` a tablas que podrían no existir en un tenant parcial.
 */

function isMissingRelation(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01" || /relation .* does not exist/i.test(err?.message || "");
}

// Ejecuta un builder de bloque tolerando fallos: si la tabla no existe (schema
// parcial) o la query revienta, devuelve null y la home simplemente no pinta
// ese bloque. Un fallo aislado nunca debe romper la portada.
async function safeBlock(builder) {
  try {
    return await builder();
  } catch (err) {
    if (isMissingRelation(err)) return null;
    console.error("[home] bloque falló:", err?.message || err);
    return null;
  }
}

/**
 * La ficha de equipo de quien mira, o el centinela si no tiene ninguna.
 *
 * Devuelve el centinela y NO null a propósito: quien llama lo usa para filtrar, y
 * un null se leería como «no filtres». Si esto falla, la agenda sale vacía.
 */
const NADIE = "00000000-0000-0000-0000-000000000000";
async function miFichaDeEquipo(models, userId) {
  try {
    const { TeamMember } = models;
    if (!TeamMember || !userId) return NADIE;
    const tm = await TeamMember.findOne({ where: { userId }, attributes: ["id"] });
    return tm ? tm.id : NADIE;
  } catch {
    return NADIE;
  }
}

function isAdmin(user) {
  return !!user && (user.role === "admin" || user.role === "superadmin");
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function num(v) {
  return v != null ? Number(v) : null;
}

// Fecha local (no UTC) en YYYY-MM-DD. Se usa en TODO el agregador para "hoy" y
// para filtrar columnas DATEONLY (start_date, due_date), de modo que todos los
// bloques coincidan en el mismo día — evita el off-by-one cerca de medianoche en
// servidores en zona horaria distinta de UTC.
function localDateStr(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Rango del mes en curso: [primer día del mes, hoy] en YYYY-MM-DD local.
function monthRange() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = localDateStr(now);
  return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: today, today };
}

// ─── Bloque: Finanzas (billing) ─────────────────────────────────────────────
// Dos magnitudes operativas visibles para cualquier usuario con billing:
//   - Facturado del mes (base imponible).
//   - Vencido (cartera vencida efectiva) — mismo cálculo que /api/billing/operations.
// NO se muestra un "pendiente del mes": junto al "vencido" (que es cartera
// histórica, no acotada al mes) se leería como contradictorio (vencido ⊆
// pendiente, así que vencido > pendiente es imposible para el lector) y, además,
// exponer facturado + pendiente permitiría deducir el "cobrado" por resta
// (cobrado = facturado − pendiente), que es una magnitud sensible reservada a
// admin. La rentabilidad (cobrado, margen, EBITDA) se gatea a admin y usa las
// cifras canónicas de getKpisForPeriod (cobrado proporcional en base + márgenes).
//
// Los no-admin corren solo 2 queries (facturado del mes + vencido); las
// agregaciones de coste/márgenes de getKpisForPeriod solo se ejecutan para admin.
const ACTIVE_INVOICE_STATUSES = { [Op.notIn]: ["draft", "cancelled", "rectified"] };

async function buildFinance(models, { from, to, today, admin }) {
  const { Invoice } = models;

  // Vencido efectivo (cartera actual): emitidas/enviadas/parciales, vencidas y
  // no cobradas del todo. Importe = deuda pendiente (total − pagado), con IVA.
  const overdueRows = await Invoice.findAll({
    where: {
      status: { [Op.in]: ["issued", "sent", "partially_paid"] },
      dueDate: { [Op.lt]: today },
      paidAmount: { [Op.lt]: col("total") },
    },
    attributes: [
      [fn("COUNT", col("id")), "n"],
      [literal("COALESCE(SUM(total - paid_amount), 0)"), "sum"],
    ],
    raw: true,
  });
  const overdue = {
    count: Number(overdueRows[0]?.n || 0),
    amount: round2(Number(overdueRows[0]?.sum || 0)),
  };

  if (!admin) {
    // Operativo ligero: facturado del mes (base imponible) + nº facturas. Sin
    // getKpisForPeriod para no correr las 5 agregaciones (coste/márgenes/byMonth)
    // que aquí no se muestran. Estados activos = los mismos que getKpisForPeriod.
    const rows = await Invoice.findAll({
      where: { issueDate: { [Op.between]: [from, to] }, status: ACTIVE_INVOICE_STATUSES },
      attributes: [
        [fn("SUM", col("tax_base")), "billed"],
        [fn("COUNT", col("id")), "n"],
      ],
      raw: true,
    });
    return {
      month: { billed: round2(Number(rows[0]?.billed || 0)), invoices: Number(rows[0]?.n || 0) },
      overdue,
    };
  }

  // Admin: cifras canónicas completas (cobrado proporcional en base + márgenes)
  // reutilizando getKpisForPeriod — idénticas al Resumen de Facturación.
  const kpis = await getKpisForPeriod({ tenantModels: models, from, to });
  return {
    month: { billed: kpis.income.billedBase, invoices: kpis.income.invoiceCount },
    overdue,
    collected: kpis.income.collectedBase,
    collectedPct: kpis.income.collectedPct,
    margins: {
      net: kpis.margins.netMargin,
      netPct: kpis.margins.netMarginPct,
      ebitda: kpis.margins.ebitda,
    },
  };
}

// ─── Bloque: Salud (clinica / pacientes) ────────────────────────────────────
// Espeja los KPIs de /api/clinica/overview (counts + próxima entrega). No trae
// la lista de pacientes recientes para mantener el bloque ligero en la portada.
async function buildSalud(models) {
  const { ClinicSession, ClinicalReport, Patient } = models;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [patientsActive, sessionsMonth, reportsPending, reportsOverdue, nextReport] = await Promise.all([
    Patient.count({ where: { status: "active" } }),
    ClinicSession.count({ where: { sessionDate: { [Op.gte]: monthStart } } }),
    ClinicalReport.count({ where: { status: { [Op.ne]: "delivered" } } }),
    ClinicalReport.count({ where: { status: { [Op.ne]: "delivered" }, dueDate: { [Op.lt]: now } } }),
    ClinicalReport.findOne({
      where: { status: { [Op.ne]: "delivered" }, dueDate: { [Op.ne]: null } },
      order: [["dueDate", "ASC"]],
      include: [{ model: Patient, as: "patient", attributes: ["firstName", "lastName"] }],
    }),
  ]);

  return {
    patientsActive,
    sessionsMonth,
    reportsPending,
    reportsOverdue,
    nextDelivery: nextReport
      ? {
          dueDate: nextReport.dueDate,
          patientName: nextReport.patient
            ? `${nextReport.patient.firstName} ${nextReport.patient.lastName}`.trim()
            : null,
        }
      : null,
  };
}

// ─── Bloque: Agenda (citas) ─────────────────────────────────────────────────
async function buildAgenda(models, { soloDe = null } = {}) {
  const { Booking, EventType } = models;
  // `soloDe` es la ficha de equipo de quien mira. Cuando toca filtrar y no se ha
  // podido resolver, llega el centinela y no sale ninguna cita: se falla CERRADO,
  // igual que `where.teamMemberId = myId ?? NADIE` en
  // app/api/citas/bookings/route.js. Un fallo de resolución no puede destapar la
  // agenda del equipo.
  const mias = soloDe ? { teamMemberId: soloDe } : {};
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const [todayCount, upcoming] = await Promise.all([
    Booking.count({
      where: {
        ...mias,
        scheduledAt: { [Op.between]: [startOfDay, endOfDay] },
        status: { [Op.notIn]: ["cancelled", "no_show"] },
      },
    }),
    Booking.findAll({
      where: { ...mias, scheduledAt: { [Op.gte]: now }, status: { [Op.notIn]: ["cancelled", "no_show"] } },
      attributes: ["id", "clientName", "scheduledAt", "status", "eventTypeId"],
      include: [{ model: EventType, as: "eventType", attributes: ["id", "name", "color"] }],
      order: [["scheduledAt", "ASC"]],
      limit: 5,
    }),
  ]);

  return {
    todayCount,
    upcoming: upcoming.map((b) => ({
      id: b.id,
      clientName: b.clientName,
      scheduledAt: b.scheduledAt,
      eventType: b.eventType ? { name: b.eventType.name, color: b.eventType.color } : null,
    })),
  };
}

// ─── Bloque: Tareas del calendario (calendar) ───────────────────────────────
async function buildTareas(models) {
  const { CalendarTask } = models;
  const today = localDateStr(); // fecha local, consistente con el resto de bloques

  const [pendingCount, todaysTasks] = await Promise.all([
    CalendarTask.count({ where: { status: "pending" } }),
    CalendarTask.findAll({
      where: { startDate: today, status: { [Op.ne]: "cancelled" } },
      attributes: ["id", "title", "priority", "status", "startTime", "allDay"],
      order: [["startTime", "ASC"]],
      limit: 6,
    }),
  ]);

  return {
    pendingCount,
    today: todaysTasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      startTime: t.startTime,
      allDay: t.allDay,
    })),
  };
}

// ─── Bloque: Clientes (clients) ─────────────────────────────────────────────
async function buildClientes(models) {
  const { Client } = models;
  const [total, companies, individuals, recent] = await Promise.all([
    Client.count(),
    Client.count({ where: { type: "company" } }),
    Client.count({ where: { type: "individual" } }),
    Client.findAll({ attributes: ["id", "name", "type", "createdAt"], order: [["createdAt", "DESC"]], limit: 5 }),
  ]);
  return {
    total,
    companies,
    individuals,
    recent: recent.map((c) => ({ id: c.id, name: c.name, type: c.type })),
  };
}

// ─── Bloque: Leads (leads / sales) ──────────────────────────────────────────
// Etapas terminales (no cuentan como "abierto"). Incluye las del embudo estándar
// (won/lost/closed_yes/closed_no) y la terminal del embudo nutricional de
// nutri_laura ("paciente" = convertido a paciente activo), para no inflar el
// contador de leads abiertos con conversiones ya cerradas. Ver lib/leads/stages.js.
const CLOSED_STAGES = ["won", "lost", "closed_yes", "closed_no", "paciente"];
async function buildLeads(models) {
  const { Lead } = models;
  const [totalOpen, recent] = await Promise.all([
    Lead.count({ where: { stage: { [Op.notIn]: CLOSED_STAGES } } }),
    Lead.findAll({
      attributes: ["id", "name", "title", "stage", "value", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: 5,
    }),
  ]);
  return {
    totalOpen,
    recent: recent.map((l) => ({
      id: l.id,
      name: l.name || l.title || "—",
      stage: l.stage,
      value: num(l.value),
    })),
  };
}

// ─── Bloque: Captación (outreach) ───────────────────────────────────────────
async function buildOutreach(models) {
  const { OutreachLead } = models;
  const [total, pendingAnalysis, recent] = await Promise.all([
    OutreachLead.count({ where: { converted: false } }),
    OutreachLead.count({ where: { analyzed: false, converted: false } }),
    OutreachLead.findAll({
      where: { converted: false },
      attributes: ["id", "name", "sector", "location", "analyzed", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: 5,
    }),
  ]);
  return {
    total,
    pendingAnalysis,
    recent: recent.map((o) => ({
      id: o.id,
      name: o.name,
      sector: o.sector,
      location: o.location,
      analyzed: o.analyzed,
    })),
  };
}

// ─── Bloque: Nutrición (nutricion) ──────────────────────────────────────────
async function buildNutricion(models) {
  const { Plan } = models;
  const [templates, assigned, recent] = await Promise.all([
    Plan.count({ where: { type: "template", archivedAt: null } }),
    Plan.count({ where: { type: "assigned", archivedAt: null } }),
    Plan.findAll({
      where: { archivedAt: null },
      attributes: ["id", "name", "type", "updatedAt"],
      order: [["updatedAt", "DESC"]],
      limit: 5,
    }),
  ]);
  return {
    templates,
    assigned,
    recent: recent.map((p) => ({ id: p.id, name: p.name, type: p.type })),
  };
}

// ─── Bloque: Formación (training) ───────────────────────────────────────────
async function buildFormacion(models) {
  const { CourseEnrollment, TrainingUser, Course, TrainingSyncLog } = models;

  const [totalEnrollments, activeUsers, recentEnrollments] = await Promise.all([
    CourseEnrollment.count(),
    TrainingUser.count({ where: { active: true, archivedAt: null } }),
    CourseEnrollment.findAll({
      attributes: ["id", "enrolledAt", "trainingUserId", "courseId"],
      include: [
        { model: TrainingUser, as: "trainingUser", attributes: ["id", "name", "lastName"] },
        { model: Course, as: "course", attributes: ["id", "name"] },
      ],
      order: [["enrolledAt", "DESC"]],
      limit: 5,
    }),
  ]);

  // La tabla training_sync_log solo existe en tenants con sync TutorLMS
  // (retorika). En un tenant B2C sin sync (nutri_laura) no existe. lastSync es
  // un dato secundario: CUALQUIER fallo aquí (tabla ausente 42P01, timeout,
  // deadlock…) se traga y deja lastSync=null — nunca debe tumbar el bloque de
  // formación, cuyos counts/matrículas ya se resolvieron arriba.
  let lastSync = null;
  try {
    const row = await TrainingSyncLog.findOne({ order: [["syncedAt", "DESC"]] });
    if (row) lastSync = { syncedAt: row.syncedAt, itemsSynced: row.itemsSynced };
  } catch (err) {
    if (!isMissingRelation(err)) {
      console.error("[home] lastSync formación falló (se omite):", err?.message || err);
    }
  }

  return {
    totalEnrollments,
    activeUsers,
    lastSync,
    recent: recentEnrollments.map((e) => ({
      id: e.id,
      enrolledAt: e.enrolledAt,
      user: e.trainingUser ? `${e.trainingUser.name || ""} ${e.trainingUser.lastName || ""}`.trim() : null,
      course: e.course ? e.course.name : null,
    })),
  };
}

// ─── Bloque: Pedidos (orders) ───────────────────────────────────────────────
async function buildPedidos(models) {
  const { Order, Client } = models;
  const [total, pending, recent] = await Promise.all([
    Order.count(),
    Order.count({ where: { status: { [Op.in]: ["draft", "confirmed", "preparing"] } } }),
    Order.findAll({
      attributes: ["id", "status", "total", "createdAt", "clientId"],
      include: [{ model: Client, as: "client", attributes: ["id", "name"], required: false }],
      order: [["createdAt", "DESC"]],
      limit: 5,
    }),
  ]);
  return {
    total,
    pending,
    recent: recent.map((o) => ({
      id: o.id,
      status: o.status,
      total: o.total != null ? Number(o.total) : 0,
      client: o.client ? o.client.name : null,
    })),
  };
}

// ─── Orquestador ────────────────────────────────────────────────────────────

/**
 * Construye el resumen de la home para el contexto de tenant dado.
 * @param {object} ctx - contexto de `getTenantContext`: { hasModule, tenantModels, user }
 * @returns {Promise<{blocks: object, admin: boolean}>} `blocks` es el mapa
 *   { <clave-bloque>: datos } solo con los bloques activos y con datos; `admin`
 *   es la única fuente de verdad para gatear la rentabilidad en la UI (el
 *   componente NO debe recalcular el rol por su cuenta).
 */
export async function buildHomeSummary(ctx) {
  const { hasModule, tenantModels, user, tenant } = ctx;
  const admin = isAdmin(user);

  // Sin usuario identificable no se compone ningún widget. ctx.hasModule() falla
  // ABIERTO cuando user es null (devuelve true para todo módulo del tenant; ver
  // tenantResolver.buildContext), pensado para webhooks/endpoints públicos sin
  // usuario. En la home eso expondría counts y listas de todos los módulos a un
  // principal que no podemos identificar (p.ej. usuario borrado con un JWT aún
  // válido), así que aquí exigimos usuario.
  if (!user) return { blocks: {}, admin: false };

  // La agenda es el único bloque que no es de todo el negocio (ver cabecera).
  let soloMisCitas = null;
  if (hasModule("citas") && hasModule("team") && !veTodaLaAgenda({ tenant, role: user.role })) {
    soloMisCitas = await miFichaDeEquipo(tenantModels, user.id);
  }

  const range = monthRange();

  const jobs = [];
  const add = (key, gate, builder) => {
    if (gate) jobs.push(safeBlock(builder).then((data) => ({ key, data })));
  };

  add("agenda", hasModule("citas"), () => buildAgenda(tenantModels, { soloDe: soloMisCitas }));
  add("tareas", hasModule("calendar"), () => buildTareas(tenantModels));
  add("salud", hasModule("clinica") || hasModule("pacientes"), () => buildSalud(tenantModels));
  add("finance", hasModule("billing"), () =>
    buildFinance(tenantModels, { from: range.from, to: range.to, today: range.today, admin })
  );
  add("clientes", hasModule("clients"), () => buildClientes(tenantModels));
  add("leads", hasModule("leads"), () => buildLeads(tenantModels));
  add("outreach", hasModule("outreach"), () => buildOutreach(tenantModels));
  add("nutricion", hasModule("nutricion"), () => buildNutricion(tenantModels));
  add("formacion", hasModule("training"), () => buildFormacion(tenantModels));
  add("pedidos", hasModule("orders"), () => buildPedidos(tenantModels));

  /**
   * ¿Este bloque no tiene NADA que contar? (08/08/2026)
   *
   * Tener un módulo encendido no significa usarlo. A Aumenta se le activaron
   * inventario, pedidos, proyectos y calendario en bloque para sembrar datos de
   * escaparate; luego se borraron los datos y los módulos se quedaron. Resultado
   * para un centro de psicología: quince personas abrían el CRM cada mañana y lo
   * primero que veían era «0 pedidos · 0 en curso».
   *
   * Un bloque a cero no informa de nada — nadie necesita que le recuerden a
   * diario que no tiene pedidos— así que se calla. En cuanto haya un solo
   * registro vuelve solo, sin tocar nada.
   *
   * Se mira solo los números y el tamaño de las listas, no el contenido: da
   * igual la forma que tenga cada bloque.
   */
  function bloqueVacio(data) {
    if (!data || typeof data !== "object") return true;
    for (const v of Object.values(data)) {
      if (Array.isArray(v)) { if (v.length) return false; continue; }
      if (typeof v === "number") { if (v !== 0) return false; continue; }
      // Cualquier otra cosa con valor (texto, fecha, objeto) cuenta como algo
      // que contar: no se esconde un bloque por no entenderlo.
      if (v !== null && v !== undefined && v !== "" && v !== false) return false;
    }
    return true;
  }

  const results = await Promise.all(jobs);
  const blocks = {};
  for (const r of results) if (r.data && !bloqueVacio(r.data)) blocks[r.key] = r.data;
  return { blocks, admin };
}
