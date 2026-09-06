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
  billing_concept: "Facturación",
  cuota: "Facturación",
  cash_movement: "Facturación",
  recurring: "Facturación",
  order: "Pedidos",
  inventory: "Inventario",
  calendar: "Calendario",
  // Lo que pasa en calendar.salamandrasolutions.com (03/09/2026) se lee junto
  // a lo del Calendario: es el mismo evento visto desde otro sitio.
  calendario_global: "Calendario",
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
  // `correo` = la pantalla /correo (24/08/2026). Sin esta línea sus filas caen
  // en «Otros» y el filtro por módulo no las encuentra nunca, que es el mismo
  // fallo que arriba con `configuracion`.
  correo: "Correo",
  // Mailing (06/09/2026): email marketing por Amazon SES.
  mailing: "Mailing",
  document: "Documentos",
  document_folder: "Documentos",
  training: "Formación",
  formularios: "Formularios",
  fichaje: "Fichaje",
  ai: "IA",
  auth: "Accesos",
  // «Configuración» (19/08/2026): lo que se ESCRIBE es `configuracion.updated`;
  // el prefijo `tenant` no lo escribe nadie y el filtro «Configuración» de la
  // pantalla no devolvía nada nunca (y la fila caía en «Otros»). Se queda
  // `tenant` por si hay histórico; manda `configuracion`.
  tenant: "Configuración",
  configuracion: "Configuración",
  // Prefijos que tenían frase pero no módulo, así que sus filas caían en «Otros»
  // y el filtro por módulo no las encontraba (19/08/2026, lo sacó
  // `_smoke-actividad-etiquetas.mjs`).
  patient: "Pacientes",
  suppliers: "Inventario",
  // Módulo Banco (29/08/2026): conectar cuentas y conciliar el extracto.
  banco: "Banco",
  arqueo: "Facturación",
  buzon: "Buzón de ayuda",
  provisioning: "Panel interno",
};

