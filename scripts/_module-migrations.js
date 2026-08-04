/**
 * _module-migrations.js — mapa declarativo MÓDULO → MIGRACIONES.
 *
 * Hasta ahora este conocimiento solo vivía en los runbooks de `docs/` y en la
 * cabeza de Jorge: qué migraciones hay que correr cuando un tenant estrena un
 * módulo, y en qué orden. Ese hueco es lo que provocó el incidente del
 * 2026-07-21 (activar un módulo dejaba el schema atrás y toda lectura reventaba
 * con 42703). Aquí queda escrito para que lo sepa la máquina.
 *
 * Lo consume `scripts/ensure-tenant-schema.js`.
 *
 * ── Tres estructuras ───────────────────────────────────────────────────────
 *
 * ORDER   Orden canónico GLOBAL, CALCULADO del SQL de las migraciones (ver
 *         _migration-order.js). Hace falta porque hay dependencias CRUZADAS
 *         entre módulos, no solo dentro de uno: p. ej.
 *         `client-module-assignments` crea el índice único
 *         `patients_client_unique` que `patients-multi-per-client` luego
 *         ELIMINA — invertirlas rompe. Esa arista, y las otras 15, salen de
 *         leer el código, no de acordarse.
 *
 * MODULES Qué migraciones pertenecen a cada `module_key`. Una misma migración
 *         puede estar en varios módulos (ej. calendar-citas-fks toca tanto
 *         calendar_tasks como bookings).
 *
 * CORE    Migraciones transversales que se ejecutan SIEMPRE, tenga el tenant los
 *         módulos que tenga. Son aditivas y deciden por existencia de tabla, así
 *         que en un schema que no las necesita son un no-op.
 */

import { computeOrder } from "./_migration-order.js";

/**
 * Migraciones EXCLUIDAS a propósito: no son migraciones de módulo reutilizables,
 * son parches históricos atados a un tenant concreto (hardcodean el slug, contra
 * la regla 12 de CLAUDE.md). Ejecutarlas en otro entorno falla con "Schema
 * crm_X no existe", que es exactamente lo que pasó al probar el disparador.
 * Ya están aplicadas en producción; se dejan documentadas, no automatizadas.
 *
 * Si algún día se generalizan (leer los tenants de master.tenants en runtime),
 * muévanse a MODULES y a ORDER.
 */
export const ONE_OFF = {
  "migrate-quality-leads": "atada a quality_energy",
  "migrate-pacientes-sprint-1": "cabecera: «solo aumenta»",
  "migrate-clinica-sprint-1": "cabecera: «solo aumenta»",
  "migrate-attachments-to-documents": "migración de DATOS (mueve ficheros+filas), se corre a mano una vez, no la ejecuta el disparador",
  "backfill-nutricion-assignments": "DATOS: marca «Paciente Nutrición» a los clientes previos al auto-marcado (2026-07-27); repetible, se corre a mano",
  "backfill-patients-client": "DATOS: enlaza pacientes con su ficha de pagador a partir de sus citas/sesiones; dry-run por defecto, se corre a mano con --confirm",
  "migrate-contract-patient-to-client": "DATOS: mueve el contrato del paciente a la familia (sprint 2026-07, 1.1); copia el PDF a `documents` y apunta clients.contract_document_id; dry-run por defecto, se corre a mano con --confirm",
  "podar-audit-logs": "MANTENIMIENTO del schema MASTER: retención del registro de auditoría; dry-run por defecto, lo lanza un temporizador semanal",
  "migrate-documents-avanzado": "MASTER, no toca schemas de tenant: reparte el módulo Documentos en básico/avanzado y da el avanzado a quien ya tenía Documentos, para que nadie pierda el archivo por el cambio de nomenclatura. Se corre a mano una vez, idempotente",
  "migrate-audit-logs-index": "índice en el schema MASTER (audit_logs), no por-tenant; idempotente, se corre a mano una vez",
  "migrate-clients-avanzado": "MASTER, no toca schemas de tenant: saca la lista de espera de admisión de `clients` a `clients_avanzado` y se la da solo a quien admite por cola (aumenta, demo). Se corre a mano una vez, idempotente",
  "migrate-inventory-rework":
    "SUPERADA (02/08/2026). Es el rework de abril: creaba inbound_products, outbound_products, formulas y client_outbound_aliases, que son exactamente las tablas que `migrate-inventario-rework` (con «a») elimina. Ejecutarla en un tenant nuevo le devolvería el esquema viejo. Se conserva como histórico, NO se ejecuta.",
  "migrate-usuario-backoffice": "MASTER, no toca schemas de tenant: añade `solo_backoffice` a `master.users` para separar las cuentas del panel interno de las del CRM. Se corre a mano con `npm run db:migrate:backoffice`; aditiva, con default false, idempotente",
};

