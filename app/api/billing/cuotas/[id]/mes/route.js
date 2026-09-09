import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logBillingAudit, datosPeticion } from "../../../../../../lib/billing/audit.js";
import { mesValido, mesLegible } from "../../../../../../lib/billing/cuotas.js";
import { sincronizarCobroDelMes } from "../../../../../../lib/billing/cobroDeCuota.js";

/**
 * POST /api/billing/cuotas/[id]/mes { mes: 'AAAA-MM' } — el cobro de UN mes de
 * UNA cuota (09/09/2026, petición de Aumenta: «que se puedan crear, modificar o
 * eliminar cuotas de todos los meses del curso escolar»).
 *
 * Hasta hoy los meses se generaban en lote («Generar el mes», todas las cuotas
 * a la vez) o no se generaban. Para repasar el curso de UN paciente eso no
 * vale: el mes que falta es el de octubre de esa familia, y lanzar el lote
 * entero de octubre para arreglar una fila es desproporcionado.
 *
 * Es el mismo motor que usan el alta y la edición de una cuota
 * (`sincronizarCobroDelMes`), así que hace lo mismo que ellas: crea el cobro si
 * falta, lo pone al día si la cuota cambió y lo RETIRA si la cuota ya no toca
 * ese mes — y nunca toca lo que ya es dinero o papel (cobrado, facturado, con
 * Stripe o casado con el banco), que responde `intocable` con su motivo.
 *
 * Modificar el importe de un mes concreto NO es esto: eso es editar el cobro
 * (`PATCH /api/billing/payments/[id]`), donde vive el rastro de quién lo tocó.
 */
export const POST = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("billing")) return forbidden("Módulo billing no activo");
    const { Cuota } = tenantModels;
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const mes = body?.mes;
    if (!mesValido(mes)) return error("El mes debe ser 'AAAA-MM'", 422);

    const cuota = await Cuota.findByPk(id, { attributes: ["id", "clientId"] });
    if (!cuota) return notFound("Cuota no encontrada");

    const resultado = await sincronizarCobroDelMes({ tenantModels, cuotaId: id, mes });

    // Solo se apunta cuando ha pasado algo: un «ya estaba al día» no es un
    // movimiento de dinero, y el rastro se lee mejor sin ruido.
    if (["creado", "actualizado", "retirado"].includes(resultado.estado)) {
      await logBillingAudit({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "cuota.generated",
        entity: "Payment",
        entityId: resultado.cobroId ?? null,
        before: null,
        after: {
          mes,
          cuota: id,
          resultado: resultado.estado,
          importe: resultado.importe != null ? String(resultado.importe) : null,
          estado: "pending",
        },
      });
    }

    return ok({ ...resultado, mes, mesLegible: mesLegible(mes) });
  } catch (err) {
    return serverError(err);
  }
});
