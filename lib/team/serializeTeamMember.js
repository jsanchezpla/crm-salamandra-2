/**
 * Único punto de mapeo BD → API para TeamMember.
 *
 * - Renombra `position` → `role` y `hiredAt` → `startDate` para nomenclatura
 *   limpia hacia el cliente (las columnas en BD se mantienen).
 * - Filtra `hourlyCost` cuando el solicitante no es admin/superadmin.
 *
 * Usar SIEMPRE este serializer en respuestas del módulo team
 * (listado, detalle, post-create, post-update).
 */
import { normalizeSpecialties, specialtyLabels } from "../clinica/specialties.js";

export function serializeTeamMember(member, { isAdmin = false } = {}) {
  if (!member) return null;
  const m = typeof member.toJSON === "function" ? member.toJSON() : member;

  const result = {
    id: m.id,
    userId: m.userId ?? null,
    displayName: m.displayName,
    email: m.email ?? null,
    role: m.position ?? null,
    department: m.department ?? null,
    phone: m.phone ?? null,
    avatarUrl: m.avatarUrl ?? null,
    avatarColor: m.avatarColor ?? null,
    // Color de SUS bloqueos en la agenda. Vacío = hereda el del centro.
    blockColor: m.blockColor ?? null,
    hourlyRate: m.hourlyRate != null ? Number(m.hourlyRate) : null,
    currency: m.currency ?? "EUR",
    status: m.status,
    startDate: m.hiredAt ?? null,
    notes: m.notes ?? null,
    specialties: normalizeSpecialties(m.specialties),
    specialtyLabels: specialtyLabels(m.specialties),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };

  if (isAdmin) {
    result.hourlyCost = m.hourlyCost != null ? Number(m.hourlyCost) : null;
    // Retribución (solo admin). monthlySalary es DERIVADO de annualGross/paymentPeriods.
    result.annualGross = m.annualGross != null ? Number(m.annualGross) : null;
    result.paymentPeriods = m.paymentPeriods != null ? Number(m.paymentPeriods) : 12;
    result.monthlySalary = m.monthlySalary != null ? Number(m.monthlySalary) : null;
  }

  return result;
}

/**
 * La MISMA ficha, recortada a lo que necesita un DESPLEGABLE (26/08/2026).
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *
 * «Quién trabaja en este centro» y «qué cobra quién» son dos preguntas, y
 * /api/team las contestaba juntas o no contestaba ninguna. Como gateaba con
 * `hasModule("team")` —tenant ∩ usuario—, las quince terapeutas de Aumenta, que
 * no llevan `team` en sus accesos porque no tienen por qué entrar en la pantalla
 * de Equipo, recibían un 403 en la petición de la LISTA. Y una docena de
 * pantallas se traga ese 403 en silencio: el filtro de terapeutas de /pacientes
 * se inventaba entonces la lista con los 50 pacientes de la página que tuviera
 * delante —de 1.174—, así que salían la mitad de las compañeras y CAMBIABAN al
 * pasar de página. Peor: ese mismo desplegable a medias es el que asigna
 * terapeuta al dar de alta un paciente, o sea que el agujero ensuciaba el dato.
 *
 * Es el mismo error que ya está contado en lib/citas/visibilidad.js: preguntar
 * por el USUARIO cuando la pregunta era por el CENTRO. Allí quitar permisos
 * DESTAPABA datos; aquí los esconde hasta romper la pantalla. La misma regla
 * arregla los dos:
 *
 *   «¿tiene el CENTRO equipo?»          → tenantHasModule  → lista recortada
 *   «¿puede esta persona abrir Equipo?» → hasModule        → ficha completa
 *
 * ── QUÉ LLEVA Y QUÉ NO ─────────────────────────────────────────────────────
 *
 * Lleva lo que hace falta para PINTAR a una persona y elegirla: su nombre, su
 * color en la agenda, su puesto, sus especialidades y si tiene horario puesto.
 *
 * NO lleva nada que sea suyo y de nadie más: correo, teléfono, notas, fecha de
 * alta, tarifa, coste/hora ni retribución. Quien necesite eso pasa por la
 * pantalla de Equipo, que sigue pidiendo el módulo en los accesos —y el dinero,
 * además, rol de dirección.
 */
export function serializeProfesional(member) {
  if (!member) return null;
  const m = typeof member.toJSON === "function" ? member.toJSON() : member;

  return {
    id: m.id,
    // Para que una pantalla sepa cuál de la lista es quien está mirando.
    userId: m.userId ?? null,
    displayName: m.displayName,
    role: m.position ?? null,
    status: m.status,
    avatarUrl: m.avatarUrl ?? null,
    avatarColor: m.avatarColor ?? null,
    blockColor: m.blockColor ?? null,
    specialties: normalizeSpecialties(m.specialties),
    specialtyLabels: specialtyLabels(m.specialties),
  };
}

/**
 * Los campos que NUNCA salen en la lista recortada. Lo vigila
 * scripts/_smoke-team-lista-profesionales.mjs: si mañana alguien añade un campo
 * de dinero al serializer completo, tiene que añadirlo aquí a mano y se entera
 * de que existe esta puerta.
 */
export const CAMPOS_FUERA_DE_LA_LISTA = [
  "email",
  "phone",
  "notes",
  "department",
  "startDate",
  "hourlyRate",
  "currency",
  "hourlyCost",
  "annualGross",
  "paymentPeriods",
  "monthlySalary",
];