// Catálogo de frases exactas (las acciones que existen hoy). El sujeto se
// añade en la UI ("Laura · Asignó un menú · 12:40").
const TEXTOS = {
  // Equipo
  "team.created": "Dio de alta a un empleado",
  "team.updated": "Editó la ficha de un empleado",
  "team.deactivated": "Desactivó a un empleado",
  "team.deleted": "Borró la ficha de un empleado",
  "team.status_changed": "Cambió el estado de un empleado",
  "team.role_changed": "Cambió el puesto de un empleado",
  "team.salary_changed": "Cambió el salario de un empleado",
  "team.rate_changed": "Cambió la tarifa de un empleado",
  "team.cost_changed": "Cambió el coste de un empleado",
  "team.modules_changed": "Cambió los módulos de un empleado",
  "team.user_created": "Creó un usuario de acceso al CRM",
  // Aparte del alta corriente a propósito (27/08/2026): dar el mando de un
  // centro es lo que alguien va a buscar en la actividad, y mezclado con las
  // treinta altas de empleado no se encuentra.
  "team.admin_created": "Creó una cuenta de ADMINISTRADOR del centro",
  "team.access_changed": "Cambió los módulos de acceso de un usuario",
  "team.correo_changed": "Cambió el correo de una cuenta",
  "team.password_reset": "Restableció la contraseña de un usuario",
  "team.user_removed": "Quitó el acceso al CRM de un usuario",
  // Clientes
  "client.contact_method.created": "Añadió un método de contacto a un cliente",
  "client.contact_method.updated": "Editó un método de contacto de un cliente",
  "client.contact_method.deleted": "Borró un método de contacto de un cliente",
  "client.created": "Dio de alta un cliente",
  "client.cuenta_web_creada": "Le creó la cuenta de la web a un cliente",
  "client.cuenta_web_fallida": "Intentó crear la cuenta de la web y falló",
  "client.updated": "Editó la ficha de un cliente",
  "client.deleted": "Borró un cliente (y sus adjuntos)",
  // WhatsApp. Asignar decide QUIÉN PUEDE LEER una conversación, así que deja
  // rastro aunque no sea destructivo ni mueva dinero. Va con prefijo `client.`
  // y no `whatsapp.` porque el prefijo elige el MÓDULO del filtro, y esto pasa
  // en la ficha de un cliente; conectar la cuenta pasa en Configuración y por
  // eso lleva el suyo. Un prefijo `whatsapp.` habría mandado las dos al mismo
  // sitio, y una de las dos al sitio equivocado.
  "client.whatsapp_asignado": "Asignó una conversación de WhatsApp a un cliente",
  "client.guardians.updated": "Cambió los tutores de una familia",
  "client.contract.uploaded": "Subió el contrato de una familia",
  "client.contract.deleted": "Borró el contrato de una familia",
  "client.contract.signed": "Una familia firmó el contrato en el portal",
  // El "no" se registra igual que el "sí": demuestra que se preguntó.
  "patient.consent.images.granted": "Una familia autorizó el uso de imágenes",
  "patient.consent.images.refused": "Una familia NO autorizó el uso de imágenes",
  "client.portal.month_unlocked": "Abrió a mano un mes del portal de una familia",
  "client.portal.month_locked": "Cerró a mano un mes del portal de una familia",
  "client.waitlist.added": "Metió a alguien en la lista de espera de admisión",
  "client.waitlist.updated": "Editó una entrada de la lista de espera",
  "client.waitlist.removed": "Sacó a alguien de la lista de espera",
  "client.waitlist.reordered": "Reordenó la lista de espera de admisión",
  "client.waitlist.converted": "Convirtió una espera en cliente",
  "client.comunicaciones.updated": "Cambió por dónde se le escribe a una familia",
  "client.modules.updated": "Cambió los módulos asignados de un cliente",
  "client.datos.completados": "Una familia completó sus datos desde el portal",
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
  // Inventario. Las cuatro primeras son de ANTES del rework del 02/08/2026: sus
  // acciones ya no se generan, pero el histórico de auditoría sigue teniéndolas
  // y sin su frase saldrían con el traductor genérico.
  "inventory.inbound.updated": "Editó un producto entrante",
  "inventory.inbound.deleted": "Borró un producto entrante",
  "inventory.outbound.updated": "Editó un producto de salida",
  "inventory.outbound.deleted": "Borró un producto de salida",
  "inventory.formula.updated": "Editó una receta de inventario",
  "inventory.formula.deleted": "Borró una receta de inventario",
  "inventory.product.updated": "Editó un producto del almacén",
  "inventory.product.deactivated": "Retiró un producto del almacén",
  "inventory.product.deleted": "Borró un producto del almacén",
  "inventory.entry.created": "Registró una entrada de mercancía",
  "inventory.stock.adjusted": "Ajustó el stock a mano",
  // Proveedores
  "suppliers.updated": "Editó un proveedor",
  "suppliers.deactivated": "Dio de baja a un proveedor",
  "suppliers.deleted": "Borró un proveedor",
  // Arqueo de caja
  "arqueo.cierre.created": "Cerró la caja del día",
  "citas.asignadas_en_bloque": "Asignó profesional a varias citas de golpe",
  "citas.desprogramadas_en_bloque": "Quitó de la agenda las citas futuras de un paciente",
  // Talleres (actividades de grupo, NO especialidades)
  "clinica.taller.updated": "Editó un taller",
  "clinica.taller.deactivated": "Retiró un taller",
  "clinica.taller.deleted": "Borró un taller",
  "clinica.taller.inscrito": "Apuntó a un paciente a un taller",
  "clinica.taller.baja": "Dio de baja a un paciente de un taller",
  // Los GRUPOS de un taller (01/09/2026): «hay que poder poner varios grupos
  // distintos para la misma actividad». Cada grupo lleva su horario, quién lo
  // imparte, quién va y su propio tipo de cita en la agenda.
  "clinica.taller.grupo.creado": "Creó un grupo de taller",
  "clinica.taller.grupo.actualizado": "Editó un grupo de taller",
  "clinica.taller.grupo.retirado": "Retiró un grupo de taller",
  "clinica.taller.grupo.borrado": "Borró un grupo de taller",
  // El registro de una sesión de taller (01/09/2026): uno para todo el grupo
  // que se copia a la ficha de cada asistente. Quitarlo se lleva por delante el
  // registro de todos ellos, por eso tiene su propia frase.
  "clinica.taller_sesion.created": "Registró una sesión de taller",
  "clinica.taller_sesion.updated": "Editó el registro de una sesión de taller",
  "clinica.taller_sesion.deleted": "Borró una sesión de taller y los registros del grupo",
  // Calendario y notas
  "calendar.task.updated": "Editó una tarea del calendario",
  "calendar.task.deleted": "Borró una tarea del calendario",
  // El calendario global (03/09/2026): el pase para abrir el CRM de un cliente
  // desde calendar.salamandrasolutions.com. El canje sale como `auth.login`
  // con motivo `calendario_global`.
  "calendario_global.salto.emitido": "Pidió abrir el CRM de un cliente desde el calendario global",
  "calendario_global.vinculo.guardado": "Vinculó un calendario de cliente al calendario global",
  "calendario_global.vinculo.quitado": "Quitó un calendario de cliente del calendario global",
  "calendar.categoria.creada": "Creó una categoría del calendario",
  "calendar.categoria.editada": "Editó una categoría del calendario",
  "calendar.categoria.desactivada": "Desactivó una categoría del calendario",
  "calendar.categoria.borrada": "Borró una categoría del calendario",
  "client.note.deleted": "Borró una nota de cliente",
  "client.note.updated": "Editó una nota de cliente",
  // Configuración del tenant (incluye credenciales: Stripe, correo, IA)
  "configuracion.updated": "Cambió la configuración del negocio",
  // El botón «Conectar mi WhatsApp» deja su propia frase y no se esconde dentro
  // de `configuracion.updated`: es la única credencial que el cliente NO pega a
  // mano —la trae Meta— y es la que decide de qué número salen sus mensajes.
  "configuracion.whatsapp_conectado": "Conectó la cuenta de WhatsApp del negocio",
  // Buzón de ayuda: el cliente nos escribe a NOSOTROS (docs/modules/buzon.md)
  "buzon.aviso_creado": "Abrió un aviso en el Buzón de ayuda",
  "buzon.aviso_actualizado": "Cambió el estado de un aviso del Buzón de ayuda",
  "buzon.enviado_al_registro": "Envió un aviso del Buzón de ayuda al Registro",
  // Panel interno de Salamandra
  "provisioning.cliente_creado": "Dio de alta a un cliente desde el panel interno",
  "provisioning.cliente_editado": "Editó un cliente desde el panel interno",
  "provisioning.credenciales_cliente": "Cambió credenciales de un cliente desde el panel interno",
  "provisioning.admin_created": "Creó una cuenta de administrador de un cliente desde el panel interno",
  // Un paquete es una PLANTILLA para el alta: crearlo, editarlo o borrarlo no
  // le cambia los módulos a ningún cliente.
  "provisioning.paquete_creado": "Creó un paquete de módulos",
  "provisioning.paquete_editado": "Editó un paquete de módulos",
  "provisioning.paquete_borrado": "Borró un paquete de módulos",
  // La baja NO borra el schema: lo aparta a `zzz_baja_…`, y el resumen guarda
  // dónde quedó. Es la única pista para encontrarlo si hay que devolverlo.
  "provisioning.cliente_baja": "Dio de baja a un cliente (el schema queda apartado, no borrado)",
  // La purga SÍ destruye: es el único rastro que queda de ese cliente.
  "provisioning.cliente_eliminado":
    "Eliminó definitivamente un cliente dado de baja (sin vuelta atrás)",
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
  // Una sola línea para toda la tanda: la reorganización con IA puede crear,
  // editar y borrar de golpe, y una fila por operación taparía el resto de la
  // actividad del día. El desglose va en el detalle.
  "project.ai_reorganized": "Reorganizó un proyecto con IA",
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
  // Módulo Banco (29/08/2026): conectar cuentas y conciliar el extracto.
  "banco.cuenta.conectada": "Conectó una cuenta del banco",
  "banco.cuenta.eliminada": "Quitó una cuenta del banco",
  "banco.movimiento.casado": "Concilió un movimiento del banco",
  "banco.movimiento.descasado": "Deshizo una conciliación bancaria",
  "quote.created": "Creó un presupuesto",
  "quote.deleted": "Borró un presupuesto",
  "quote.sent": "Envió un presupuesto",
  "billing_concept.created": "Creó un concepto del catálogo de facturación",
  "billing_concept.deleted": "Borró un concepto del catálogo de facturación",
  "cuota.created": "Dio de alta una cuota mensual",
  "cuota.updated": "Modificó una cuota mensual",
  "cuota.ended": "Dio de baja una cuota mensual",
  "cuota.deleted": "Borró una cuota mensual",
  "cuota.generated": "Generó los cobros de cuota de un mes",
  "cash_movement.created": "Apuntó una entrada o salida de caja",
  "cash_movement.deleted": "Borró una entrada o salida de caja",
  "invoice.cancelled": "Anuló una factura",
  "invoice.rectified": "Rectificó una factura",
  "invoice.split": "Partió una factura del lote en varias",
  // Citas
  "citas.event_type_created": "Creó un tipo de cita",
  "citas.event_type_updated": "Editó un tipo de cita",
  "citas.event_type_deleted": "Borró un tipo de cita",
  "citas.availability_created": "Añadió disponibilidad",
  "citas.availability_updated": "Editó disponibilidad",
  "citas.availability_deleted": "Borró disponibilidad",
  "citas.booking_created": "Creó una cita",
  // Pasar lista en una cita de taller (01/09/2026): un taller es una cita a la
  // que van varios, y la asistencia se marca uno a uno.
  "citas.taller_asistencia": "Marcó la asistencia de un paciente a un taller",
  "citas.booking_updated": "Editó una cita",
  "citas.booking_confirmed": "Confirmó una cita",
  "citas.booking_rejected": "Rechazó una cita",
  "citas.booking_cancelled": "Canceló una cita",
  "citas.booking_deleted": "Borró una cita del calendario para siempre",
  "citas.booking_status_changed": "Cambió el estado de una cita",
  "citas.blocked_day_created": "Marcó un día como festivo o cierre",
  "citas.blocked_day_deleted": "Quitó un festivo del calendario",
  "citas.bloqueo_created": "Bloqueó un tramo de agenda (vacaciones o ausencia)",
  "citas.bloqueo_updated": "Corrigió una ausencia de la agenda",
  "citas.bloqueo_deleted": "Quitó un bloqueo de agenda",
  // El acta de una reunión de equipo (01/09/2026): la escribe el CRM del audio
  // o de las notas y se guarda en el propio bloqueo (lib/reuniones/acta.js).
  "citas.bloqueo_acta_guardada": "Guardó el acta de una reunión de equipo",
  "citas.bloqueo_acta_borrada": "Borró el acta de una reunión de equipo",
  "appointment.meet_link_set": "Puso el enlace de videollamada a una cita",
  "booking.reschedule_approved": "Aprobó un cambio de hora de cita",
  // Las que faltaban hasta el 19/08/2026 (las sacó _smoke-actividad-etiquetas).
  "citas.aviso_enviado": "Envió un aviso por correo a las familias con cita",
  // No se confirma y no sale correo: la cita sigue en la lista de espera.
  "citas.booking_confirm_failed":
    "Intentó confirmar una cita y el cobro falló (sigue en la lista de espera)",
  // La carrera: se cobró y la cita ya no estaba en pie. Desde el 20/08/2026 ese
  // importe SÍ se devuelve (`lib/citas/politicaReembolso.js`), pero la
  // devolución es best-effort: si Stripe no contesta, el dinero sigue cobrado.
  // La frase cuenta lo que hizo la persona; si el importe volvió o no lo dice
  // el detalle de la auditoría, no esta línea.
  "citas.booking_confirm_tarde": "Cobró una cita que se había cancelado mientras se confirmaba",
  "citas.booking_tarjeta_pedida": "Le pidió otra tarjeta a una familia para una cita",
  "citas.pack_manual_created": "Creó un bono de sesiones a mano",
  "citas.pack_actualizado": "Editó un bono de sesiones",
  "citas.pack_anulado": "Anuló un bono de sesiones",
  // Clínica
  "clinica.session.created": "Registró una sesión clínica",
  "clinica.session.updated": "Editó una sesión clínica",
  "clinica.session.prep_file_added": "Adjuntó material de preparación a una sesión",
  "clinica.session.prep_file_deleted": "Borró un adjunto de preparación de una sesión",
  "clinica.session.sent": "Envió un registro de sesión al área privada de la familia",
  "clinica.report.created": "Creó un informe clínico",
  "clinica.report.updated": "Editó un informe clínico",
  "clinica.report.sent": "Envió un informe al área privada de la familia",
  "clinica.report.drafted": "Redactó un informe con el contenido de varias sesiones",
  "clinica.report.dictated": "Redactó un informe con IA desde un audio o unas notas",
  "clinica.coordination.created": "Registró una coordinación",
  "clinica.productividad.hours": "Cambió las horas semanales de un profesional",
  "clinica.performance.incentive": "Ajustó un incentivo",
  "clinica.performance.approve_all": "Aprobó las evaluaciones del mes",
  "clinica.performance.tiers": "Cambió los tramos de incentivos",
  "clinica.performance.incentive_item.create": "Creó un incentivo escrito",
  "clinica.performance.incentive_item.update": "Editó un incentivo escrito",
  "clinica.performance.incentive_item.delete": "Borró un incentivo escrito",
  // Las que faltaban hasta el 19/08/2026 (las sacó _smoke-actividad-etiquetas).
  "clinica.performance.create": "Registró la evaluación de desempeño de un profesional",
  "clinica.performance.update": "Editó la evaluación de desempeño de un profesional",
  "clinica.performance.config.update": "Cambió la configuración de desempeño del centro",
  "clinica.report.polished": "Pulió un informe clínico con IA",
  "clinica.report.deleted": "Borró un informe en borrador",
  // Incidencias (02/09/2026): borrar una es lo único destructivo del sistema
  // de incidencias, y hasta hoy no dejaba rastro.
  "clinica.incidencia.deleted": "Borró una incidencia",
  "clinica.pruebas.updated": "Cambió el catálogo de pruebas diagnósticas",
  "clinica.derivaciones.updated": "Cambió las especialidades de derivación del centro",
  "clinica.plantillas.updated": "Cambió los apartados de los informes o los registros del centro",
  // Contactos externos del paciente: colegio, pediatra, otro profesional.
  "clinica.contacto_externo.created": "Añadió un contacto externo a un paciente",
  "clinica.contacto_externo.updated": "Editó un contacto externo de un paciente",
  "clinica.contacto_externo.deleted": "Borró un contacto externo de un paciente",
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
  // Reescribe la copia congelada de una receta en menús y pautas ya escritos:
  // es lo único de nutrición que cambia de golpe lo que ya se había entregado.
  "nutricion.recipe.propagated": "Llevó una receta corregida a las pautas que ya la tenían",
  "nutricion.recipe.photo_uploaded": "Subió la foto de una receta",
  "nutricion.recipe.photo_deleted": "Borró la foto de una receta",
  "nutricion.food.created": "Añadió un alimento",
  "nutricion.food.updated": "Editó un alimento",
  "nutricion.food.archived": "Archivó un alimento",
  "nutricion.plan.created": "Creó un menú",
  "nutricion.plan.updated": "Editó un menú",
  "nutricion.plan.archived": "Archivó un menú",
  // Ojo (04/08/2026): lo que recibe una paciente es una PAUTA; el menú es la
  // plantilla reutilizable. Las claves NO se tocan (romperían el histórico) y
  // las acciones que valen para los dos casos se dejan en «menú».
  "nutricion.plan.assigned": "Asignó una pauta a un paciente",
  "nutricion.plan.duplicated": "Duplicó un menú",
  "nutricion.plan.reapplied": "Reaplicó el menú origen de una pauta",
  "nutricion.plan.meals.reordered": "Reordenó las comidas de un menú",
  "nutricion.menu_emailed": "Envió una pauta por email",
  // Captación
  "outreach.lead.created": "Añadió una empresa a captación",
  "outreach.lead.updated": "Editó una empresa de captación",
  "outreach.lead.deleted": "Borró una empresa de captación",
  "outreach.lead.bulk_deleted": "Borró varias empresas de captación",
  "outreach.lead.converted": "Convirtió una empresa captada en cliente",
  "outreach.lead.analyzed": "Analizó una empresa con IA",
  "outreach.scraping.run": "Buscó empresas nuevas (Google)",
  "outreach.email.sent": "Envió un correo de captación",
  // Correo a mano (24/08/2026). No lleva prefijo de módulo porque no es de
  // ninguno: `/correo` se ve con Clientes o con Captación.
  "correo.envio_masivo": "Escribió a varias personas a la vez",
  // Herramientas de /correo (26/08/2026): listas guardadas, plantillas y firmas.
  "correo.lista_creada": "Guardó una lista de destinatarios",
  "correo.lista_actualizada": "Cambió una lista de destinatarios",
  "correo.lista_borrada": "Borró una lista de destinatarios",
  "correo.plantilla_creada": "Creó una plantilla de correo",
  "correo.plantilla_actualizada": "Cambió una plantilla de correo",
  "correo.plantilla_borrada": "Borró una plantilla de correo",
  "correo.firma_actualizada": "Guardó un pie de firma",
  "correo.firma_borrada": "Quitó un pie de firma",
  // Mailing (06/09/2026)
  "mailing.contacto.created": "Añadió un correo suelto a la lista de mailing",
  "mailing.contacto.updated": "Editó un correo suelto de la lista de mailing",
  "mailing.contacto.deleted": "Quitó un correo suelto de la lista de mailing",
  "mailing.contacto.confirmacion_enviada": "Pidió confirmación de suscripción a un correo suelto",
  "mailing.contactos.imported": "Importó correos sueltos de un CSV al mailing",
  "mailing.segmento.created": "Creó un segmento de mailing",
  "mailing.segmento.updated": "Cambió un segmento de mailing",
  "mailing.segmento.deleted": "Borró un segmento de mailing",
  "mailing.campana.created": "Creó una campaña de mailing",
  "mailing.campana.updated": "Editó una campaña de mailing",
  "mailing.campana.deleted": "Borró una campaña de mailing",
  "mailing.campana.prueba_enviada": "Se mandó una prueba de una campaña de mailing",
  "mailing.campana.enviada": "Envió una campaña de mailing",
  "mailing.campana.programada": "Programó una campaña de mailing",
  "mailing.campana.desprogramada": "Quitó la programación de una campaña de mailing",
  "mailing.campana.pausada": "Pausó una campaña de mailing",
  "mailing.campana.reanudada": "Reanudó una campaña de mailing",
  "mailing.campana.cancelada": "Canceló una campaña de mailing",
  "mailing.plantilla.created": "Guardó una plantilla o firma de mailing",
  "mailing.plantilla.updated": "Cambió una plantilla o firma de mailing",
  "mailing.plantilla.deleted": "Borró una plantilla o firma de mailing",
  "mailing.supresion.created": "Añadió una dirección a la lista de supresión del mailing",
  // Documentos
  "document.uploaded": "Subió un documento",
  "document.deleted": "Borró un documento",
  "document_folder.created": "Creó una carpeta de documentos",
  "document_folder.updated": "Renombró una carpeta de documentos",
  "document_folder.deleted": "Borró una carpeta de documentos",
  // Repartir quién ve una carpeta se audita como lo que es: un cambio de
  // acceso (01/09/2026). El resumen dice cuántos, nunca quiénes — el log vive
  // en master y los nombres del equipo no se duplican ahí.
  "document_folder.shared": "Cambió quién ve una carpeta de documentos",
  // Formación / Formularios
  "training.course_registration.created": "Recibió una inscripción de curso desde la web",
  "training.sync_manual": "Sincronizó la formación con la web",
  "training.sync_manual_fallida": "Intentó sincronizar la formación y falló",
  "formularios.solicitud.aceptada": "Aceptó una solicitud y creó la ficha de cliente",
  // Fichaje (control horario): lo que escriben los endpoints de /api/fichaje/*.
  // Faltaban desde el 13/08/2026 y salían por el traductor genérico.
  "fichaje.volcado": "Volcó el Excel del reloj de fichar de un mes",
  "fichaje.volcado_deshecho": "Deshizo el volcado de un mes de fichajes",
  "fichaje.creado_a_mano": "Apuntó un fichaje a mano",
  "fichaje.corregido": "Corrigió un fichaje",
  "fichaje.dado_de_baja": "Dio de baja un fichaje",
  // Accesos
  "auth.login": "Entró en el CRM",
  "auth.login_failed": "Intento de acceso fallido",
  "auth.login_blocked": "Acceso bloqueado por demasiados intentos",
  // Cambiarse UNO MISMO la contraseña desde Configuración (24/08/2026). El
  // fallo se apunta aparte del de login porque significa otra cosa: no es que
  // alguien no consiga entrar, es que alguien YA DENTRO no acierta la de ahora
  // — y eso, repetido, es una sesión ajena intentando quedarse la cuenta.
  "auth.password_changed": "Cambió su contraseña",
  "auth.password_change_failed": "Falló al cambiar su contraseña",
  "auth.correo_changed": "Se puso el correo de su cuenta",
  "auth.correo_change_failed": "Falló al ponerse el correo de su cuenta",
  // IA
  "ai.uso": "Usó la IA",
  "ai.permiso_concedido": "Concedió un permiso de IA",
  "ai.permiso_denegado": "Denegó un permiso de IA",
  "ai.permiso_revocado": "Revocó un permiso de IA",
};

const VERBOS = {
  created: "creó",
  updated: "editó",
  deleted: "borró",
  archived: "archivó",
  uploaded: "subió",
  moved: "movió",
  sent: "envió",
  issued: "emitió",
  cancelled: "canceló",
  assigned: "asignó",
  confirmed: "confirmó",
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
