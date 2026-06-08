import { createSequelizeInstance } from "./sequalize.js";
import { defineClient } from "../../models/tenant/Client.model.js";
import { defineContact } from "../../models/tenant/Contact.model.js";
import { defineLead } from "../../models/tenant/Lead.model.js";
import { defineProject } from "../../models/tenant/Project.model.js";
import { defineTask } from "../../models/tenant/Task.model.js";
import { defineTicket } from "../../models/tenant/Ticket.model.js";
import { defineInvoice } from "../../models/tenant/Invoice.model.js";
import { definePayment } from "../../models/tenant/Payment.model.js";
import { defineRate } from "../../models/tenant/Rate.model.js";
import { defineRecurringInvoice } from "../../models/tenant/RecurringInvoice.model.js";
import { defineCost } from "../../models/tenant/Cost.model.js";
import { defineTeamMember } from "../../models/tenant/TeamMember.model.js";
import { defineAsset } from "../../models/tenant/Asset.model.js";
import { defineTraining } from "../../models/tenant/Training.model.js";
import { defineNotification } from "../../models/tenant/Notification.model.js";
import { defineMessage } from "../../models/tenant/Message.model.js";
import { defineQuizAttempt } from "../../models/tenant/QuizAttempt.model.js";
import { defineCompany } from "../../models/tenant/Company.model.js";
import { defineCourse } from "../../models/tenant/Course.model.js";
import { defineCompanyCourse } from "../../models/tenant/CompanyCourse.model.js";
import { defineTrainingUser } from "../../models/tenant/TrainingUser.model.js";
import { defineCourseEnrollment } from "../../models/tenant/CourseEnrollment.model.js";
import { defineCalendarTask } from "../../models/tenant/CalendarTask.model.js";
import { defineInteraction } from "../../models/tenant/Interaction.model.js";
import { defineInboundProduct } from "../../models/tenant/InboundProduct.model.js";
import { defineInboundBatch } from "../../models/tenant/InboundBatch.model.js";
import { defineOutboundProduct } from "../../models/tenant/OutboundProduct.model.js";
import { defineFormula } from "../../models/tenant/Formula.model.js";
import { defineClientOutboundAlias } from "../../models/tenant/ClientOutboundAlias.model.js";
import { defineStockMovement } from "../../models/tenant/StockMovement.model.js";
import { defineInvoiceSeries } from "../../models/tenant/InvoiceSeries.model.js";
import { defineTenantBillingSettings } from "../../models/tenant/TenantBillingSettings.model.js";
import { definePhase } from "../../models/tenant/Phase.model.js";
import { defineMilestone } from "../../models/tenant/Milestone.model.js";
import { defineBoardColumn } from "../../models/tenant/BoardColumn.model.js";
import { defineProjectMember } from "../../models/tenant/ProjectMember.model.js";
import { defineProjectTemplate } from "../../models/tenant/ProjectTemplate.model.js";
import { defineEventType } from "../../models/tenant/EventType.model.js";
import { defineAvailability } from "../../models/tenant/Availability.model.js";
import { defineBooking } from "../../models/tenant/Booking.model.js";
import { defineOrder } from "../../models/tenant/Order.model.js";
import { defineOrderLine } from "../../models/tenant/OrderLine.model.js";
import { defineOrderSettings } from "../../models/tenant/OrderSettings.model.js";
import { defineClinicSession } from "../../models/tenant/ClinicSession.model.js";
import { defineCoordination } from "../../models/tenant/Coordination.model.js";
import { defineClinicalReport } from "../../models/tenant/ClinicalReport.model.js";
import { definePerformanceMetric } from "../../models/tenant/PerformanceMetric.model.js";
import { definePatient } from "../../models/tenant/Patient.model.js";

// Map<slug, { sequelize, models, lastUsed }>
const pool = new Map();
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

