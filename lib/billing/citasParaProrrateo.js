/**
 * lib/billing/citasParaProrrateo.js — las citas del mes de cada cuota, para
 * prorratear por SESIONES y no por días (07/09/2026, AV-0062 de Aumenta).
 *
 * Rosa: «un paciente que empieza el día 11 viene 3 sesiones de 4 y el sistema
 * calcula 20 días de 30; los importes no tienen nada que ver». La cuota de un
 * centro como Aumenta es por sesiones semanales («Pedagogía 60x1»), así que
 * lo que se paga del primer mes es la parte de las sesiones que se dan, no
 * la parte del calendario.
 *
 * Esta pieza es la ÚNICA que toca la base: carga, de una vez, las citas del
 * mes (sin las canceladas) de los pacientes —o, sin paciente, de las
 * familias— de las cuotas que se van a generar, y las devuelve en un mapa
 * que `planDeCuotasDelMes` (puro, y que también corre en el navegador) lee
 * con `citasDeLaCuota`. Sin citas en el tramo, la cuota se sigue prorrateando
 * por días, que es lo de siempre.
 *
 * Sin tabla de citas (un centro sin `citas`), mapa vacío: no se cae nada.
 */

import { Op } from "sequelize";
import { ultimoDiaDe } from "./cuotas.js";

/** La clave del mapa: primero el paciente, si no la familia. */
export function claveDeCitas({ patientId, clientId } = {}) {
  if (patientId) return `p:${patientId}`;
  if (clientId) return `c:${clientId}`;
  return null;
}

export async function citasDelMesParaCuotas({ tenantModels, mes, cuotas = [] } = {}) {
  const { Booking } = tenantModels || {};
  const mapa = {};
  if (!Booking || !Array.isArray(cuotas) || !cuotas.length || !/^\d{4}-\d{2}$/.test(String(mes))) return mapa;

  const pacientes = [...new Set(cuotas.map((c) => c?.patientId).filter(Boolean).map(String))];
  const familias = [...new Set(cuotas.filter((c) => !c?.patientId && c?.clientId).map((c) => String(c.clientId)))];
  if (!pacientes.length && !familias.length) return mapa;

  const desde = new Date(`${mes}-01T00:00:00+02:00`);
  const hasta = new Date(`${ultimoDiaDe(mes)}T23:59:59+02:00`);
  const quien = [];
  if (pacientes.length) quien.push({ patientId: { [Op.in]: pacientes } });
  if (familias.length) quien.push({ clientId: { [Op.in]: familias }, patientId: null });

  let filas = [];
  try {
    filas = await Booking.findAll({
      attributes: ["patientId", "clientId", "scheduledAt", "status"],
      where: {
        scheduledAt: { [Op.between]: [desde, hasta] },
        status: { [Op.ne]: "cancelled" },
        [Op.or]: quien,
      },
      raw: true,
    });
  } catch (err) {
    // Sin tabla de citas (42P01) no hay sesiones que contar: por días.
    if (err?.parent?.code === "42P01" || err?.original?.code === "42P01") return mapa;
    throw err;
  }

  for (const f of filas) {
    const k = claveDeCitas({ patientId: f.patientId, clientId: f.clientId });
    if (!k) continue;
    (mapa[k] ||= []).push({ scheduledAt: f.scheduledAt });
  }
  return mapa;
}
