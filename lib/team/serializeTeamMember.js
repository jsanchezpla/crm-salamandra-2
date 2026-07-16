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
    hourlyRate: m.hourlyRate != null ? Number(m.hourlyRate) : null,
    currency: m.currency ?? "EUR",
    status: m.status,
    startDate: m.hiredAt ?? null,
    notes: m.notes ?? null,
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