/**
 * Orden canónico global. NO se escribe a mano: se DEDUCE del SQL de cada
 * migración (quién crea una tabla va antes que quien la altera) en
 * scripts/_migration-order.js. Audítalo con:
 *
 *   node scripts/check-migration-order.js
 */
export const ORDER = computeOrder();

export const CORE = [
  // Aditivas y decididas por existencia de tabla: no-op donde no aplican.
  "migrate-calendar-citas-fks",
  "migrate-patients-clients-phase1",
  // Tabla notifications (transversal): la usa el sistema de alertas de Clínica,
  // pero se crea en todos los schemas porque el modelo Notification está
  // registrado para todos los tenants (evita 42703 si algún código la consulta).
  "migrate-notifications-table",
  // Tabla ai_permissions (transversal): permisos de empleados para usar la IA
  // de pago cuando el tenant activa settings.aiAccess = "restringido". Modelo
  // registrado para todos los tenants, mismo criterio que notifications.
  "migrate-ai-permissions",
  // Capa de pagos online (payment_sessions + stripe_webhook_events). Transversal
  // por el mismo motivo: los modelos están registrados para todos los tenants.
  // Cobrar o no depende de que el tenant tenga sus claves de Stripe, no de que
  // exista la tabla.
  "migrate-payments-sprint-1",
  // Sprint Aumenta 2026-07: cobros sin factura, faltas justificadas, registro
  // de sesión en 3 partes, tipo "Derivación", tutores del cliente, festivos,
  // lista de espera, plan de intervención y multi-responsable en incidencias.
  // CORE y no por módulo porque toca tablas de VARIOS módulos (billing, citas,
  // clinica, clients) y cada bloque decide por existencia de tabla: en un
  // tenant sin esa tabla es un no-op. Sin registrarla aquí, un cliente dado de
  // alta desde el panel nacía sin blocked_days ni intervention_plans y esas
  // pantallas le respondían 503.
  "migrate-sprint-aumenta-2026-07",
  // Terapeuta asignado en la cola de admisión. CORE por el mismo motivo que la
  // de arriba —que es quien crea `waitlist_entries`—: decide por existencia de
  // tabla, así que en un tenant sin `clients_avanzado` es un no-op.
  "migrate-waitlist-therapist",
  // Contrato del portal con datos y anexos (04/08/2026). CORE porque AMPLÍA
  // `contract_signatures`, que la crea `migrate-sprint-aumenta-2026-07` para
  // todos los tenants: sin esta, un cliente nuevo nace con la tabla vieja y la
  // primera firma revienta pidiendo `template_key`. La tabla de plantillas sí
  // se crea solo donde hay `citas` (lo decide el propio script).
  "migrate-contrato-estructurado",
];

