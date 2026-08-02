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
];

export const MODULES = {
  leads: ["migrate-stage-to-string"],

  // Tabla donde el CRM guarda su propia foto diaria de las visitas. Hace falta
  // porque Cloudflare solo conserva 7 días: sin esta copia no hay forma de
  // enseñar meses ni años, y el dato viejo se pierde para siempre.
  analytics: ["migrate-web-visits-daily"],

  clients: [
    "migrate-client-attachments-and-notes",
    "migrate-patients-clients-phase1",
    "migrate-client-module-assignments",
    // Consentimiento de comunicaciones de la familia (01/08/2026): aditiva,
    // una columna JSONB en clients.
    "migrate-client-communication-prefs",
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
    // Horario propio del profesional (team_member_hours): lo usa la generación
    // de huecos de citas, pero su tabla base es team_members (por eso está
    // también en `team`).
    "migrate-team-member-hours",
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
    "migrate-clinica-module",
    "migrate-clinica-client-link",
    "migrate-patients-care-type",
    "migrate-patients-specialties",
    "migrate-documents-patient-link",
    "migrate-incidencias-module",
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

  inventory: ["migrate-inventory-rework"],
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
