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
 * ── Dos estructuras ────────────────────────────────────────────────────────
 *
 * ORDER   Orden canónico GLOBAL de todas las migraciones. Cuando un tenant
 *         tiene varios módulos, la unión de sus migraciones se ordena por este
 *         array. Es imprescindible porque hay dependencias CRUZADAS entre
 *         módulos, no solo dentro de uno:
 *           · patients-clients-phase1 debe ir ANTES que client-module-assignments
 *           · client-module-assignments crea el índice único patients_client_unique
 *             que patients-multi-per-client luego ELIMINA → invertirlas rompe
 *           · team-fields antes que team-modules-salary
 *           · billing-rework es la base del resto de billing-*
 *
 * MODULES Qué migraciones pertenecen a cada `module_key`. Una misma migración
 *         puede estar en varios módulos (ej. calendar-citas-fks toca tanto
 *         calendar_tasks como bookings).
 *
 * CORE    Migraciones transversales que se ejecutan SIEMPRE, tenga el tenant los
 *         módulos que tenga. Son aditivas y deciden por existencia de tabla, así
 *         que en un schema que no las necesita son un no-op.
 *
 * ⚠️ El orden está reconstruido a partir de docs/deploy-notes-2026-07-19.md y de
 *    las cabeceras de cada script. Jorge debería revisarlo: es el único punto de
 *    este diseño que depende de memoria histórica y no de algo verificable.
 */

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
};

export const ORDER = [
  // ── Base transversal (clientes/pacientes/reservas) ──────────────────────
  "migrate-stage-to-string",
  "migrate-calendar-citas-fks",
  "migrate-citas-sprint-1",
  "migrate-booking-pending",
  "migrate-client-attachments-and-notes",
  "migrate-patients-clients-phase1",
  "migrate-client-module-assignments",
  "migrate-patients-multi-per-client",

  // ── Equipo (antes que billing: billing tiene FKs a team_members) ────────
  "migrate-team-fields",
  "migrate-rename-therapist-to-employee",
  "migrate-team-modules-salary",
  "migrate-team-members-avatar-color",

  // ── Clínica y pacientes ─────────────────────────────────────────────────
  // (pacientes-sprint-1 y clinica-sprint-1 van en ONE_OFF: hardcodean `aumenta`)
  "migrate-clinica-module",

  // ── Facturación (rework primero, es la base) ────────────────────────────
  "migrate-billing-rework",
  "migrate-billing-fix-kind-enum",
  "migrate-billing-quotes",
  "migrate-billing-correction-reason",
  "migrate-billing-tax-regime",
  "migrate-billing-vat-exempt",
  "migrate-billing-irpf-partners",

  // ── Proyectos ───────────────────────────────────────────────────────────
  "migrate-projects-sprint-1",
  "migrate-projects-sprint-2",
  "migrate-projects-task-priority",

  // ── Formación ───────────────────────────────────────────────────────────
  "migrate-training-fields",
  "migrate-training-archive",
  "migrate-course-registrations",

  // ── Inventario, documentos, nutrición ───────────────────────────────────
  "migrate-inventory-rework",
  "migrate-documents-sprint-1",
  "migrate-nutricion-recipes",

  // ── Captación ───────────────────────────────────────────────────────────
  "migrate-outreach-sprint-1",
  "migrate-outreach-google-usage",
  "migrate-outreach-convert",
  "migrate-outreach-website-text",
];

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
  ],

  citas: [
    "migrate-citas-sprint-1",
    "migrate-calendar-citas-fks",
    "migrate-booking-pending",
  ],

  calendar: ["migrate-calendar-citas-fks"],

  pacientes: [
    "migrate-patients-clients-phase1",
    "migrate-client-module-assignments",
    "migrate-patients-multi-per-client",
  ],

  clinica: ["migrate-clinica-module"],

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
  documents: ["migrate-documents-sprint-1"],
  nutricion: ["migrate-nutricion-recipes"],

  outreach: [
    "migrate-outreach-sprint-1",
    "migrate-outreach-google-usage",
    "migrate-outreach-convert",
    "migrate-outreach-website-text",
  ],
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

/** Migraciones declaradas en MODULES/CORE que no están en ORDER (error de mapa). */
export function mapInconsistencies() {
  const inOrder = new Set(ORDER);
  const declared = new Set([...CORE, ...Object.values(MODULES).flat()]);
  return {
    sinOrden: [...declared].filter((m) => !inOrder.has(m)),
    huerfanas: ORDER.filter((m) => !declared.has(m)),
  };
}