export const MODULES = {
  leads: ["migrate-stage-to-string"],

  // Tabla donde el CRM guarda su propia foto diaria de las visitas. Hace falta
  // porque Cloudflare solo conserva 7 días: sin esta copia no hay forma de
  // enseñar meses ni años, y el dato viejo se pierde para siempre.
  analytics: ["migrate-web-visits-daily"],

  clients: [
    // «Ya lo he mirado y está bien»: sin esto, la pantalla de fichas a
    // completar no llega a cero nunca (03/08/2026).
    "migrate-data-reviews",
    "migrate-client-attachments-and-notes",
    "migrate-patients-clients-phase1",
    "migrate-client-module-assignments",
    // Consentimiento de comunicaciones de la familia (01/08/2026): aditiva,
    // una columna JSONB en clients.
    "migrate-client-communication-prefs",
    // Fecha de nacimiento del cliente (04/08/2026): en un centro de nutrición
    // el paciente ES el cliente, y es lo que decide si al firmar el contrato
    // hace falta además el consentimiento de su tutor legal.
    "migrate-client-birthdate",
    "migrate-interactions-notes-team",
    "migrate-documents-transversal",
    // El archivo central (documents) se crea para cualquier tenant con clients;
    // patient_id también debe llegar ahí (la columna es incondicional, la FK
    // solo si existe patients). Si no, un tenant solo-clientes tendría documents
    // sin patient_id y el modelo reventaría con 42703 al leer adjuntos.
    "migrate-documents-patient-link",
    // Mismo motivo: el modelo Document referencia client_visible y
    // uploaded_by_client en TODOS los tenants con tabla documents, así que las
    // columnas tienen que existir aunque el tenant no tenga portal de paciente.
    "migrate-documents-client-portal",
  ],

  citas: [
    "migrate-citas-sprint-1",
    "migrate-calendar-citas-fks",
    "migrate-booking-pending",
    "migrate-booking-client-link",
    "migrate-booking-change-requests",
    // Marca de "ya se le mandó el recordatorio de la víspera".
    "migrate-booking-reminder",
    // Retención de tarjeta (autorizado sin cobrar): valores nuevos del enum de
    // payment_status y `authorization_expires_at`. Va aquí porque un tenant que
    // estrene Citas nace con `bookings`, y sin esta migración el modelo pide una
    // columna que no existe y CUALQUIER consulta de citas revienta con un 500
    // (visto en local el 31/07). El script se salta solo los schemas sin las
    // tablas de pagos, así que es inofensivo para quien no cobre online.
    "migrate-booking-authorization",
    // El correo de la cita deja de ser obligatorio (02/08/2026): una cita que
    // apunta recepción por teléfono, o que llega importada, puede no tenerlo.
    // SIN ESTO la importación de una agenda revienta a mitad.
    "migrate-booking-email-opcional",
    // Horario propio del profesional (team_member_hours): lo usa la generación
    // de huecos de citas, pero su tabla base es team_members (por eso está
    // también en `team`).
    "migrate-team-member-hours",
    // Avisos del centro al cliente (03/08/2026): salen por correo y quedan
    // publicados en el portal. Cuelga de `citas` porque el portal donde se leen
    // ES el de citas y la sesión que los autoriza es la suya.
    "migrate-avisos-cliente",
    // Bonos de sesiones, precio fraccionado y formulario por tipo de cita
    // (04/08/2026). Un tipo de cita pasa a poder valer por N sesiones, con su
    // numeración («3 de 10») visible en el calendario.
    "migrate-packs-sesiones",
  ],

  calendar: ["migrate-calendar-citas-fks"],

  pacientes: [
    "migrate-patients-clients-phase1",
    "migrate-client-module-assignments",
    "migrate-patients-multi-per-client",
    "migrate-patients-care-type",
    "migrate-patients-specialties",
    "migrate-documents-patient-link",
  ],

  clinica: [
    // Agenda de profesionales externos del paciente + enlace desde las actas
    // de coordinación (02/08/2026).
    "migrate-external-contacts",
    // Un contacto externo puede constar solo por su papel («Tutora») o solo por
    // su nombre («Blanca»): así vienen escritos en las actas (02/08/2026).
    "migrate-contactos-externos-nombre-opcional",
    // Talleres: actividades de grupo (02/08/2026). Necesita `patients`, que la
    // crea migrate-pacientes-sprint-1; el orden lo resuelve el analizador.
    "migrate-talleres",
    "migrate-clinica-module",
    // El autor del acta puede no estar en la plantilla (02/08/2026): campo de
    // texto libre y created_by_id opcional.
    "migrate-coordinaciones-autor-libre",
    // El terapeuta de una sesión deja de ser obligatorio (02/08/2026): en un
    // histórico importado hay sesiones firmadas por quien ya no está.
    "migrate-sesion-terapeuta-opcional",
    "migrate-clinica-client-link",
    "migrate-patients-care-type",
    "migrate-patients-specialties",
    "migrate-documents-patient-link",
    "migrate-incidencias-module",
    "migrate-incidencias-verificacion",
    "migrate-incentive-items",
    // Desempeño por roles: role_key + area_scores en performance_metrics.
    "migrate-clinica-performance-roles",
  ],

  team: [
    "migrate-team-fields",
    "migrate-rename-therapist-to-employee",
    "migrate-team-modules-salary",
    "migrate-team-members-avatar-color",
    "migrate-team-specialties",
    "migrate-team-weekly-hours",
    "migrate-team-member-hours",
  ],

  billing: [
    // Proveedores como entidad (02/08/2026). Va en billing y no en inventory
    // porque crea el enlace desde `costs`; Inventario lo usará cuando se rehaga.
    "migrate-suppliers",
    // Arqueo de caja (02/08/2026): lo único de Contabilidad de Organízate que
    // nuestro módulo de Facturación no cubría.
    "migrate-arqueo",
    // Impuestos como tipo de gasto propio + varios arqueos por día
    // (02/08/2026, Rodrigo). Universal, no solo de Aumenta.
    "migrate-impuestos-y-arqueo",
    "migrate-billing-rework",
    "migrate-billing-fix-kind-enum",
    "migrate-billing-quotes",
    "migrate-billing-correction-reason",
    "migrate-billing-tax-regime",
    "migrate-billing-vat-exempt",
    "migrate-billing-irpf-partners",
    "migrate-rename-therapist-to-employee",
  ],

  projects: [
    "migrate-projects-sprint-1",
    "migrate-projects-sprint-2",
    "migrate-projects-task-priority",
  ],

  training: [
    "migrate-training-fields",
    "migrate-training-archive",
    "migrate-course-registrations",
  ],

  inventory: [
    // Rework completo del 02/08/2026: Product/StockEntry sustituyen a
    // Inbound/Outbound/Formula. Va DESPUÉS de migrate-suppliers, que crea la
    // tabla a la que apunta stock_entries.supplier_id.
    //
    // ⚠️ Ya NO se declara `migrate-inventory-rework` (el de 2026-04, sin la «a»).
    // Creaba inbound_products / outbound_products / formulas, que son justo las
    // tablas que el rework nuevo elimina: dejarlo aquí hacía que un tenant
    // recién dado de alta se las volviera a encontrar. El fichero se conserva
    // como histórico de lo que se hizo entonces, pero no se ejecuta.
    "migrate-inventario-rework",
  ],
  documents: ["migrate-documents-sprint-1", "migrate-documents-client-link", "migrate-documents-transversal", "migrate-documents-patient-link", "migrate-documents-client-portal"],

  // Documentos AVANZADO (01/08/2026): mismas tablas que el básico —el archivo
  // ya existe, lo que cambia es quién puede verlo entero—, así que comparte
  // migraciones. Se declara para que un cliente que estrene el avanzado sin
  // haber tenido el básico no nazca sin `documents`.
  documents_avanzado: ["migrate-documents-sprint-1", "migrate-documents-client-link", "migrate-documents-transversal", "migrate-documents-patient-link", "migrate-documents-client-portal"],
  nutricion: [
    "migrate-nutricion-recipes",
    "migrate-nutricion-week-recipe-media",
    "migrate-nutricion-day-comments",
    "migrate-nutricion-show-macros",
    // Tipo, etiquetas, alérgenos, preferencias, duración y raciones en las
    // recetas (04/08/2026): con mil recetas, sin filtros no hay recetario.
    "migrate-recetas-clasificacion",
    "migrate-plan-team",
  ],

  outreach: [
    "migrate-outreach-sprint-1",
    "migrate-outreach-google-usage",
    "migrate-outreach-convert",
    "migrate-outreach-website-text",
  ],

  // Formularios públicos → bandeja en el CRM → ficha de cliente al aceptar.
  formularios: ["migrate-formularios-module", "migrate-formsubmission-team"],

  // Helpdesk del tenant hacia SUS clientes: tickets numerados, hilo con notas
  // internas, adjuntos, SLA y portal público de seguimiento.
  support: ["migrate-support-module"],
};

