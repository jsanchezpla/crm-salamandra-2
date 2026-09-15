import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../../../lib/billing/audit.js";
import { planBajaDePaciente } from "../../../../../../lib/billing/bajaDePaciente.js";
import { sincronizarCobrosDelTramo } from "../../../../../../lib/billing/cobrosDelTramo.js";

/**
 * POST /api/billing/cuotas/[id]/baja-paciente — da de baja a UN paciente de una
 * cuota que es de toda la familia (15/09/2026, AV-0145 de Aumenta).
 *
 * Cuerpo: { patientId, quitar: [posiciones de concepto], quedaPatientId,
 * fecha, importeQueda }. La regla —qué se queda, qué sale y cuándo nace una
 * cuota aparte— vive en `lib/billing/bajaDePaciente.js`; aquí se comprueba
 * contra la base, se escribe en una transacción y se ponen al día los cobros
 * pendientes de las dos cuotas, igual que al editar.
 */
export const POST = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cuota, Patient, Payment } = tenantModels;
    if (!Patient) return error("Este centro no tiene pacientes", 422);
    const { id } = await params;

    const cuota = await Cuota.findByPk(id);
    if (!cuota) return notFound("Cuota no encontrada");

    const body = await request.json();
    const familia = await Patient.findAll({ where: { clientId: cuota.clientId }, attributes: ["id"], raw: true });
    const pagados = await Payment.findAll({
      where: { cuotaId: cuota.id, status: "completed" },
      attributes: ["periodMonth"],
    });

    const plan = planBajaDePaciente(cuota.toJSON(), body, {
      familia: familia.map((p) => p.id),
      mesesPagados: pagados.map((p) => String(p.periodMonth ?? "")).filter(Boolean),
    });
    if (plan.problema) return error(plan.problema, 422);

    const antes = resumen(cuota);
    let nueva = null;
    await Cuota.sequelize.transaction(async (transaction) => {
      // Directo y no por `limpiarCuota`: quitaría la línea repetida de dos
      // hermanos con la misma terapia (ver la cabecera de la regla).
      await cuota.update(plan.restante, { transaction });
      if (plan.separada) {
        nueva = await Cuota.create(
          { ...plan.separada, notes: `Separada de la cuota de la familia al dar de baja a este paciente (${plan.separada.endDate}).` },
          { transaction }
        );
      }
    });

    await logBillingAudit({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "cuota.updated",
      entity: "Cuota",
      entityId: cuota.id,
      before: antes,
      after: { ...resumen(cuota), bajaDePaciente: String(body.patientId), fecha: plan.separada?.endDate ?? String(body.fecha ?? "") },
    });
    if (nueva) {
      await logBillingAudit({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "cuota.ended",
        entity: "Cuota",
        entityId: nueva.id,
        before: null,
        after: { ...resumen(nueva), separadaDe: cuota.id },
      });
    }

    const cobros = await sincronizarCobrosDelTramo({
      tenantModels,
      cuotaIds: [cuota.id, ...(nueva ? [nueva.id] : [])],
    });

    return ok({ cuota: cuota.toJSON(), separada: nueva ? nueva.toJSON() : null, cobros });
  } catch (err) {
    return serverError(err);
  }
});

function resumen(c) {
  return {
    clienteId: c.clientId ?? null,
    pacienteId: c.patientId ?? null,
    importe: c.amount != null ? String(c.amount) : null,
    conceptos: Array.isArray(c.conceptIds) ? c.conceptIds.length : 0,
    desde: c.startDate ?? null,
    hasta: c.endDate ?? null,
    activa: !!c.active,
  };
}
