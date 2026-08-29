import { createSequelizeInstance } from "./sequalize.js";
import { defineClient } from "../../models/tenant/Client.model.js";
import { defineContact } from "../../models/tenant/Contact.model.js";
import { defineLead } from "../../models/tenant/Lead.model.js";
import { defineProject } from "../../models/tenant/Project.model.js";
import { defineTask } from "../../models/tenant/Task.model.js";
import { defineTicket } from "../../models/tenant/Ticket.model.js";
import { defineTicketMessage } from "../../models/tenant/TicketMessage.model.js";
import { defineTicketAttachment } from "../../models/tenant/TicketAttachment.model.js";
import { defineTicketCategory } from "../../models/tenant/TicketCategory.model.js";
import { defineTicketTemplate } from "../../models/tenant/TicketTemplate.model.js";
import { defineSupportSettings } from "../../models/tenant/SupportSettings.model.js";
import { defineInvoice } from "../../models/tenant/Invoice.model.js";
import { defineQuote } from "../../models/tenant/Quote.model.js";
import { definePayment } from "../../models/tenant/Payment.model.js";
import { defineRate } from "../../models/tenant/Rate.model.js";
import { defineRecurringInvoice } from "../../models/tenant/RecurringInvoice.model.js";
import { defineCost } from "../../models/tenant/Cost.model.js";
import { defineSupplier } from "../../models/tenant/Supplier.model.js";
import { defineCashPoint } from "../../models/tenant/CashPoint.model.js";
import { defineCashClose } from "../../models/tenant/CashClose.model.js";
import { defineTeamMember } from "../../models/tenant/TeamMember.model.js";
import { defineTeamMemberModule } from "../../models/tenant/TeamMemberModule.model.js";
import { defineAsset } from "../../models/tenant/Asset.model.js";
import { defineTraining } from "../../models/tenant/Training.model.js";
import { defineNotification } from "../../models/tenant/Notification.model.js";
import { defineAiPermission } from "../../models/tenant/AiPermission.model.js";
import { defineWebVisitDaily } from "../../models/tenant/WebVisitDaily.model.js";
import { defineFichaje } from "../../models/tenant/Fichaje.model.js";
import { defineFichajeImport } from "../../models/tenant/FichajeImport.model.js";
import { definePaymentSession } from "../../models/tenant/PaymentSession.model.js";
import { defineStripeWebhookEvent } from "../../models/tenant/StripeWebhookEvent.model.js";
import { defineBankAccount } from "../../models/tenant/BankAccount.model.js";
import { defineBankTransaction } from "../../models/tenant/BankTransaction.model.js";
import { defineMessage } from "../../models/tenant/Message.model.js";
import { defineWhatsappMessage } from "../../models/tenant/WhatsappMessage.model.js";
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
import { defineCorreoLista } from "../../models/tenant/CorreoLista.model.js";
import { defineCorreoPlantilla } from "../../models/tenant/CorreoPlantilla.model.js";
import { defineCorreoFirma } from "../../models/tenant/CorreoFirma.model.js";
import { defineClientAttachment } from "../../models/tenant/ClientAttachment.model.js";
import { defineClientNote } from "../../models/tenant/ClientNote.model.js";
import { defineClientContactMethod } from "../../models/tenant/ClientContactMethod.model.js";
// Inventario rehecho el 02/08/2026: Product sustituye a Inbound/OutboundProduct
// y StockEntry a InboundBatch. Formula y ClientOutboundAlias se eliminaron.
import { defineProduct } from "../../models/tenant/Product.model.js";
// La talla / el color / la capacidad (25/08/2026, con la tienda pública).
import { defineProductVariant } from "../../models/tenant/ProductVariant.model.js";
import { defineStockEntry } from "../../models/tenant/StockEntry.model.js";
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
import { defineTeamMemberHours } from "../../models/tenant/TeamMemberHours.model.js";
import { defineBooking } from "../../models/tenant/Booking.model.js";
import { defineSessionPack } from "../../models/tenant/SessionPack.model.js";
import { defineBookingChangeRequest } from "../../models/tenant/BookingChangeRequest.model.js";
import { defineOrder } from "../../models/tenant/Order.model.js";
import { defineOrderLine } from "../../models/tenant/OrderLine.model.js";
import { defineOrderSettings } from "../../models/tenant/OrderSettings.model.js";
import { defineClinicSession } from "../../models/tenant/ClinicSession.model.js";
import { defineCoordination } from "../../models/tenant/Coordination.model.js";
// Talleres (02/08/2026): actividades de grupo a las que se apunta quien quiere.
// NO son especialidades — ver cabecera de Taller.model.js.
import { defineTaller } from "../../models/tenant/Taller.model.js";
import { defineTallerInscripcion } from "../../models/tenant/TallerInscripcion.model.js";
import { defineExternalContact } from "../../models/tenant/ExternalContact.model.js";
import { defineClinicalReport } from "../../models/tenant/ClinicalReport.model.js";
import { definePerformanceMetric } from "../../models/tenant/PerformanceMetric.model.js";
import { defineIncentiveItem } from "../../models/tenant/IncentiveItem.model.js";
import { defineIncidencia } from "../../models/tenant/Incidencia.model.js";
import { defineIncidenciaAssignee } from "../../models/tenant/IncidenciaAssignee.model.js";
import { definePatient } from "../../models/tenant/Patient.model.js";
import { defineInterventionPlan } from "../../models/tenant/InterventionPlan.model.js";
import { definePatientTherapist } from "../../models/tenant/PatientTherapist.model.js";
import { defineBlockedDay } from "../../models/tenant/BlockedDay.model.js";
import { defineTeamBlock } from "../../models/tenant/TeamBlock.model.js";
import { defineWaitlistEntry } from "../../models/tenant/WaitlistEntry.model.js";
import { defineContractSignature } from "../../models/tenant/ContractSignature.model.js";
import { defineContractTemplate } from "../../models/tenant/ContractTemplate.model.js";
import { defineDataReview } from "../../models/tenant/DataReview.model.js";
import { defineFood } from "../../models/tenant/Food.model.js";
import { definePlan } from "../../models/tenant/Plan.model.js";
import { defineForm } from "../../models/tenant/Form.model.js";
import { defineFormSubmission } from "../../models/tenant/FormSubmission.model.js";
import { defineClientNotice } from "../../models/tenant/ClientNotice.model.js";
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
  const TicketMessage = defineTicketMessage(sequelize);
  const TicketAttachment = defineTicketAttachment(sequelize);
  const TicketCategory = defineTicketCategory(sequelize);
  const TicketTemplate = defineTicketTemplate(sequelize);
  const SupportSettings = defineSupportSettings(sequelize);
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
  const AiPermission = defineAiPermission(sequelize);
  // Foto diaria de las visitas de la web (módulo Analíticas). Existe porque
  // Cloudflare solo guarda 7 días: el histórico largo lo construimos nosotros.
  const WebVisitDaily = defineWebVisitDaily(sequelize);
  // Control horario (módulo Fichaje). `Fichaje` es un tramo trabajado y
  // `FichajeImport` el lote de Excel del que salió, que es lo que hace el
  // volcado reversible entero.
  const Fichaje = defineFichaje(sequelize);
  const FichajeImport = defineFichajeImport(sequelize);
  // Pagos online (transversal: cualquier módulo puede cobrar por una entidad suya)
  const PaymentSession = definePaymentSession(sequelize);
  const StripeWebhookEvent = defineStripeWebhookEvent(sequelize);
  // Banco real conectado por PSD2 (submódulo `billing_banco`). Registrados para TODOS los
  // tenants, como el resto: sus tablas las crea en todos los schemas
  // migrate-banco-conciliacion (CORE), y quién puede USARLAS lo decide el
  // módulo en los endpoints, no la existencia de la tabla.
  const BankAccount = defineBankAccount(sequelize);
  const BankTransaction = defineBankTransaction(sequelize);
  const Message = defineMessage(sequelize);
  // WhatsApp entrante y saliente. `Message` es el chat INTERNO del equipo; esto
  // es la conversación con el cliente por WhatsApp, que no tiene nada que ver.
  const WhatsappMessage = defineWhatsappMessage(sequelize);
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
  const TeamMemberHours = defineTeamMemberHours(sequelize);
  const Booking = defineBooking(sequelize);
  const BookingChangeRequest = defineBookingChangeRequest(sequelize);
  // Bonos de sesiones: un tipo de cita con `sessionsCount > 1` se contrata una
  // vez y da derecho a N citas (04/08/2026).
  const SessionPack = defineSessionPack(sequelize);
  // Festivos y lista de espera de clientes (sprint Aumenta 2026-07-28).
  const BlockedDay = defineBlockedDay(sequelize);
  const TeamBlock = defineTeamBlock(sequelize);
  const WaitlistEntry = defineWaitlistEntry(sequelize);

  // ── Módulo de pedidos (Sprint 2 — spain_enzymes) ────────────────────────────
  const Order = defineOrder(sequelize);
  const OrderLine = defineOrderLine(sequelize);
  const OrderSettings = defineOrderSettings(sequelize);

  // ── Módulo de Clínica (Sprint 1 — solo aumenta, datos dummy) ───────────────
  const ClinicSession = defineClinicSession(sequelize);
  const Coordination = defineCoordination(sequelize);
  const Taller = defineTaller(sequelize);
  const TallerInscripcion = defineTallerInscripcion(sequelize);
  // Agenda de profesionales externos del paciente (colegio, sanidad…) a la que
  // se enganchan las actas de coordinación.
  const ExternalContact = defineExternalContact(sequelize);
  const ClinicalReport = defineClinicalReport(sequelize);
  const PerformanceMetric = definePerformanceMetric(sequelize);
  const IncentiveItem = defineIncentiveItem(sequelize);
  const Incidencia = defineIncidencia(sequelize);
  const IncidenciaAssignee = defineIncidenciaAssignee(sequelize);

  // ── Módulo de Pacientes (Sprint 1 — solo aumenta, datos dummy) ─────────────
  const Patient = definePatient(sequelize);
  const InterventionPlan = defineInterventionPlan(sequelize);
  /*
   * Quién lleva a cada paciente, uno por fila (25/08/2026). SIN asociaciones a
   * propósito: se lee con una consulta agregada aparte, como ya se hace con las
   * sesiones en `app/api/pacientes/route.js`. Un `belongsToMany` aquí metería un
   * JOIN en el listado paginado, y ahí `findAndCountAll` empieza a contar filas
   * del JOIN en vez de pacientes — la página 2 saldría corta y nadie lo miraría.
   */
  const PatientTherapist = definePatientTherapist(sequelize);

  // ── Módulo Formularios (formularios públicos → bandeja → ficha de cliente) ─
  // Las preguntas viven en `forms.fields` (JSONB): un formulario nuevo es una
  // fila, no un despliegue.
  const Form = defineForm(sequelize);
  const FormSubmission = defineFormSubmission(sequelize);
  const ClientNotice = defineClientNotice(sequelize);

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
  // ── Pantalla /correo (26/08/2026): listas, plantillas y firmas ────────────
  // Transversales (como Notification): la pantalla se ve con `clients` o con
  // `outreach`, así que las tablas existen en todos los schemas
  // (migrate-correo-herramientas, en CORE).
  const CorreoLista = defineCorreoLista(sequelize);
  const CorreoPlantilla = defineCorreoPlantilla(sequelize);
  const CorreoFirma = defineCorreoFirma(sequelize);
  const ClientNote = defineClientNote(sequelize);
  const ClientAttachment = defineClientAttachment(sequelize);
  const ClientContactMethod = defineClientContactMethod(sequelize);
  // Firmas del Contrato del Centro (sprint Aumenta 2026-07-28).
  const ContractSignature = defineContractSignature(sequelize);
  // El contrato con sus datos y sus anexos (sprint tunutrilaura 2026-08-04).
  // Sin asociación a ContractSignature a propósito: la firma guarda `templateKey`
  // (texto), no una FK. Una firma tiene que sobrevivir a que se borre o se
  // rehaga la plantilla, porque es la prueba de lo que alguien aceptó.
  const ContractTemplate = defineContractTemplate(sequelize);
  // Sin asociaciones a propósito: apunta unas veces a un cliente y otras a un
  // paciente, y una FK condicional no existe. Ver el modelo.
  const DataReview = defineDataReview(sequelize);

  // ── Módulo Documents (Drive básico) ─────────────────────────────────────────
  const DocumentFolder = defineDocumentFolder(sequelize);
  const Document = defineDocument(sequelize);

  // ── Asignación de clientes a módulos (nutricion/clinica) ────────────────────
  const ClientModuleAssignment = defineClientModuleAssignment(sequelize);

  // ── Módulo de inventario ────────────────────────────────────────────────────
  const Product = defineProduct(sequelize);
  const ProductVariant = defineProductVariant(sequelize);
  const StockEntry = defineStockEntry(sequelize);
  const StockMovement = defineStockMovement(sequelize);

  // ── Módulo de facturación ───────────────────────────────────────────────────
  const Invoice = defineInvoice(sequelize);
  const Quote = defineQuote(sequelize);
  const Payment = definePayment(sequelize);
  const Rate = defineRate(sequelize);
  const RecurringInvoice = defineRecurringInvoice(sequelize);
  const Cost = defineCost(sequelize);
  // Proveedor: entidad compartida entre Gastos (a quién pagas) e Inventario
  // (quién te entrega). Antes vivía como texto libre en InboundBatch.
  const Supplier = defineSupplier(sequelize);
  // Arqueo de caja: punto de atención y cierre diario. Faltaba por completo
  // frente a Organízate, que lo tiene en tres secciones (cajas/arqueo/cierres).
  const CashPoint = defineCashPoint(sequelize);
  const CashClose = defineCashClose(sequelize);
  const InvoiceSeries = defineInvoiceSeries(sequelize);
  const TenantBillingSettings = defineTenantBillingSettings(sequelize);

  // ── Asociaciones base ───────────────────────────────────────────────────────
  Client.hasMany(Interaction, { foreignKey: "clientId", as: "interactions" });
  Interaction.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Client.hasMany(ClientNote, { foreignKey: "clientId", as: "clientNotes" });
  ClientNote.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Client.hasMany(ClientAttachment, { foreignKey: "clientId", as: "attachments" });
  ClientAttachment.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // WhatsApp. SET NULL y no CASCADE: la tabla guarda a propósito mensajes de
  // números que NO están en ninguna ficha (un familiar, alguien que aún no es
  // paciente), así que una fila sin cliente es un estado legítimo y no basura.
  // ⚠️ El reverso es que borrar una ficha deja su conversación en la tabla:
  // si algún día hay que atender un borrado por RGPD, hay que purgarla aparte.
  Client.hasMany(WhatsappMessage, { foreignKey: "clientId", as: "whatsappMessages", onDelete: "SET NULL" });
  WhatsappMessage.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // Emails/teléfonos múltiples etiquetados (Aumenta). CASCADE: al borrar el
  // cliente se borran sus métodos de contacto.
  Client.hasMany(ClientContactMethod, { foreignKey: "clientId", as: "contactMethods", onDelete: "CASCADE" });
  ClientContactMethod.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // Firmas del Contrato del Centro (sprint Aumenta 2026-07-28). Cada firma
  // apunta a un tutor de Client.guardians por su id (JSONB, FK lógica).
  Client.hasMany(ContractSignature, { foreignKey: "clientId", as: "contractSignatures", onDelete: "CASCADE" });
  ContractSignature.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // ── Asignación de cliente a módulos ─────────────────────────────────────────
  Client.hasMany(ClientModuleAssignment, { foreignKey: "clientId", as: "moduleAssignments", onDelete: "CASCADE" });
  ClientModuleAssignment.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // Enlace Client → Patient (materialización de "Paciente Clínica"). FK lógica
  // client_id en patients (nullable): los pacientes clínicos históricos no lo
  // tienen. Solo existe en tenants con el módulo clinica/pacientes.
  Client.hasMany(Patient, { foreignKey: "clientId", as: "clinicPatients" });
  Patient.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // Cita → Paciente (Aumenta: la cita se agenda para un paciente concreto del
  // cliente que paga). FK lógica booking.patient_id nullable; solo aplica en
  // tenants con tabla patients (la migración crea la columna condicional).
  Patient.hasMany(Booking, { foreignKey: "patientId", as: "bookings" });
  Booking.belongsTo(Patient, { foreignKey: "patientId", as: "patient" });

  // Cita → Ficha de cliente (2026-07-22). Sustituye al cruce por email en
  // texto, que despegaba las citas de la ficha en cuanto la persona escribía
  // el correo de otra forma o se lo cambiaba. FK real con ON DELETE SET NULL:
  // borrar una ficha no borra su histórico de citas.
  Client.hasMany(Booking, { foreignKey: "clientId", as: "bookings" });
  Booking.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // ── Asociaciones Documents ───────────────────────────────────────────────────
  DocumentFolder.hasMany(DocumentFolder, { foreignKey: "parentFolderId", as: "children", onDelete: "CASCADE" });
  DocumentFolder.belongsTo(DocumentFolder, { foreignKey: "parentFolderId", as: "parent" });
  DocumentFolder.hasMany(Document, { foreignKey: "folderId", as: "documents", onDelete: "CASCADE" });
  Document.belongsTo(DocumentFolder, { foreignKey: "folderId", as: "folder" });

  // ── Conexión con cliente y equipo (sprint 2026-07-23) ────────────────────────
  // "Todo lo del CRM tiene un cliente (externo) y un miembro del equipo
  // (interno)". Enlaces reales que sustituyen a los cruces por texto/email.
  // Todas las FK son nullable con ON DELETE SET NULL (definido en la migración).

  // Documentos → cliente al que pertenecen.
  Client.hasMany(Document, { foreignKey: "clientId", as: "documents" });
  Document.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // Registros clínicos → cliente/pagador (foto del paciente al crearlos).
  Client.hasMany(ClinicSession, { foreignKey: "clientId", as: "clinicSessions" });
  ClinicSession.belongsTo(Client, { foreignKey: "clientId", as: "client" });
  Client.hasMany(ClinicalReport, { foreignKey: "clientId", as: "clinicalReports" });
  ClinicalReport.belongsTo(Client, { foreignKey: "clientId", as: "client" });
  Client.hasMany(Coordination, { foreignKey: "clientId", as: "coordinations" });
  Coordination.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // Jornada trabajada → persona. RESTRICT y no CASCADE a propósito: pasar a
  // alguien a inactivo no puede llevarse por delante su histórico laboral.
  TeamMember.hasMany(Fichaje, { foreignKey: "teamMemberId", as: "fichajes", onDelete: "RESTRICT" });
  Fichaje.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });
  FichajeImport.hasMany(Fichaje, { foreignKey: "importId", as: "fichajes" });
  Fichaje.belongsTo(FichajeImport, { foreignKey: "importId", as: "import" });

  // Plan nutricional → nutricionista que lo hizo.
  TeamMember.hasMany(Plan, { foreignKey: "teamMemberId", as: "plans" });
  Plan.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

  // Interacciones y notas → miembro del equipo que las registró.
  TeamMember.hasMany(Interaction, { foreignKey: "teamMemberId", as: "interactions" });
  Interaction.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });
  TeamMember.hasMany(ClientNote, { foreignKey: "teamMemberId", as: "clientNotes" });
  ClientNote.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

  // Solicitud de formulario → miembro del equipo que la atendió.
  TeamMember.hasMany(FormSubmission, { foreignKey: "handledByTeamId", as: "handledSubmissions" });
  FormSubmission.belongsTo(TeamMember, { foreignKey: "handledByTeamId", as: "handledByTeam" });

  // Aviso al cliente → quién lo escribió, y a qué cita se refiere (si a alguna).
  TeamMember.hasMany(ClientNotice, { foreignKey: "createdByTeamId", as: "avisosEscritos" });
  ClientNotice.belongsTo(TeamMember, { foreignKey: "createdByTeamId", as: "autor" });
  Booking.hasMany(ClientNotice, { foreignKey: "bookingId", as: "avisos" });
  ClientNotice.belongsTo(Booking, { foreignKey: "bookingId", as: "booking" });

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

  // ── Asociaciones de soporte (módulo support) ────────────────────────────────
  Ticket.belongsTo(Client, { foreignKey: "clientId", as: "client" });
  Contact.hasMany(Ticket, { foreignKey: "contactId", as: "tickets" });
  Ticket.belongsTo(Contact, { foreignKey: "contactId", as: "contact" });
  TicketCategory.hasMany(Ticket, { foreignKey: "categoryId", as: "tickets" });
  Ticket.belongsTo(TicketCategory, { foreignKey: "categoryId", as: "category" });
  // El responsable es un TeamMember (mismo criterio que Incidencia.assignedToId).
  Ticket.belongsTo(TeamMember, { foreignKey: "assignedTo", as: "assignee" });
  Ticket.hasMany(TicketMessage, { foreignKey: "ticketId", as: "messages", onDelete: "CASCADE" });
  TicketMessage.belongsTo(Ticket, { foreignKey: "ticketId", as: "ticket" });
  Ticket.hasMany(TicketAttachment, { foreignKey: "ticketId", as: "attachments", onDelete: "CASCADE" });
  TicketAttachment.belongsTo(Ticket, { foreignKey: "ticketId", as: "ticket" });
  TicketMessage.hasMany(TicketAttachment, { foreignKey: "messageId", as: "attachments" });
  TicketAttachment.belongsTo(TicketMessage, { foreignKey: "messageId", as: "message" });

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

  // Cobro sin factura (sprint Aumenta 2026-07-28): el cobro cuelga directo de
  // la clienta y Rosa lo asocia a la factura después. Con factura, clientId se
  // rellena desde invoice.clientId.
  Client.hasMany(Payment, { foreignKey: "clientId", as: "payments" });
  Payment.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // ── Conciliación bancaria (submódulo `billing_banco`) ─────────────────────────────────
  // Un movimiento del banco cuelga de su cuenta; el cobro y el gasto conocen su
  // movimiento (el enlace vive en payments/costs, ver BankTransaction.model.js).
  BankAccount.hasMany(BankTransaction, { foreignKey: "bankAccountId", as: "transactions" });
  BankTransaction.belongsTo(BankAccount, { foreignKey: "bankAccountId", as: "account" });
  Payment.belongsTo(BankTransaction, { foreignKey: "bankTransactionId", as: "bankTransaction" });
  Cost.belongsTo(BankTransaction, { foreignKey: "bankTransactionId", as: "bankTransaction" });

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

  // ── Proveedores ────────────────────────────────────────────────────────────
  // Entidad compartida a propósito: el mismo proveedor te factura (Cost) y te
  // entrega mercancía (Inventario). Ver cabecera de Supplier.model.js.
  Supplier.hasMany(Cost, { foreignKey: "supplierId", as: "costs" });
  Cost.belongsTo(Supplier, { foreignKey: "supplierId", as: "supplier" });

  // ── Arqueo de caja ─────────────────────────────────────────────────────────
  CashPoint.hasMany(CashClose, { foreignKey: "cashPointId", as: "closes" });
  CashClose.belongsTo(CashPoint, { foreignKey: "cashPointId", as: "cashPoint" });
  // Quién contó el dinero: es la primera pregunta al revisar un descuadre.
  TeamMember.hasMany(CashClose, { foreignKey: "closedById", as: "cashCloses" });
  CashClose.belongsTo(TeamMember, { foreignKey: "closedById", as: "closedBy" });

  // ── Inventario (rehecho 02/08/2026) ────────────────────────────────────────
  // Producto → sus entradas de mercancía y su libro de movimientos.
  Product.hasMany(StockEntry, { foreignKey: "productId", as: "entries" });
  StockEntry.belongsTo(Product, { foreignKey: "productId", as: "product" });

  Product.hasMany(StockMovement, { foreignKey: "productId", as: "movements" });
  StockMovement.belongsTo(Product, { foreignKey: "productId", as: "product" });

  // Variantes. `onDelete: CASCADE` porque una talla sin su camiseta no
  // significa nada; los PEDIDOS viejos no se ven afectados porque copian el
  // nombre (`order_lines.variant_name`), igual que ya copian el del producto.
  Product.hasMany(ProductVariant, { foreignKey: "productId", as: "variants", onDelete: "CASCADE" });
  ProductVariant.belongsTo(Product, { foreignKey: "productId", as: "product" });

  StockEntry.hasMany(StockMovement, { foreignKey: "entryId", as: "movements" });
  StockMovement.belongsTo(StockEntry, { foreignKey: "entryId", as: "entry" });

  // El proveedor que entrega, y el gasto que pagó la entrega: es lo que cierra
  // el círculo entre Almacén y Facturación.
  Supplier.hasMany(StockEntry, { foreignKey: "supplierId", as: "entries" });
  StockEntry.belongsTo(Supplier, { foreignKey: "supplierId", as: "supplier" });

  Cost.hasMany(StockEntry, { foreignKey: "costId", as: "stockEntries" });
  StockEntry.belongsTo(Cost, { foreignKey: "costId", as: "cost" });

  // Quién movió el stock.
  TeamMember.hasMany(StockMovement, { foreignKey: "teamMemberId", as: "stockMovements" });
  StockMovement.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

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
  TeamMember.hasMany(TeamMemberHours, { foreignKey: "teamMemberId", as: "workingHours" });
  TeamMember.hasMany(TeamBlock, { foreignKey: "teamMemberId", as: "blocks", onDelete: "CASCADE" });
  // Sus vacaciones se van con ella: a NULL sería «cierra todo el centro».
  TeamBlock.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember", onDelete: "CASCADE" });
  TeamMemberHours.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

  EventType.hasMany(Booking, { foreignKey: "eventTypeId", as: "bookings" });
  Booking.belongsTo(EventType, { foreignKey: "eventTypeId", as: "eventType" });

  // Bono de sesiones ↔ sus citas. `ON DELETE SET NULL` en la migración: borrar
  // un bono no puede llevarse por delante las citas que ya se dieron.
  SessionPack.hasMany(Booking, { foreignKey: "packId", as: "bookings" });
  Booking.belongsTo(SessionPack, { foreignKey: "packId", as: "pack" });
  EventType.hasMany(SessionPack, { foreignKey: "eventTypeId", as: "packs" });
  SessionPack.belongsTo(EventType, { foreignKey: "eventTypeId", as: "eventType" });
  Client.hasMany(SessionPack, { foreignKey: "clientId", as: "sessionPacks" });
  SessionPack.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  // Profesional asignado a la cita (nullable)
  TeamMember.hasMany(Booking, { foreignKey: "teamMemberId", as: "bookings" });
  Booking.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

  // Solicitudes de cambio de cita (terapeuta propone → admin aprueba).
  Booking.hasMany(BookingChangeRequest, { foreignKey: "bookingId", as: "changeRequests" });
  BookingChangeRequest.belongsTo(Booking, { foreignKey: "bookingId", as: "booking" });

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

  // La línea de pedido apunta al producto del almacén: es lo que permite
  // descontar stock al completar el pedido (antes no se descontaba nada).
  Product.hasMany(OrderLine, { foreignKey: "productId", as: "orderLines" });
  OrderLine.belongsTo(Product, { foreignKey: "productId", as: "product" });

  Invoice.hasOne(Order, { foreignKey: "invoiceId", as: "order" });
  Order.belongsTo(Invoice, { foreignKey: "invoiceId", as: "invoice" });

  // ── Asociaciones del módulo Pacientes ──────────────────────────────────────
  TeamMember.hasMany(Patient, { foreignKey: "mainTherapistId", as: "patients" });
  Patient.belongsTo(TeamMember, { foreignKey: "mainTherapistId", as: "mainTherapist" });

  // Plan de intervención 1:1 (sprint Aumenta 2026-07-28).
  Patient.hasOne(InterventionPlan, { foreignKey: "patientId", as: "interventionPlan", onDelete: "CASCADE" });
  InterventionPlan.belongsTo(Patient, { foreignKey: "patientId", as: "patient" });

  // ── Asociaciones del módulo Clínica (apuntan a Pacientes, no Clientes) ─────
  Patient.hasMany(ClinicSession, { foreignKey: "patientId", as: "clinicSessions" });
  ClinicSession.belongsTo(Patient, { foreignKey: "patientId", as: "patient" });

  // Factura ↔ Paciente (Fase 2a facturación de pacientes): se reutiliza la
  // columna dormida Invoice.patientId como enlace "esta factura es de este
  // paciente" (el pagador sigue siendo Invoice.clientId). Lazy: solo se
  // materializa en queries que incluyan el alias, y siempre gateadas por
  // hasModule('patients') porque la tabla patients no existe en todos los tenants.
  Patient.hasMany(Invoice, { foreignKey: "patientId", as: "invoices" });
  Invoice.belongsTo(Patient, { foreignKey: "patientId", as: "patient" });

  /*
   * ⚠️ `onDelete` EXPLÍCITO, y no es estilo (26/08/2026).
   *
   * Sin declararlo, Sequelize se lo inventa al crear la tabla: nullable →
   * SET NULL, NOT NULL → CASCADE. Y como el alta de un tenant lanza `sync()`
   * ANTES de las migraciones (lib/provisioning/altaTenant.js), lo que Sequelize
   * se inventó es lo que se queda: las migraciones crean con IF NOT EXISTS y ya
   * no llegan a tocarlo.
   *
   * Resultado medido en producción: `clinical_reports.therapist_id` era CASCADE
   * en 8 de los 9 schemas con Clínica, o sea que borrar a un profesional le
   * BORRABA SUS INFORMES CLÍNICOS. Y `team_blocks.team_member_id` era SET NULL
   * en 6, lo que convierte las vacaciones de una persona en un cierre de agenda
   * de todo el centro (ver models/tenant/TeamBlock.model.js).
   *
   * Los schemas que ya existen los alinea `scripts/migrate-fks-equipo-alineadas.js`.
   * Esto de aquí es para que el PRÓXIMO cliente nazca bien.
   */
  TeamMember.hasMany(ClinicSession, { foreignKey: "therapistId", as: "clinicSessions", onDelete: "RESTRICT" });
  ClinicSession.belongsTo(TeamMember, { foreignKey: "therapistId", as: "therapist", onDelete: "RESTRICT" });

  // ── Talleres ───────────────────────────────────────────────────────────────
  Taller.hasMany(TallerInscripcion, { foreignKey: "tallerId", as: "inscripciones", onDelete: "CASCADE" });
  TallerInscripcion.belongsTo(Taller, { foreignKey: "tallerId", as: "taller" });

  Patient.hasMany(TallerInscripcion, { foreignKey: "patientId", as: "talleres", onDelete: "CASCADE" });
  TallerInscripcion.belongsTo(Patient, { foreignKey: "patientId", as: "patient" });

  // Quién imparte el taller.
  TeamMember.hasMany(Taller, { foreignKey: "teamMemberId", as: "talleres" });
  Taller.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "responsable" });

  Patient.hasMany(Coordination, { foreignKey: "relatedPatientId", as: "coordinations" });
  Coordination.belongsTo(Patient, { foreignKey: "relatedPatientId", as: "relatedPatient" });

  TeamMember.hasMany(Coordination, { foreignKey: "createdById", as: "coordinationsCreated", onDelete: "RESTRICT" });
  // Historia: el acta lleva la firma de quien la escribió (ver la nota de arriba).
  Coordination.belongsTo(TeamMember, { foreignKey: "createdById", as: "createdBy", onDelete: "RESTRICT" });

  Patient.hasMany(ClinicalReport, { foreignKey: "patientId", as: "clinicalReports" });
  ClinicalReport.belongsTo(Patient, { foreignKey: "patientId", as: "patient" });

  TeamMember.hasMany(ClinicalReport, { foreignKey: "therapistId", as: "clinicalReports", onDelete: "RESTRICT" });
  // Historia, y la que más duele: era CASCADE en 8 schemas (ver la nota de arriba).
  ClinicalReport.belongsTo(TeamMember, { foreignKey: "therapistId", as: "therapist", onDelete: "RESTRICT" });

  TeamMember.hasMany(PerformanceMetric, { foreignKey: "therapistId", as: "performanceMetrics" });
  PerformanceMetric.belongsTo(TeamMember, { foreignKey: "therapistId", as: "therapist" });

  TeamMember.hasMany(PerformanceMetric, { foreignKey: "approvedById", as: "performanceMetricsApproved" });
  PerformanceMetric.belongsTo(TeamMember, { foreignKey: "approvedById", as: "approvedBy" });

  // Incentivos escritos a mano (conceptos con € o % del sueldo).
  TeamMember.hasMany(IncentiveItem, { foreignKey: "therapistId", as: "incentiveItems" });
  IncentiveItem.belongsTo(TeamMember, { foreignKey: "therapistId", as: "therapist" });
  TeamMember.hasMany(IncentiveItem, { foreignKey: "createdById", as: "incentiveItemsCreated" });
  IncentiveItem.belongsTo(TeamMember, { foreignKey: "createdById", as: "createdBy" });

  // ── Asociaciones del módulo Incidencias (Programa de Excelencia) ───────────
  // FKs lógicas nullable; la integridad física la fija la migración
  // (patients/clients/team_members → SET NULL). Solo se materializan en queries
  // con include, siempre en tenants con módulo clinica (donde existen las tablas).
  Patient.hasMany(Incidencia, { foreignKey: "patientId", as: "incidencias" });
  Incidencia.belongsTo(Patient, { foreignKey: "patientId", as: "patient" });
  Client.hasMany(Incidencia, { foreignKey: "clientId", as: "incidencias" });
  Incidencia.belongsTo(Client, { foreignKey: "clientId", as: "client" });
  TeamMember.hasMany(Incidencia, { foreignKey: "assignedToId", as: "assignedIncidencias" });
  Incidencia.belongsTo(TeamMember, { foreignKey: "assignedToId", as: "assignedTo" });
  TeamMember.hasMany(Incidencia, { foreignKey: "reportedById", as: "reportedIncidencias" });
  Incidencia.belongsTo(TeamMember, { foreignKey: "reportedById", as: "reportedBy" });

  // Multi-responsable (sprint Aumenta 2026-07-28), patrón TaskAssignee. El
  // campo legacy assignedToId queda como espejo del primer responsable.
  Incidencia.belongsToMany(TeamMember, {
    through: IncidenciaAssignee,
    foreignKey: "incidenciaId",
    otherKey: "teamMemberId",
    as: "assignees",
  });
  TeamMember.belongsToMany(Incidencia, {
    through: IncidenciaAssignee,
    foreignKey: "teamMemberId",
    otherKey: "incidenciaId",
    as: "incidenciasAsignadas",
  });
  Incidencia.hasMany(IncidenciaAssignee, { foreignKey: "incidenciaId", as: "assigneeLinks" });
  IncidenciaAssignee.belongsTo(Incidencia, { foreignKey: "incidenciaId", as: "incidencia" });
  TeamMember.hasMany(IncidenciaAssignee, { foreignKey: "teamMemberId", as: "incidenciaAssignments" });
  IncidenciaAssignee.belongsTo(TeamMember, { foreignKey: "teamMemberId", as: "teamMember" });

  // ── Asociaciones del módulo Nutrición (C2 — planes) ────────────────────────
  Plan.hasMany(PlanMeal, { foreignKey: "planId", as: "meals" });
  PlanMeal.belongsTo(Plan, { foreignKey: "planId", as: "plan" });

  PlanMeal.hasMany(PlanMealOption, { foreignKey: "mealId", as: "options" });
  PlanMealOption.belongsTo(PlanMeal, { foreignKey: "mealId", as: "meal" });

  PlanMealOption.hasMany(PlanMealOptionFood, { foreignKey: "optionId", as: "foods" });
  PlanMealOptionFood.belongsTo(PlanMealOption, { foreignKey: "optionId", as: "option" });

  Food.hasMany(PlanMealOptionFood, { foreignKey: "foodId", as: "planUses" });
  PlanMealOptionFood.belongsTo(Food, { foreignKey: "foodId", as: "food" });

  // ── Formularios ───────────────────────────────────────────────────────────
  // Hacia Client NO se declara asociación: `clientId` es FK lógica y se valida
  // en el endpoint, igual que en Lead y en Plan.
  Form.hasMany(FormSubmission, { foreignKey: "formId", as: "submissions" });
  FormSubmission.belongsTo(Form, { foreignKey: "formId", as: "form" });

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
    TicketMessage,
    TicketAttachment,
    TicketCategory,
    TicketTemplate,
    SupportSettings,
    Invoice,
    Quote,
    Payment,
    Rate,
    RecurringInvoice,
    Cost,
    Supplier,
    CashPoint,
    CashClose,
    InvoiceSeries,
    TenantBillingSettings,
    TeamMember,
    TeamMemberModule,
    Asset,
    Training,
    Notification,
    AiPermission,
    WebVisitDaily,
    Fichaje,
    FichajeImport,
    PaymentSession,
    StripeWebhookEvent,
    BankAccount,
    BankTransaction,
    Message,
    WhatsappMessage,
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
    ClientContactMethod,
    Product,
    ProductVariant,
    StockEntry,
    StockMovement,
    Phase,
    Milestone,
    BoardColumn,
    ProjectMember,
    ProjectTemplate,
    TaskAssignee,
    EventType,
    Availability,
    TeamMemberHours,
    Booking,
    SessionPack,
    BookingChangeRequest,
    Order,
    OrderLine,
    OrderSettings,
    ClinicSession,
    Coordination,
    Taller,
    TallerInscripcion,
    ExternalContact,
    ClinicalReport,
    PerformanceMetric,
    IncentiveItem,
    Incidencia,
    IncidenciaAssignee,
    Patient,
    InterventionPlan,
    PatientTherapist,
    BlockedDay,
    TeamBlock,
    WaitlistEntry,
    ContractSignature,
    ContractTemplate,
    DataReview,
    Form,
    FormSubmission,
    ClientNotice,
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
    CorreoLista,
    CorreoPlantilla,
    CorreoFirma,
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