function initTenantDb(slug) {
  const schema = `crm_${slug}`;
  const sequelize = createSequelizeInstance(schema);

  // ── Modelos base ────────────────────────────────────────────────────────────
  const Client = defineClient(sequelize);
  const Contact = defineContact(sequelize);
  const Lead = defineLead(sequelize);
  const Project = defineProject(sequelize);
  const Task = defineTask(sequelize);
  const Ticket = defineTicket(sequelize);
  const TeamMember = defineTeamMember(sequelize);
  const Phase = definePhase(sequelize);
  const Milestone = defineMilestone(sequelize);
  const BoardColumn = defineBoardColumn(sequelize);
  const ProjectMember = defineProjectMember(sequelize);
  const ProjectTemplate = defineProjectTemplate(sequelize);
  const Asset = defineAsset(sequelize);
  const Training = defineTraining(sequelize);
  const Notification = defineNotification(sequelize);
  const Message = defineMessage(sequelize);
  const QuizAttempt = defineQuizAttempt(sequelize);

  // ── Módulo de formación ─────────────────────────────────────────────────────
  const Company = defineCompany(sequelize);
  const Course = defineCourse(sequelize);
  const CompanyCourse = defineCompanyCourse(sequelize);
  const TrainingUser = defineTrainingUser(sequelize);
  const CourseEnrollment = defineCourseEnrollment(sequelize);

  // ── Módulo de calendario ────────────────────────────────────────────────────
  const CalendarTask = defineCalendarTask(sequelize);

  // ── Módulo de citas (Sprint 1) ──────────────────────────────────────────────
  const EventType = defineEventType(sequelize);
  const Availability = defineAvailability(sequelize);
  const Booking = defineBooking(sequelize);

  // ── Módulo de pedidos (Sprint 2 — spain_enzymes) ────────────────────────────
  const Order = defineOrder(sequelize);
  const OrderLine = defineOrderLine(sequelize);
  const OrderSettings = defineOrderSettings(sequelize);

  // ── Módulo de Clínica (Sprint 1 — solo aumenta, datos dummy) ───────────────
  const ClinicSession = defineClinicSession(sequelize);
  const Coordination = defineCoordination(sequelize);
  const ClinicalReport = defineClinicalReport(sequelize);
  const PerformanceMetric = definePerformanceMetric(sequelize);

  // ── Módulo de Pacientes (Sprint 1 — solo aumenta, datos dummy) ─────────────
  const Patient = definePatient(sequelize);

  // ── Módulo de clientes (interacciones) ──────────────────────────────────────
  const Interaction = defineInteraction(sequelize);

  // ── Módulo de inventario ────────────────────────────────────────────────────
  const InboundProduct = defineInboundProduct(sequelize);
  const InboundBatch = defineInboundBatch(sequelize);
  const OutboundProduct = defineOutboundProduct(sequelize);
  const Formula = defineFormula(sequelize);
  const ClientOutboundAlias = defineClientOutboundAlias(sequelize);
  const StockMovement = defineStockMovement(sequelize);

  // ── Módulo de facturación ───────────────────────────────────────────────────
  const Invoice = defineInvoice(sequelize);
  const Payment = definePayment(sequelize);
  const Rate = defineRate(sequelize);
  const RecurringInvoice = defineRecurringInvoice(sequelize);
  const Cost = defineCost(sequelize);
  const InvoiceSeries = defineInvoiceSeries(sequelize);
  const TenantBillingSettings = defineTenantBillingSettings(sequelize);

  // ── Asociaciones base ───────────────────────────────────────────────────────
  Client.hasMany(Interaction, { foreignKey: "clientId", as: "interactions" });
  Interaction.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Client.hasMany(Contact, { foreignKey: "clientId", as: "contacts" });
  Contact.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Client.hasMany(Lead, { foreignKey: "clientId", as: "leads" });
  Lead.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Client.hasMany(Project, { foreignKey: "clientId", as: "projects" });
  Project.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Project.hasMany(Task, { foreignKey: "projectId", as: "tasks" });
  Task.belongsTo(Project, { foreignKey: "projectId", as: "project" });

  // ── Asociaciones del módulo Proyectos ───────────────────────────────────────
  Project.hasMany(Phase, { foreignKey: "projectId", as: "phases" });
  Phase.belongsTo(Project, { foreignKey: "projectId", as: "project" });

  Project.hasMany(Milestone, { foreignKey: "projectId", as: "milestones" });
  Milestone.belongsTo(Project, { foreignKey: "projectId", as: "project" });

  Phase.hasMany(Milestone, { foreignKey: "phaseId", as: "milestones" });
  Milestone.belongsTo(Phase, { foreignKey: "phaseId", as: "phase" });

  Project.hasMany(BoardColumn, { foreignKey: "projectId", as: "boardColumns" });
  BoardColumn.belongsTo(Project, { foreignKey: "projectId", as: "project" });

  Project.hasMany(ProjectMember, { foreignKey: "projectId", as: "members" });
  ProjectMember.belongsTo(Project, { foreignKey: "projectId", as: "project" });
  TeamMember.hasMany(ProjectMember, { foreignKey: "teamMemberId", as: "projectMemberships" });
  ProjectMember.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

  // Tasks ↔ fases / hitos / columnas / asignado
  Phase.hasMany(Task, { foreignKey: "phaseId", as: "tasks" });
  Task.belongsTo(Phase, { foreignKey: "phaseId", as: "phase" });

  Milestone.hasMany(Task, { foreignKey: "milestoneId", as: "tasks" });
  Task.belongsTo(Milestone, { foreignKey: "milestoneId", as: "milestone" });

  BoardColumn.hasMany(Task, { foreignKey: "boardColumnId", as: "tasks" });
  Task.belongsTo(BoardColumn, { foreignKey: "boardColumnId", as: "boardColumn" });

  TeamMember.hasMany(Task, { foreignKey: "assigneeId", as: "assignedTasks" });
  Task.belongsTo(TeamMember, { foreignKey: "assigneeId", as: "assignee" });

  // Lead ↔ Project (conversión)
  Project.hasMany(Lead, { foreignKey: "convertedProjectId", as: "convertedFromLeads" });
  Lead.belongsTo(Project, { foreignKey: "convertedProjectId", as: "convertedProject" });

  Client.hasMany(Ticket, { foreignKey: "clientId", as: "tickets" });
  Client.hasMany(Asset, { foreignKey: "clientId", as: "assets" });

  // ── Asociaciones de formación ───────────────────────────────────────────────
  Company.hasMany(TrainingUser, { foreignKey: "companyId", as: "trainingUsers" });
  TrainingUser.belongsTo(Company, { foreignKey: "companyId", as: "company" });

  Company.belongsToMany(Course, { through: CompanyCourse, foreignKey: "companyId", as: "courses" });
  Course.belongsToMany(Company, { through: CompanyCourse, foreignKey: "courseId", as: "companies" });

  TrainingUser.belongsToMany(Course, { through: CourseEnrollment, foreignKey: "trainingUserId", as: "enrolledCourses" });
  Course.belongsToMany(TrainingUser, { through: CourseEnrollment, foreignKey: "courseId", as: "enrolledUsers" });

  CourseEnrollment.belongsTo(Company, { foreignKey: "companyId", as: "company" });
  CourseEnrollment.belongsTo(TrainingUser, { foreignKey: "trainingUserId", as: "trainingUser" });
  CourseEnrollment.belongsTo(Course, { foreignKey: "courseId", as: "course" });

  // ── Asociaciones de facturación ─────────────────────────────────────────────
  Client.hasMany(Invoice, { foreignKey: "clientId", as: "invoices" });
  Invoice.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Invoice.hasMany(Payment, { foreignKey: "invoiceId", as: "payments" });
  Payment.belongsTo(Invoice, { foreignKey: "invoiceId", as: "invoice" });

  TeamMember.hasMany(Rate, { foreignKey: "employeeId", as: "rates" });
  Rate.belongsTo(TeamMember, { foreignKey: "employeeId", as: "employee" });

  TeamMember.hasMany(Invoice, { foreignKey: "employeeId", as: "invoicesAsEmployee" });
  Invoice.belongsTo(TeamMember, { foreignKey: "employeeId", as: "employee" });

  Client.hasMany(RecurringInvoice, { foreignKey: "clientId", as: "recurringInvoices" });
  RecurringInvoice.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  TeamMember.hasMany(Cost, { foreignKey: "employeeId", as: "costs" });
  Cost.belongsTo(TeamMember, { foreignKey: "employeeId", as: "employee" });

  // Costes imputables a un cliente concreto (viajes, comisiones, etc.)
  Client.hasMany(Cost, { foreignKey: "clientId", as: "costs" });
  Cost.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // Cost.inventoryProductId queda como columna histórica en BD pero sin
  // asociación Sequelize: el modelo InventoryProduct ya no existe. La columna
  // se limpiará en una migración futura.

  // ── Asociaciones del nuevo inventario (Inbound/Outbound/Formula/Movements) ──
  InboundProduct.hasMany(InboundBatch, { foreignKey: "inboundProductId", as: "batches" });
  InboundBatch.belongsTo(InboundProduct, { foreignKey: "inboundProductId", as: "product" });

  InboundProduct.hasMany(Formula, { foreignKey: "inboundProductId", as: "formulaUses" });
  Formula.belongsTo(InboundProduct, { foreignKey: "inboundProductId", as: "inboundProduct" });

  OutboundProduct.hasMany(Formula, { foreignKey: "outboundProductId", as: "components" });
  Formula.belongsTo(OutboundProduct, { foreignKey: "outboundProductId", as: "outboundProduct" });

  Client.hasMany(Formula, { foreignKey: "clientId", as: "customFormulas" });
  Formula.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  OutboundProduct.hasMany(ClientOutboundAlias, { foreignKey: "outboundProductId", as: "aliases" });
  ClientOutboundAlias.belongsTo(OutboundProduct, { foreignKey: "outboundProductId", as: "outboundProduct" });

  Client.hasMany(ClientOutboundAlias, { foreignKey: "clientId", as: "outboundAliases" });
  ClientOutboundAlias.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  InboundBatch.hasMany(StockMovement, { foreignKey: "inboundBatchId", as: "movements" });
  StockMovement.belongsTo(InboundBatch, { foreignKey: "inboundBatchId", as: "batch" });

  Invoice.hasMany(StockMovement, { foreignKey: "invoiceId", as: "stockMovements" });
  StockMovement.belongsTo(Invoice, { foreignKey: "invoiceId", as: "invoice" });

  OutboundProduct.hasMany(StockMovement, { foreignKey: "outboundProductId", as: "movements" });
  StockMovement.belongsTo(OutboundProduct, { foreignKey: "outboundProductId", as: "outboundProduct" });

  Client.hasMany(StockMovement, { foreignKey: "clientId", as: "stockMovements" });
  StockMovement.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // FK durmientes a Project (Sprint 1 Proyectos). Se activan en Sprint 4.
  Project.hasMany(Cost, { foreignKey: "projectId", as: "costs" });
  Cost.belongsTo(Project, { foreignKey: "projectId", as: "project" });

  Project.hasMany(Invoice, { foreignKey: "projectId", as: "invoices" });
  Invoice.belongsTo(Project, { foreignKey: "projectId", as: "project" });

  // Asset.belongsTo(Client) que faltaba (Client.hasMany ya estaba)
  Asset.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // Self-relations en Invoice para rectificativas
  Invoice.belongsTo(Invoice, { foreignKey: "rectifiesInvoiceId", as: "rectifies" });
  Invoice.belongsTo(Invoice, { foreignKey: "rectifiedByInvoiceId", as: "rectifiedBy" });

  // ── Asociaciones del módulo Citas ───────────────────────────────────────────
  EventType.hasMany(Availability, { foreignKey: "eventTypeId", as: "availabilities" });
  Availability.belongsTo(EventType, { foreignKey: "eventTypeId", as: "eventType" });

  EventType.hasMany(Booking, { foreignKey: "eventTypeId", as: "bookings" });
  Booking.belongsTo(EventType, { foreignKey: "eventTypeId", as: "eventType" });

  // ── Asociaciones del módulo Pedidos ────────────────────────────────────────
  Client.hasMany(Order, { foreignKey: "clientId", as: "orders" });
  Order.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Order.hasMany(OrderLine, { foreignKey: "orderId", as: "lines" });
  OrderLine.belongsTo(Order, { foreignKey: "orderId", as: "order" });

  OutboundProduct.hasMany(OrderLine, { foreignKey: "outboundProductId", as: "orderLines" });
  OrderLine.belongsTo(OutboundProduct, { foreignKey: "outboundProductId", as: "outboundProduct" });

  Invoice.hasOne(Order, { foreignKey: "invoiceId", as: "order" });
  Order.belongsTo(Invoice, { foreignKey: "invoiceId", as: "invoice" });

  // ── Asociaciones del módulo Pacientes ──────────────────────────────────────
  TeamMember.hasMany(Patient, { foreignKey: "mainTherapistId", as: "patients" });
  Patient.belongsTo(TeamMember, { foreignKey: "mainTherapistId", as: "mainTherapist" });

  // ── Asociaciones del módulo Clínica (apuntan a Pacientes, no Clientes) ─────
  Patient.hasMany(ClinicSession, { foreignKey: "patientId", as: "clinicSessions" });
  ClinicSession.belongsTo(Patient, { foreignKey: "patientId", as: "patient" });

  TeamMember.hasMany(ClinicSession, { foreignKey: "therapistId", as: "clinicSessions" });
  ClinicSession.belongsTo(TeamMember, { foreignKey: "therapistId", as: "therapist" });

  Patient.hasMany(Coordination, { foreignKey: "relatedPatientId", as: "coordinations" });
  Coordination.belongsTo(Patient, { foreignKey: "relatedPatientId", as: "relatedPatient" });

  TeamMember.hasMany(Coordination, { foreignKey: "createdById", as: "coordinationsCreated" });
  Coordination.belongsTo(TeamMember, { foreignKey: "createdById", as: "createdBy" });

  Patient.hasMany(ClinicalReport, { foreignKey: "patientId", as: "clinicalReports" });
  ClinicalReport.belongsTo(Patient, { foreignKey: "patientId", as: "patient" });

  TeamMember.hasMany(ClinicalReport, { foreignKey: "therapistId", as: "clinicalReports" });
  ClinicalReport.belongsTo(TeamMember, { foreignKey: "therapistId", as: "therapist" });

  TeamMember.hasMany(PerformanceMetric, { foreignKey: "therapistId", as: "performanceMetrics" });
  PerformanceMetric.belongsTo(TeamMember, { foreignKey: "therapistId", as: "therapist" });

  TeamMember.hasMany(PerformanceMetric, { foreignKey: "approvedById", as: "performanceMetricsApproved" });
  PerformanceMetric.belongsTo(TeamMember, { foreignKey: "approvedById", as: "approvedBy" });

  const models = {
    Client,
    Contact,
    Lead,
    Project,
    Task,
    Ticket,
    Invoice,
    Payment,
    Rate,
    RecurringInvoice,
    Cost,
    InvoiceSeries,
    TenantBillingSettings,
    TeamMember,
    Asset,
    Training,
    Notification,
    Message,
    QuizAttempt,
    Company,
    Course,
    CompanyCourse,
    TrainingUser,
    CourseEnrollment,
    CalendarTask,
    Interaction,
    InboundProduct,
    InboundBatch,
    OutboundProduct,
    Formula,
    ClientOutboundAlias,
    StockMovement,
    Phase,
    Milestone,
    BoardColumn,
    ProjectMember,
    ProjectTemplate,
    EventType,
    Availability,
    Booking,
    Order,
    OrderLine,
    OrderSettings,
    ClinicSession,
    Coordination,
    ClinicalReport,
    PerformanceMetric,
    Patient,
  };

  return { sequelize, models };
}

export function getTenantDb(slug) {
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) {
    throw new Error(`Invalid tenant slug: ${slug}`);
  }

  const cached = pool.get(slug);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached;
  }

  const { sequelize, models } = initTenantDb(slug);
  const entry = { sequelize, models, lastUsed: Date.now() };
  pool.set(slug, entry);
  return entry;
}

export async function closeAllConnections() {
  const closings = [];
  for (const [slug, entry] of pool.entries()) {
    closings.push(entry.sequelize.close().then(() => pool.delete(slug)));
  }
  await Promise.all(closings);
}

export function getPoolStats() {
  const stats = [];
  for (const [slug, entry] of pool.entries()) {
    stats.push({
      slug,
      schema: `crm_${slug}`,
      idleMs: Date.now() - entry.lastUsed,
    });
  }
  return stats;
}

// Purge de conexiones idle cada 5 minutos
setInterval(async () => {
  const now = Date.now();
  for (const [slug, entry] of pool.entries()) {
    if (now - entry.lastUsed > IDLE_TIMEOUT_MS) {
      try {
        await entry.sequelize.close();
        pool.delete(slug);
      } catch {
        // Ignorar errores de cierre silencioso
      }
    }
  }
}, IDLE_TIMEOUT_MS);
