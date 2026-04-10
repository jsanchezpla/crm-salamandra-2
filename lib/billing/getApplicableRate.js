import { Op } from "sequelize";

/**
 * Devuelve la tarifa vigente para un therapistId + serviceType en una fecha dada.
 * Prioridad: tarifa específica del terapeuta > tarifa general del centro (therapistId null).
 * Devuelve null si no existe ninguna tarifa aplicable.
 */
export async function getApplicableRate(Rate, { therapistId, serviceType, date }) {
  const refDate = date || new Date().toISOString().slice(0, 10);

  const where = {
    serviceType,
    validFrom: { [Op.lte]: refDate },
    [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: refDate } }],
  };

  // Primero busca tarifa específica del terapeuta
  if (therapistId) {
    const specific = await Rate.findOne({ where: { ...where, therapistId } });
    if (specific) return specific;
  }

  // Fallback: tarifa general del centro
  return Rate.findOne({ where: { ...where, therapistId: null } });
}
