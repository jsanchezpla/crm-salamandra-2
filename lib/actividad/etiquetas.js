/**
 * lib/actividad/etiquetas.js — traduce las acciones de AuditLog a frases en
 * cristiano para la pantalla Equipo → Actividad.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint /api/actividad y
 * cualquier futura exportación del registro.)
 *
 * La auditoría guarda strings tipo "nutricion.plan.assigned". Aquí se
 * convierten en { modulo: "Nutrición", texto: "Asignó un menú" }. Todo lo que
 * no esté en el catálogo pasa por un traductor genérico (prefijo → módulo,
 * verbo → pasado) para que una acción nueva nunca salga en crudo.
 */

// Prefijo de la acción → módulo legible. OJO legacy: "appointment." y
// "booking." son de Citas (inconsistencia histórica de prefijos).
const MODULOS = {
  team: "Equipo",
  client: "Clientes",
  lead: "Leads",
  ticket: "Soporte",
  rate: "Facturación",
  invoice_series: "Facturación",
  recurring: "Facturación",
  order: "Pedidos",
  inventory: "Inventario",
  calendar: "Calendario",
  project: "Proyectos",
  task: "Proyectos",
  invoice: "Facturación",
  payment: "Facturación",
  cost: "Facturación",
  quote: "Facturación",
  citas: "Citas",
  appointment: "Citas",
  booking: "Citas",
  clinica: "Clínica",
  pacientes: "Pacientes",
  nutricion: "Nutrición",
  outreach: "Captación",
  document: "Documentos",
  document_folder: "Documentos",
  training: "Formación",
  formularios: "Formularios",
  ai: "IA",
  auth: "Accesos",
  tenant: "Configuración",
};

