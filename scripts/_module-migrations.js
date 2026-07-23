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
];

export const MODULES = {
  leads: ["migrate-stage-to-string"],

  clients: [
    "migrate-client-attachments-and-notes",
    "migrate-patients-clients-phase1",
    "migrate-client-module-assignments",
    "migrate-interactions-notes-team",
    "migrate-documents-transversal",
  ],

  citas: [
    "migrate-citas-sprint-1",
    "migrate-calendar-citas-fks",
    "migrate-booking-pending",
    "migrate-booking-client-link",
  ],

  calendar: ["migrate-calendar-citas-fks"],

  pacientes: [
    "migrate-patients-clients-phase1",
    "migrate-client-module-assignments",
    "migrate-patients-multi-per-client",
  ],

  clinica: ["migrate-clinica-module", "migrate-clinica-client-link"],

  team: [
    "migrate-team-fields",
    "migrate-rename-therapist-to-employee",
    "migrate-team-modules-salary",
    "migrate-team-members-avatar-color",
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
  documents: ["migrate-documents-sprint-1", "migrate-documents-client-link", "migrate-documents-transversal"],
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