/**
 * Migraciones que corresponden a una lista de módulos, deduplicadas y ordenadas
 * por el orden canónico global. Siempre incluye CORE.
 */
export function migrationsFor(moduleKeys = []) {
  const set = new Set(CORE);
  for (const k of moduleKeys) for (const m of MODULES[k] || []) set.add(m);
  return ORDER.filter((m) => set.has(m));
}

/**
 * Salud del mapa. Como ORDER se calcula de los ficheros que hay en disco, esto
 * detecta las dos formas de que el mapa se desincronice del repo:
 *   sinOrden   declaradas en MODULES/CORE pero cuyo fichero ya no existe.
 *   huerfanas  ficheros de migración que nadie ejecutaría nunca: sin módulo, sin
 *              CORE y sin marcar como ONE_OFF. Lo normal es que alguien haya
 *              añadido una migración y se le haya olvidado apuntarla aquí.
 */
export function mapInconsistencies() {
  const inOrder = new Set(ORDER);
  const declared = new Set([...CORE, ...Object.values(MODULES).flat()]);
  const oneOff = new Set(Object.keys(ONE_OFF));
  return {
    sinOrden: [...declared].filter((m) => !inOrder.has(m)),
    huerfanas: ORDER.filter((m) => !declared.has(m) && !oneOff.has(m)),
  };
}