// Catálogo de frases exactas (las acciones que existen hoy). El sujeto se
// añade en la UI ("Laura · Asignó un menú · 12:40").
const TEXTOS = {
  // Equipo
  "team.created": "Dio de alta a un empleado",
  "team.updated": "Editó la ficha de un empleado",
  "team.deactivated": "Desactivó a un empleado",
  "team.status_changed": "Cambió el estado de un empleado",
  "team.role_changed": "Cambió el puesto de un empleado",
  "team.salary_changed": "Cambió el salario de un empleado",
  "team.rate_changed": "Cambió la tarifa de un empleado",
  "team.cost_changed": "Cambió el coste de un empleado",
  "team.modules_changed": "Cambió los módulos de un empleado",
  "team.user_created": "Creó un usuario de acceso al CRM",
  "team.access_changed": "Cambió los módulos de acceso de un usuario",
  "team.password_reset": "Restableció la contraseña de un usuario",
  "team.user_removed": "Quitó el acceso al CRM de un usuario",
  // Clientes
  "client.contact_method.created": "Añadió un método de contacto a un cliente",
  "client.contact_method.updated": "Editó un método de contacto de un cliente",
  "client.contact_method.deleted": "Borró un método de contacto de un cliente",
  "client.created": "Dio de alta un cliente",
  "client.updated": "Editó la ficha de un cliente",
  "client.deleted": "Borró un cliente (y sus adjuntos)",
  "client.modules.updated": "Cambió los módulos asignados de un cliente",
  // Leads
  "lead.updated": "Editó un lead",
  "lead.deleted": "Borró un lead",
  // Facturación (resto)
  "rate.updated": "Editó una tarifa",
  "rate.deleted": "Borró una tarifa",
  "invoice_series.updated": "Editó una serie de facturación",
  "invoice_series.deleted": "Borró una serie de facturación",
  "recurring.updated": "Editó una factura recurrente",
  "recurring.deleted": "Borró una factura recurrente",
  // Pedidos
  "order.updated": "Editó un pedido",
  "order.deleted": "Borró un pedido",
  // Inventario
  "inventory.inbound.updated": "Editó un producto entrante",
  "inventory.inbound.deleted": "Borró un producto entrante",
  "inventory.outbound.updated": "Editó un producto de salida",
  "inventory.outbound.deleted": "Borró un producto de salida",
  "inventory.formula.updated": "Editó una receta de inventario",
  "inventory.formula.deleted": "Borró una receta de inventario",
  "inventory.alias.updated": "Editó un alias de cliente",
  "inventory.alias.deleted": "Borró un alias de cliente",
  // Calendario y notas
  "calendar.task.updated": "Editó una tarea del calendario",
  "calendar.task.deleted": "Borró una tarea del calendario",
  "client.note.deleted": "Borró una nota de cliente",
  // Configuración del tenant (incluye credenciales: Stripe, correo, IA)
  "configuracion.updated": "Cambió la configuración del negocio",
  // Panel interno de Salamandra
  "provisioning.cliente_editado": "Editó un cliente desde el panel interno",
  // Soporte
  "ticket.updated": "Editó un ticket",
  "ticket.deleted": "Borró un ticket (y su conversación)",
  // Proyectos
  "project.created": "Creó un proyecto",
  "project.updated": "Editó un proyecto",
  "project.archived": "Archivó un proyecto",
  "project.lead_converted": "Convirtió un lead en proyecto",
  "project.member_added": "Añadió a alguien a un proyecto",
  "project.member_removed": "Quitó a alguien de un proyecto",
  "project.member_role_changed": "Cambió el rol de alguien en un proyecto",
  "project.column.tasks_reordered": "Reordenó tareas de un tablero",
  "task.created": "Creó una tarea",
  "task.updated": "Editó una tarea",
  "task.deleted": "Borró una tarea",
  "task.moved": "Movió una tarea de columna",
  // Facturación
  "invoice.issued": "Emitió una factura",
  "invoice.sent": "Envió una factura",
  "invoice.created": "Creó una factura",
  "invoice.updated": "Editó una factura",
  "invoice.deleted": "Borró un borrador de factura",
  "payment.created": "Registró un cobro",
  "payment.updated": "Editó un cobro",
  "payment.deleted": "Borró un cobro",
  "cost.created": "Registró un gasto",
  "cost.updated": "Editó un gasto",
  "cost.deleted": "Borró un gasto",
  "quote.created": "Creó un presupuesto",
  "quote.deleted": "Borró un presupuesto",
  "invoice.cancelled": "Anuló una factura",
  "invoice.rectified": "Rectificó una factura",
  // Citas
  "citas.event_type_created": "Creó un tipo de cita",
  "citas.event_type_updated": "Editó un tipo de cita",
  "citas.event_type_deleted": "Borró un tipo de cita",
  "citas.availability_created": "Añadió disponibilidad",
  "citas.availability_updated": "Editó disponibilidad",
  "citas.availability_deleted": "Borró disponibilidad",
  "citas.booking_created": "Creó una cita",
  "citas.booking_updated": "Editó una cita",
  "citas.booking_confirmed": "Confirmó una cita",
  "citas.booking_rejected": "Rechazó una cita",
  "citas.booking_cancelled": "Canceló una cita",
  "citas.booking_status_changed": "Cambió el estado de una cita",
  "citas.blocked_day_created": "Marcó un día como festivo o cierre",
  "citas.blocked_day_deleted": "Quitó un festivo del calendario",
  "appointment.meet_link_set": "Puso el enlace de videollamada a una cita",
  "booking.reschedule_approved": "Aprobó un cambio de hora de cita",
  // Clínica
  "clinica.session.created": "Registró una sesión clínica",
  "clinica.session.updated": "Editó una sesión clínica",
  "clinica.report.created": "Creó un informe clínico",
  "clinica.report.updated": "Editó un informe clínico",
  "clinica.coordination.created": "Registró una coordinación",
  "clinica.productividad.hours": "Cambió las horas semanales de un profesional",
  "clinica.performance.incentive": "Ajustó un incentivo",
  "clinica.performance.approve_all": "Aprobó las evaluaciones del mes",
  "clinica.performance.tiers": "Cambió los tramos de incentivos",
  "clinica.performance.incentive_item.create": "Creó un incentivo escrito",
  "clinica.performance.incentive_item.update": "Editó un incentivo escrito",
  "clinica.performance.incentive_item.delete": "Borró un incentivo escrito",
  // Pacientes
  "pacientes.created": "Dio de alta a un paciente",
  "pacientes.updated": "Editó la ficha de un paciente",
  "pacientes.plan_created": "Creó el plan de intervención de un paciente",
  "pacientes.plan_updated": "Editó el plan de intervención de un paciente",
  "pacientes.contract_uploaded": "Subió el contrato de un paciente",
  "pacientes.contract_deleted": "Borró el contrato de un paciente",
  // Nutrición
  "nutricion.recipe.created": "Creó una receta",
  "nutricion.recipe.updated": "Editó una receta",
  "nutricion.recipe.archived": "Archivó una receta",
  "nutricion.recipe.photo_uploaded": "Subió la foto de una receta",
  "nutricion.recipe.photo_deleted": "Borró la foto de una receta",
  "nutricion.food.created": "Añadió un alimento",
  "nutricion.food.updated": "Editó un alimento",
  "nutricion.food.archived": "Archivó un alimento",
  "nutricion.plan.created": "Creó un menú",
  "nutricion.plan.updated": "Editó un menú",
  "nutricion.plan.archived": "Archivó un menú",
  "nutricion.plan.assigned": "Asignó un menú a un paciente",
  "nutricion.plan.duplicated": "Duplicó un menú",
  "nutricion.plan.reapplied": "Reaplicó una plantilla de menú",
  "nutricion.plan.meals.reordered": "Reordenó las comidas de un menú",
  "nutricion.menu_emailed": "Envió un menú por email",
  // Captación
  "outreach.lead.created": "Añadió una empresa a captación",
  "outreach.lead.updated": "Editó una empresa de captación",
  "outreach.lead.deleted": "Borró una empresa de captación",
  "outreach.lead.bulk_deleted": "Borró varias empresas de captación",
  "outreach.lead.converted": "Convirtió una empresa captada en cliente",
  "outreach.lead.analyzed": "Analizó una empresa con IA",
  "outreach.scraping.run": "Buscó empresas nuevas (Google)",
  "outreach.email.sent": "Envió un correo de captación",
  // Documentos
  "document.uploaded": "Subió un documento",
  "document.deleted": "Borró un documento",
  "document_folder.created": "Creó una carpeta de documentos",
  "document_folder.updated": "Renombró una carpeta de documentos",
  "document_folder.deleted": "Borró una carpeta de documentos",
  // Formación / Formularios
  "training.course_registration.created": "Recibió una inscripción de curso desde la web",
  "formularios.solicitud.aceptada": "Aceptó una solicitud y creó la ficha de cliente",
  // Accesos
  "auth.login": "Entró en el CRM",
  "auth.login_failed": "Intento de acceso fallido",
  "auth.login_blocked": "Acceso bloqueado por demasiados intentos",
  // IA
  "ai.uso": "Usó la IA",
  "ai.permiso_concedido": "Concedió un permiso de IA",
  "ai.permiso_denegado": "Denegó un permiso de IA",
  "ai.permiso_revocado": "Revocó un permiso de IA",
};

