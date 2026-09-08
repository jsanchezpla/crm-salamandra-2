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
 * De cada cita van la FECHA y el CONCEPTO que la cubre (08/09/2026): con dos
 * terapias en la misma cuota, las sesiones de una no pueden pagar la parte de
 * la otra, y quien reparte —`citasDelConcepto`— necesita saber de cuál es
 * cada sesión.
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
  /*
   * LA FAMILIA SON TAMBIÉN SUS HIJOS (08/09/2026, Rosa). Antes esto pedía
   * `patientId: null` —las citas de la ficha, sin paciente— y en un centro
   * como Aumenta esas son 19 de 1.296: una cuota «de toda la familia» se
   * quedaba sin una sola sesión que contar y volvía a prorratear por días,
   * que es justo de lo que venía la queja.
   */
  if (familias.length) quien.push({ clientId: { [Op.in]: familias } });

  let filas = [];
  try {
    filas = await Booking.findAll({
      attributes: ["patientId", "clientId", "scheduledAt", "cobroConceptId"],
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

  // La misma cita puede caer en las dos claves —la del niño y la de su
  // familia— cuando se han pedido las dos: son dos cuotas distintas y cada
  // una cuenta lo suyo.
  const dePaciente = new Set(pacientes);
  const deFamilia = new Set(familias);
  for (const f of filas) {
    const cita = { scheduledAt: f.scheduledAt, conceptId: f.cobroConceptId ?? null };
    if (f.patientId && dePaciente.has(String(f.patientId))) (mapa[`p:${f.patientId}`] ||= []).push(cita);
    if (f.clientId && deFamilia.has(String(f.clientId))) (mapa[`c:${f.clientId}`] ||= []).push(cita);
  }
  return mapa;
}