/**
 * Suelta la conexión de UN tenant (13/08/2026, regla #2).
 *
 * La necesita la baja: al apartar a un cliente su schema pasa a llamarse
 * `zzz_baja_…`, y en el pool se quedaba una conexión con el `search_path`
 * apuntando a un schema que ya no existe. Nadie la volvía a pedir —el tenant
 * tampoco está ya en `master`— pero se quedaba viva hasta el purgado por
 * inactividad, ocupando una conexión de PostgreSQL sin poder servir nada. Y si
 * la baja se DESHACE en ese rato, la conexión reciclada es la vieja.
 *
 * No lanza: cerrar es limpieza, y una limpieza que falla no puede tumbar la
 * operación que la pidió.
 */
export async function closeTenantConnection(slug) {
  const entry = pool.get(slug);
  if (!entry) return false;
  pool.delete(slug);
  try {
    await entry.sequelize.close();
  } catch {
    /* ya estaba cerrada o la conexión se había caído */
  }
  return true;
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
const purgaIdle = setInterval(async () => {
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

/*
 * `unref()`: este temporizador NO cuenta para mantener vivo el proceso
 * (13/08/2026, regla #2).
 *
 * En el servidor da igual —Next no se va a apagar solo—, pero cualquier SCRIPT
 * que importe algo de aquí, aunque sea de rebote, se quedaba colgado para
 * siempre después de terminar su trabajo. Se vio con `podar-bajas.js`, que solo
 * quería saber en qué carpeta mirar: hizo lo suyo, imprimió el resultado y no
 * volvió nunca. Los scripts que ya existían lo tapaban con un `process.exit(0)`
 * al final, o sea que llevaban el parche cada uno por su cuenta sin que nadie
 * hubiera escrito por qué hacía falta.
 */
purgaIdle.unref?.();