const VERBOS = {
  created: "creó", updated: "editó", deleted: "borró", archived: "archivó",
  uploaded: "subió", moved: "movió", sent: "envió", issued: "emitió",
  cancelled: "canceló", assigned: "asignó", confirmed: "confirmó",
};

/** Fallback para acciones que aún no estén en el catálogo. */
function generica(action) {
  const partes = String(action).split(".");
  const verbo = VERBOS[partes[partes.length - 1]] || partes[partes.length - 1].replace(/_/g, " ");
  const entidad = partes.slice(1, -1).join(" ").replace(/_/g, " ");
  const frase = `${verbo.charAt(0).toUpperCase()}${verbo.slice(1)}${entidad ? ` ${entidad}` : ""}`;
  return frase.trim() || action;
}

/** Acción cruda → { modulo, texto }. Nunca devuelve el string en crudo. */
export function etiqueta(action) {
  const prefijo = String(action).split(".")[0];
  const modulo = MODULOS[prefijo] || "Otros";
  const texto = TEXTOS[action] || generica(action);
  return { modulo, texto };
}

/** Lista de módulos para los filtros de la pantalla, en orden estable. */
export function modulosConocidos() {
  return [...new Set(Object.values(MODULOS))];
}

/**
 * Prefijos de acción que pertenecen a un módulo, para poder filtrar en SQL.
 *
 * (Añadido 2026-07-28.) El filtro por módulo se aplicaba en JavaScript DESPUÉS
 * del LIMIT 400, así que pedir "solo Facturación" enseñaba las de facturación
 * que hubiera entre las 400 últimas de todo el CRM, no las 400 últimas de
 * facturación: el histórico filtrado enseñaba menos de lo que había.
 *
 * Devuelve `{ prefijos }` para un módulo conocido, o `{ excluir }` con TODOS
 * los prefijos conocidos cuando se pide "Otros" (lo que no está catalogado).
 */
export function prefijosDeModulo(modulo) {
  if (!modulo) return null;
  const todos = Object.keys(MODULOS);
  if (modulo === "Otros") return { excluir: todos };
  const prefijos = todos.filter((p) => MODULOS[p] === modulo);
  return prefijos.length ? { prefijos } : null;
}
