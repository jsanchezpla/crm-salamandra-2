import { Op } from "sequelize";

/**
 * Devuelve la tarifa vigente para un employeeId + serviceType en una fecha dada.
 * Prioridad: tarifa específica del empleado > tarifa general (employeeId null).
 * Devuelve null si no existe ninguna tarifa aplicable.
 */
export async function getApplicableRate(Rate, { employeeId, serviceType, date }) {
  const refDate = date || new Date().toISOString().slice(0, 10);

  const where = {
    serviceType,
    validFrom: { [Op.lte]: refDate },
    [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: refDate } }],
  };

  // Primero busca tarifa específica del empleado
  if (employeeId) {
    const specific = await Rate.findOne({ where: { ...where, employeeId } });
    if (specific) return specific;
  }

  // Fallback: tarifa general
  return Rate.findOne({ where: { ...where, employeeId: null } });
}
