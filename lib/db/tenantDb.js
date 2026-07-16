import { createSequelizeInstance } from "./sequalize.js";
import { defineClient } from "../../models/tenant/Client.model.js";
import { defineContact } from "../../models/tenant/Contact.model.js";
import { defineLead } from "../../models/tenant/Lead.model.js";
import { defineProject } from "../../models/tenant/Project.model.js";
import { defineTask } from "../../models/tenant/Task.model.js";
import { defineTicket } from "../../models/tenant/Ticket.model.js";
import { defineInvoice } from "../../models/tenant/Invoice.model.js";
import { defineQuote } from "../../models/tenant/Quote.model.js";
import { definePayment } from "../../models/tenant/Payment.model.js";
import { defineRate } from "../../models/tenant/Rate.model.js";
import { defineRecurringInvoice } from "../../models/tenant/RecurringInvoice.model.js";
import { defineCost } from "../../models/tenant/Cost.model.js";
import { defineTeamMember } from "../../models/tenant/TeamMember.model.js";
import { defineTeamMemberModule } from "../../models/tenant/TeamMemberModule.model.js";
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
import { defineTrainingSyncLog } from "../../models/tenant/TrainingSyncLog.model.js";
import { defineCourseRegistration } from "../../models/tenant/CourseRegistration.model.js";
import { defineCalendarTask } from "../../models/tenant/CalendarTask.model.js";
import { defineInteraction } from "../../models/tenant/Interaction.model.js";
import { defineClientAttachment } from "../../models/tenant/ClientAttachment.model.js";
import { defineClientNote } from "../../models/tenant/ClientNote.model.js";
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
import { defineTaskAssignee } from "../../models/tenant/TaskAssignee.model.js";
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
import { defineFood } from "../../models/tenant/Food.model.js";
import { definePlan } from "../../models/tenant/Plan.model.js";
import { definePlanMeal } from "../../models/tenant/PlanMeal.model.js";
import { definePlanMealOption } from "../../models/tenant/PlanMealOption.model.js";
import { definePlanMealOptionFood } from "../../models/tenant/PlanMealOptionFood.model.js";
import { defineRecipe } from "../../models/tenant/Recipe.model.js";
import { defineRecipeFood } from "../../models/tenant/RecipeFood.model.js";
import { definePlanMealOptionRecipe } from "../../models/tenant/PlanMealOptionRecipe.model.js";
import { definePlanMealOptionRecipeFood } from "../../models/tenant/PlanMealOptionRecipeFood.model.js";
import { defineOutreachLead } from "../../models/tenant/OutreachLead.model.js";
import { defineOutreachContact } from "../../models/tenant/OutreachContact.model.js";
import { defineOutreachAnalysis } from "../../models/tenant/OutreachAnalysis.model.js";
import { defineOutreachBusinessLine } from "../../models/tenant/OutreachBusinessLine.model.js";
import { defineOutreachSettings } from "../../models/tenant/OutreachSettings.model.js";
import { defineDocumentFolder } from "../../models/tenant/DocumentFolder.model.js";
import { defineDocument } from "../../models/tenant/Document.model.js";
import { defineClientModuleAssignment } from "../../models/tenant/ClientModuleAssignment.model.js";

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
  const TeamMemberModule = defineTeamMemberModule(sequelize);
  const Phase = definePhase(sequelize);
  const Milestone = defineMilestone(sequelize);
  const BoardColumn = defineBoardColumn(sequelize);
  const ProjectMember = defineProjectMember(sequelize);
  const ProjectTemplate = defineProjectTemplate(sequelize);
  const TaskAssignee = defineTaskAssignee(sequelize);
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
  const TrainingSyncLog = defineTrainingSyncLog(sequelize);
  const CourseRegistration = defineCourseRegistration(sequelize);

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

  // ── Módulo de Nutrición (Sprint C1 + C2 — solo nutri_laura) ────────────────
  const Food = defineFood(sequelize);
  const Plan = definePlan(sequelize);
  const PlanMeal = definePlanMeal(sequelize);
  const PlanMealOption = definePlanMealOption(sequelize);
  const PlanMealOptionFood = definePlanMealOptionFood(sequelize);
  // Sprint 8.2 — Recetas (recetario reutilizable + snapshot congelado en planes)
  const Recipe = defineRecipe(sequelize);
  const RecipeFood = defineRecipeFood(sequelize);
  const PlanMealOptionRecipe = definePlanMealOptionRecipe(sequelize);
  const PlanMealOptionRecipeFood = definePlanMealOptionRecipeFood(sequelize);

  // ── Módulo de Outreach (captación: leads scrapeados + scoring IA) ─────────
  // Entidades independientes del módulo Leads del CRM: un OutreachLead es una
  // empresa captada y aún no contactada, no una oportunidad comercial.
  const OutreachBusinessLine = defineOutreachBusinessLine(sequelize);
  const OutreachLead = defineOutreachLead(sequelize);
  const OutreachContact = defineOutreachContact(sequelize);
  const OutreachAnalysis = defineOutreachAnalysis(sequelize);
  const OutreachSettings = defineOutreachSettings(sequelize);

  // ── Módulo de clientes (interacciones + notas + attachments) ──────────────
  const Interaction = defineInteraction(sequelize);
  const ClientNote = defineClientNote(sequelize);
  const ClientAttachment = defineClientAttachment(sequelize);

  // ── Módulo Documents (Drive básico) ─────────────────────────────────────────
  const DocumentFolder = defineDocumentFolder(sequelize);
  const Document = defineDocument(sequelize);

  // ── Asignación de clientes a módulos (nutricion/clinica) ────────────────────
  const ClientModuleAssignment = defineClientModuleAssignment(sequelize);

  // ── Módulo de inventario ────────────────────────────────────────────────────
  const InboundProduct = defineInboundProduct(sequelize);
  const InboundBatch = defineInboundBatch(sequelize);
  const OutboundProduct = defineOutboundProduct(sequelize);
  const Formula = defineFormula(sequelize);
  const ClientOutboundAlias = defineClientOutboundAlias(sequelize);
  const StockMovement = defineStockMovement(sequelize);

  // ── Módulo de facturación ───────────────────────────────────────────────────
  const Invoice = defineInvoice(sequelize);
  const Quote = defineQuote(sequelize);
  const Payment = definePayment(sequelize);
  const Rate = defineRate(sequelize);
  const RecurringInvoice = defineRecurringInvoice(sequelize);
  const Cost = defineCost(sequelize);
  const InvoiceSeries = defineInvoiceSeries(sequelize);
  const TenantBillingSettings = defineTenantBillingSettings(sequelize);

  // ── Asociaciones base ───────────────────────────────────────────────────────
  Client.hasMany(Interaction, { foreignKey: "clientId", as: "interactions" });
  Interaction.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Client.hasMany(ClientNote, { foreignKey: "clientId", as: "clientNotes" });
  ClientNote.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Client.hasMany(ClientAttachment, { foreignKey: "clientId", as: "attachments" });
  ClientAttachment.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // ── Asignación de cliente a módulos ─────────────────────────────────────────
  Client.hasMany(ClientModuleAssignment, { foreignKey: "clientId", as: "moduleAssignments", onDelete: "CASCADE" });
  ClientModuleAssignment.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // Enlace Client → Patient (materialización de "Paciente Clínica"). FK lógica
  // client_id en patients (nullable): los pacientes clínicos históricos no lo
  // tienen. Solo existe en tenants con el módulo clinica/pacientes.
  Client.hasMany(Patient, { foreignKey: "clientId", as: "clinicPatients" });
  Patient.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // ── Asociaciones Documents ───────────────────────────────────────────────────
  DocumentFolder.hasMany(DocumentFolder, { foreignKey: "parentFolderId", as: "children", onDelete: "CASCADE" });
  DocumentFolder.belongsTo(DocumentFolder, { foreignKey: "parentFolderId", as: "parent" });
  DocumentFolder.hasMany(Document, { foreignKey: "folderId", as: "documents", onDelete: "CASCADE" });
  Document.belongsTo(DocumentFolder, { foreignKey: "folderId", as: "folder" });

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

  // Sprint 2 — N-a-N tareas ↔ team_members. La asociación legacy `assignee`
  // (1-a-1, arriba) se mantiene durante el sprint por retrocompatibilidad.
  // Backlog Sprint 3: eliminar columna `assignee_id` + asociación legacy.
  Task.belongsToMany(TeamMember, {
    through: TaskAssignee,
    foreignKey: "taskId",
    otherKey: "teamMemberId",
    as: "assignees",
  });
  TeamMember.belongsToMany(Task, {
    through: TaskAssignee,
    foreignKey: "teamMemberId",
    otherKey: "taskId",
    as: "assignedTasksMulti",
  });
  Task.hasMany(TaskAssignee, { foreignKey: "taskId", as: "assigneeLinks" });
  TaskAssignee.belongsTo(Task, { foreignKey: "taskId", as: "task" });
  TeamMember.hasMany(TaskAssignee, { foreignKey: "teamMemberId", as: "taskAssignments" });
  TaskAssignee.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

  // Módulos asignados por miembro (config, sin gate). Alias 'moduleAssignments'
  // deliberadamente distinto de 'moduleAccess' (login del User en master).
  TeamMember.hasMany(TeamMemberModule, { foreignKey: "teamMemberId", as: "moduleAssignments", onDelete: "CASCADE" });
  TeamMemberModule.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

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

  // CourseRegistration — formulario inicial del alumno antes de entrar al curso
  Course.hasMany(CourseRegistration, { foreignKey: "courseId", as: "registrations" });
  CourseRegistration.belongsTo(Course, { foreignKey: "courseId", as: "course" });

  TrainingUser.hasMany(CourseRegistration, { foreignKey: "trainingUserId", as: "registrations" });
  CourseRegistration.belongsTo(TrainingUser, { foreignKey: "trainingUserId", as: "trainingUser" });

  Company.hasMany(CourseRegistration, { foreignKey: "companyId", as: "registrations" });
  CourseRegistration.belongsTo(Company, { foreignKey: "companyId", as: "company" });

  // ── Asociaciones de facturación ─────────────────────────────────────────────
  Client.hasMany(Invoice, { foreignKey: "clientId", as: "invoices" });
  Invoice.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Invoice.hasMany(Payment, { foreignKey: "invoiceId", as: "payments" });
  Payment.belongsTo(Invoice, { foreignKey: "invoiceId", as: "invoice" });

  TeamMember.hasMany(Rate, { foreignKey: "employeeId", as: "rates" });
  Rate.belongsTo(TeamMember, { foreignKey: "employeeId", as: "employee" });

  TeamMember.hasMany(Invoice, { foreignKey: "employeeId", as: "invoicesAsEmployee" });
  Invoice.belongsTo(TeamMember, { foreignKey: "employeeId", as: "employee" });

  // ── Presupuestos (Quote) ──────────────────────────────────────────────────
  Client.hasMany(Quote, { foreignKey: "clientId", as: "quotes" });
  Quote.belongsTo(Client, { foreignKey: "clientId", as: "client" });
  TeamMember.hasMany(Quote, { foreignKey: "employeeId", as: "quotesAsEmployee" });
  Quote.belongsTo(TeamMember, { foreignKey: "employeeId", as: "employee" });
  Project.hasMany(Quote, { foreignKey: "projectId", as: "quotes" });
  Quote.belongsTo(Project, { foreignKey: "projectId", as: "project" });
  // Trazabilidad presupuesto → factura resultante
  Quote.belongsTo(Invoice, { foreignKey: "convertedInvoiceId", as: "convertedInvoice" });

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

  // Profesional asignado a la cita (nullable)
  TeamMember.hasMany(Booking, { foreignKey: "teamMemberId", as: "bookings" });
  Booking.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

  // ── Asociaciones del módulo Calendario ─────────────────────────────────────
  // FKs nullable: la tarea puede asociarse a un cliente y/o a un team member.
  Client.hasMany(CalendarTask, { foreignKey: "clientId", as: "calendarTasks" });
  CalendarTask.belongsTo(Client, { foreignKey: "clientId", as: "client" });
  TeamMember.hasMany(CalendarTask, { foreignKey: "teamMemberId", as: "calendarTasks" });
  CalendarTask.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

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

  // ── Asociaciones del módulo Nutrición (C2 — planes) ────────────────────────
  Plan.hasMany(PlanMeal, { foreignKey: "planId", as: "meals" });
  PlanMeal.belongsTo(Plan, { foreignKey: "planId", as: "plan" });

  PlanMeal.hasMany(PlanMealOption, { foreignKey: "mealId", as: "options" });
  PlanMealOption.belongsTo(PlanMeal, { foreignKey: "mealId", as: "meal" });

  PlanMealOption.hasMany(PlanMealOptionFood, { foreignKey: "optionId", as: "foods" });
  PlanMealOptionFood.belongsTo(PlanMealOption, { foreignKey: "optionId", as: "option" });

  Food.hasMany(PlanMealOptionFood, { foreignKey: "foodId", as: "planUses" });
  PlanMealOptionFood.belongsTo(Food, { foreignKey: "foodId", as: "food" });

  // Self-FK: plantilla origen de un plan asignado.
  Plan.belongsTo(Plan, { foreignKey: "templateId", as: "template" });
  Plan.hasMany(Plan, { foreignKey: "templateId", as: "assignments" });

  // FK lógica a Client (sin FK física para mantener consistencia con Booking,
  // que tampoco la tiene en nutri_laura). La integridad se valida en el
  // endpoint de assign comprobando Client.findByPk antes de crear el plan.
  Client.hasMany(Plan, { foreignKey: "clientId", as: "nutritionPlans" });
  Plan.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // ── Asociaciones del recetario (Sprint 8.2) ────────────────────────────────
  // Recipe → ingredientes (RecipeFood) → Food del catálogo.
  Recipe.hasMany(RecipeFood, { foreignKey: "recipeId", as: "ingredients", onDelete: "CASCADE" });
  RecipeFood.belongsTo(Recipe, { foreignKey: "recipeId", as: "recipe" });
  Food.hasMany(RecipeFood, { foreignKey: "foodId", as: "recipeUses" });
  RecipeFood.belongsTo(Food, { foreignKey: "foodId", as: "food" });

  // Opción de plan → recetas congeladas (PlanMealOptionRecipe) → ingredientes snapshot.
  PlanMealOption.hasMany(PlanMealOptionRecipe, { foreignKey: "planMealOptionId", as: "recipes", onDelete: "CASCADE" });
  PlanMealOptionRecipe.belongsTo(PlanMealOption, { foreignKey: "planMealOptionId", as: "option" });
  // Provenance a la Recipe origen (SET NULL — el snapshot sobrevive si se borra).
  Recipe.hasMany(PlanMealOptionRecipe, { foreignKey: "recipeId", as: "planUses" });
  PlanMealOptionRecipe.belongsTo(Recipe, { foreignKey: "recipeId", as: "recipe" });

  // Alias "ingredients" (no "foods") para no colisionar con PlanMealOption→foods
  // en los includes anidados del árbol (Sequelize genera SQL roto si se repite).
  PlanMealOptionRecipe.hasMany(PlanMealOptionRecipeFood, { foreignKey: "planMealOptionRecipeId", as: "ingredients", onDelete: "CASCADE" });
  PlanMealOptionRecipeFood.belongsTo(PlanMealOptionRecipe, { foreignKey: "planMealOptionRecipeId", as: "recipe" });
  Food.hasMany(PlanMealOptionRecipeFood, { foreignKey: "foodId", as: "recipeSnapshotUses" });
  PlanMealOptionRecipeFood.belongsTo(Food, { foreignKey: "foodId", as: "food" });

  // ── Asociaciones del módulo Outreach ───────────────────────────────────────
  // Sin FK hacia Client/Lead del CRM: Outreach es un pipeline de captación
  // independiente, por decisión de arquitectura (no hay puente de conversión).
  OutreachLead.hasMany(OutreachContact, { foreignKey: "outreachLeadId", as: "contacts" });
  OutreachContact.belongsTo(OutreachLead, { foreignKey: "outreachLeadId", as: "lead" });

  OutreachLead.hasMany(OutreachAnalysis, { foreignKey: "outreachLeadId", as: "analyses" });
  OutreachAnalysis.belongsTo(OutreachLead, { foreignKey: "outreachLeadId", as: "lead" });

  OutreachBusinessLine.hasMany(OutreachAnalysis, { foreignKey: "businessLineId", as: "analyses" });
  OutreachAnalysis.belongsTo(OutreachBusinessLine, { foreignKey: "businessLineId", as: "businessLine" });

  const models = {
    Client,
    Contact,
    Lead,
    Project,
    Task,
    Ticket,
    Invoice,
    Quote,
    Payment,
    Rate,
    RecurringInvoice,
    Cost,
    InvoiceSeries,
    TenantBillingSettings,
    TeamMember,
    TeamMemberModule,
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
    TrainingSyncLog,
    CourseRegistration,
    CalendarTask,
    Interaction,
    ClientNote,
    ClientAttachment,
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
    TaskAssignee,
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
    Food,
    Plan,
    PlanMeal,
    PlanMealOption,
    PlanMealOptionFood,
    Recipe,
    RecipeFood,
    PlanMealOptionRecipe,
    PlanMealOptionRecipeFood,
    OutreachLead,
    OutreachContact,
    OutreachAnalysis,
    OutreachBusinessLine,
    OutreachSettings,
    DocumentFolder,
    Document,
    ClientModuleAssignment,
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
