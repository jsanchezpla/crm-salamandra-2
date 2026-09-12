import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, errorConDatos, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../../lib/utils/auditoria.js";
import { puedeDarBonos } from "../../../../../../lib/citas/quienDaBonos.js";
import { clientIdOfPatient } from "../../../../../../lib/clinica/patientClient.js";
import { puedePasarA, cobroDeLaEntrevista, ROTULO_ESTADO } from "../../../../../../lib/clinica/diagnostico.js";
import { UUID_RE, MOTIVO_SIN_PERMISO_DIAGNOSTICO, textoEnFacturaDe } from "../../../../../../lib/clinica/diagnosticoFila.js";
import { tablaAusente, catalogoDelCentro, filasDe } from "../../../../../../lib/clinica/diagnosticoDb.js";

/**
 * POST /api/clinica/diagnosticos/[id]/parar — la familia NO sigue tras la
 * entrevista inicial (12/09/2026).
 *
 * Nace el cobro PENDIENTE de la entrevista —el concepto «Entrevista Inicial»
 * del centro si el tipo de cita marcado como valoración inicial lo lleva; si
 * no, 50 € con el texto de fábrica (`cobroDeLaEntrevista`)— y el expediente
 * pasa a `no_continua`. Las dos cosas en la MISMA transacción: un expediente
 * parado sin su deuda, o una deuda de un expediente que sigue abierto, no se
 * arreglan desde ninguna pantalla.
 *
 * Solo dirección o quien lleve Facturación (`puedeDarBonos`): parar es apuntar
 * un dinero que se debe, la misma responsabilidad que dar un bono.
 *
 * Un centro sin Facturación (sin tabla `payments`) o un paciente sin ficha de
 * familia paran igual, sin cobro, y la respuesta lo dice en `avisos`.
 *
 * ── EL COBRO QUEDA ATADO, Y NO NACE DOS VECES (12/09/2026, 2.ª entrega) ────
 * El cobro que nace se apunta en `diagnosticos.entrevista_payment_id`, en la
 * misma transacción: es lo que permite descontarlo del producto si la familia
 * cambia de idea y sigue, y encontrarlo sin adivinar por la nota. Y si el
 * expediente YA tiene su cobro de entrevista —lo adoptó al abrirse desde una
 * entrevista de terapia ya cobrada—, parar no crea otro: solo cambia el estado
 * y avisa «La entrevista ya estaba cobrada (50 €)».
 */

/** «50», «47,50». */
const euros = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
};

export const POST = withTenant(async (request, routeCtx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();
  const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });
  if (!puedeDecidir) return forbidden(MOTIVO_SIN_PERMISO_DIAGNOSTICO);

  try {
    const { Diagnostico, Payment } = tenantModels;
    const { id } = (await routeCtx?.params) ?? {};
    if (!Diagnostico || !UUID_RE.test(String(id ?? ""))) return notFound("Ese diagnóstico no existe");

    const expediente = await Diagnostico.findByPk(id);
    if (!expediente) return notFound("Ese diagnóstico no existe");
    if (!puedePasarA(expediente.status, "no_continua")) {
      return errorConDatos(
        `No se puede parar un diagnóstico que está en «${ROTULO_ESTADO[expediente.status] ?? expediente.status}»`,
        409,
        { status: expediente.status }
      );
    }

    const catalogo = await catalogoDelCentro(tenantModels);
    const concepto = catalogo.conceptoEntrevista;
    const cobro = cobroDeLaEntrevista(concepto);
    const clientId = expediente.clientId ?? (await clientIdOfPatient(tenantModels, expediente.patientId));

    const avisos = [];
    let pago = null;
    let yaExistia = false;

    const filaDeCobro = () => ({
      invoiceId: null,
      clientId,
      patientId: expediente.patientId,
      conceptId: cobro.conceptId,
      // No es de un mes: no entra en «Facturar el mes» ni en el bloqueo del portal.
      periodMonth: null,
      cuotaId: null,
      packId: null,
      amount: cobro.importeEuros,
      paidAt: new Date(),
      // Sin decidir: dar por debida la entrevista no es cobrarla.
      method: null,
      status: "pending",
      notes: cobro.texto,
      invoiceText: textoEnFacturaDe(concepto),
    });

    if (expediente.entrevistaPaymentId) {
      // Ya tiene su cobro de entrevista (adoptado al abrirse): no nace otro.
      yaExistia = true;
      if (Payment) {
        try {
          pago = await Payment.findByPk(expediente.entrevistaPaymentId, {
            attributes: ["id", "amount", "status", "refundedAt", "notes"],
          });
        } catch (err) {
          if (!tablaAusente(err)) throw err;
        }
      }
      if (pago) {
        const importe = euros(pago.amount);
        avisos.push(
          pago.status === "completed" && !pago.refundedAt
            ? `La entrevista ya estaba cobrada (${importe} €)`
            : `La entrevista ya tenía su cobro apuntado (${importe} €, ${pago.status === "pending" ? "pendiente" : pago.status}): no se crea otro.`
        );
      } else {
        avisos.push("La entrevista ya tenía su cobro apuntado: no se crea otro.");
      }
      await expediente.update({ status: "no_continua", ...(clientId ? { clientId } : {}) });
    } else if (!Payment || !clientId) {
      avisos.push(
        !Payment
          ? "Este centro no tiene Facturación: el diagnóstico queda parado sin cobro."
          : "El paciente no tiene ficha de familia: el diagnóstico queda parado sin cobro (no hay a quién cobrarle)."
      );
      await expediente.update({ status: "no_continua" });
    } else {
      try {
        await Diagnostico.sequelize.transaction(async (t) => {
          pago = await Payment.create(filaDeCobro(), { transaction: t });
          // El cobro queda atado por id: es lo que permite descontarlo y
          // encontrarlo sin adivinar por la nota.
          await expediente.update({ status: "no_continua", clientId, entrevistaPaymentId: pago.id }, { transaction: t });
        });
      } catch (err) {
        // Sin tabla de cobros (la transacción entera se deshace): se para
        // igual, sin cobro, y se dice.
        if (!tablaAusente(err)) throw err;
        avisos.push("Este centro no tiene la tabla de cobros: el diagnóstico queda parado sin cobro.");
        await expediente.update({ status: "no_continua" });
      }
    }

    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "diagnostico.parado",
      entity: "Diagnostico",
      entityId: expediente.id,
      after: {
        ...resumen(expediente, ["id", "patientId", "clientId", "productoKey", "status"]),
        cobroId: pago?.id ?? null,
        importe: pago ? String(yaExistia ? Number(pago.amount) : cobro.importeEuros) : null,
        yaExistia,
      },
    });

    const [fila] = await filasDe({ tenantModels, tenant, expedientes: [expediente], puedeDecidir, catalogo });
    return ok({
      expediente: fila,
      cobro: pago
        ? yaExistia
          ? { id: pago.id, importe: Math.round(Number(pago.amount) * 100) / 100, status: pago.status ?? null, texto: pago.notes ?? null, yaExistia: true }
          : { id: pago.id, importe: cobro.importeEuros, status: "pending", texto: cobro.texto, yaExistia: false }
        : null,
      avisos,
    });
  } catch (err) {
    if (tablaAusente(err)) return notFound("Ese diagnóstico no existe");
    return serverError(err);
  }
});
