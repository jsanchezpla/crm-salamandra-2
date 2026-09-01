/**
 * repartoPorEmpleado — a quién se atribuye la base imponible de una factura
 * cuando sus líneas llevan terapeutas distintos (31/08/2026).
 *
 * Una factura con sesiones de dos terapeutas llevaba UN solo empleado, así
 * que en «Por empleado» el dinero se lo apuntaba entero uno. La regla, en un
 * solo sitio: cada línea se atribuye a SU empleado; una línea sin él, al de
 * la factura; lo que no tiene empleado ni en la línea ni en la factura no se
 * atribuye a nadie (igual que siempre: esas facturas no salen en la tabla).
 * Los títulos de apartado no cuentan y una línea de descuento (base negativa)
 * RESTA al terapeuta que la lleva.
 *
 * Devuelve un Map employeeId → base (céntimos redondeados por acumulado).
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function basePorEmpleado({ lines, employeeId } = {}) {
  const reparto = new Map();
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!l || l.kind === "titulo") continue;
    const quien = l.employeeId ?? employeeId ?? null;
    if (!quien) continue;
    const base = Number(l.lineBase ?? 0);
    if (!Number.isFinite(base) || base === 0) continue;
    reparto.set(quien, round2((reparto.get(quien) ?? 0) + base));
  }
  return reparto;
}

/** ¿Alguna línea lleva su propio empleado? (decide si la factura se reparte en JS) */
export function llevaRepartoPorLineas(lines) {
  return Array.isArray(lines) && lines.some((l) => l && l.employeeId);
}
