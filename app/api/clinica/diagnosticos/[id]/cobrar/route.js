import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, errorConDatos, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { puedeDarBonos } from "../../../../../../lib/citas/quienDaBonos.js";
import { clientIdOfPatient } from "../../../../../../lib/clinica/patientClient.js";
import { cobroPendienteDeBono } from "../../../../../../lib/billing/cobroDelBono.js";
import { cobroDeLaEntrevista, cobroDelProducto } from "../../../../../../lib/clinica/diagnostico.js";
import { descuentoDeLaEntrevista } from "../../../../../../lib/clinica/adoptarEnDiagnostico.js";
import { UUID_RE, textoEnFacturaDe, centimosDe } from "../../../../../../lib/clinica/diagnosticoFila.js";
import {
  tablaAusente,
  catalogoDelCentro,
  conceptoDelExpediente,
  productoDelExpediente,
  cobrosDeExpedientes,
  cobroDeEntrevistaEntre,
  resumenDeCobro,
  filasDe,
} from "../../../../../../lib/clinica/diagnosticoDb.js";
import {
  FASE_ENTREVISTA,
  FASE_PRODUCTO,
  MOTIVO_SIN_PERMISO_COBRO,
  cobroDeProductoEntre,
  esFase,
  fasesDeCobro,
  importeDeLaEntrevista,
} from "../../../../../../lib/clinica/cobrosDelDiagnostico.js";

/**
 * POST /api/clinica/diagnosticos/[id]/cobrar — mandar a cobro UNA FASE del
 * diagnóstico desde su expediente (18/09/2026, Rodrigo).
 *
 * `{ fase: "entrevista" | "producto" }` y nace un cobro PENDIENTE en Cobros:
 *
 *   · `entrevista` — los 50 € de la entrevista inicial (o el concepto
 *     «Entrevista Inicial» del centro). Queda atado en
 *     `diagnosticos.entrevista_payment_id`, que es lo que hace que el producto
 *     valga después 300 € / 600 € en vez de 350 / 650 (`cobroDelProducto` lo
 *     descuenta). No toca el ESTADO del expediente: cobrar la entrevista no es
 *     decidir si la familia sigue, y hasta hoy la única forma de apuntarla era
 *     «Parar», que sí decidía.
 *   · `producto` — lo que queda del producto, para el expediente que ya sigue
 *     (`en_curso`, con su bono). Normalmente nace solo al «Seguir»; este
 *     camino es para el que no lo tiene: los que venían de antes del
 *     submódulo, los que se abrieron sin Facturación o aquel al que alguien le
 *     borró el cobro.
 *
 * Qué se puede y qué no lo decide `fasesDeCobro` (`cobrosDelDiagnostico.js`),
 * la MISMA función con la que la ficha pinta o apaga los botones: aquí se
 * vuelve a comprobar con los datos de la base, nunca con lo que diga el
 * navegador.
 *
 * Solo dirección o quien lleve Facturación (`puedeDarBonos`): apuntar una
 * deuda es la misma responsabilidad que dar un bono.
 *
 * Nunca crea dos: si la fase ya tiene su cobro —aunque sea de otro día— se
 * devuelve 409 con el que hay. Un diagnóstico cobrado dos veces solo se ve
 * cuando la familia se queja.
 */
export const POST = withTenant(async (request, routeCtx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();
  const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });
  if (!puedeDecidir) return forbidden(MOTIVO_SIN_PERMISO_COBRO);

  try {
    const { Diagnostico, Payment } = tenantModels;
    const { id } = (await routeCtx?.params) ?? {};
    if (!Diagnostico || !UUID_RE.test(String(id ?? ""))) return notFound("Ese diagnóstico no existe");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const fase = String(body?.fase ?? "").trim();
    if (!esFase(fase)) return error("fase inválida: tiene que ser «entrevista» o «producto»", 422);

    const expediente = await Diagnostico.findByPk(id);
    if (!expediente) return notFound("Ese diagnóstico no existe");

    const catalogo = await catalogoDelCentro(tenantModels);
    const conceptoEntrevista = catalogo.conceptoEntrevista;
    const datosEntrevista = cobroDeLaEntrevista(conceptoEntrevista);
    const cobros = (await cobrosDeExpedientes(tenantModels, [expediente], { textoEntrevista: datosEntrevista.texto })).get(String(expediente.id)) ?? [];
    const cobroEntrevista = cobroDeEntrevistaEntre(expediente, cobros);
    const cobroProducto = cobroDeProductoEntre(expediente, cobros);

    const producto = productoDelExpediente({ tenant, expediente });
    const concepto = conceptoDelExpediente({ tenant, expediente, catalogo });
    const delProducto = cobroDelProducto(producto, concepto, { descuentoEuros: descuentoDeLaEntrevista(cobroEntrevista) });

    const fases = fasesDeCobro({
      expediente,
      cobroEntrevista,
      cobroProducto,
      importeEntrevista: importeDeLaEntrevista(datosEntrevista),
      cobroDelProducto: delProducto,
      puedeDecidir,
    });
    const laFase = fase === FASE_ENTREVISTA ? fases.entrevista : fases.producto;
    if (!laFase.puedeGenerar) {
      return errorConDatos(laFase.motivo, laFase.estadoCobro ? 409 : 422, {
        status: expediente.status,
        cobro: resumenDeCobro(fase === FASE_ENTREVISTA ? cobroEntrevista : cobroProducto),
      });
    }

    // A quién se le cobra: la familia del expediente o la de la ficha del
    // paciente. Sin ella no hay deuda que apuntar (ni a quién facturarle).
    const clientId = expediente.clientId ?? (await clientIdOfPatient(tenantModels, expediente.patientId));
    if (!Payment) return error("Este centro no tiene Facturación: no hay dónde apuntar el cobro", 422);
    if (!clientId) return error("El paciente no tiene ficha de familia: sin ella no hay a quién cobrarle", 422);

    let pago = null;
    const avisos = [];

    if (fase === FASE_ENTREVISTA) {
      const fila = {
        invoiceId: null,
        clientId,
        patientId: expediente.patientId,
        conceptId: datosEntrevista.conceptId,
        // No es de un mes: no entra en «Facturar el mes» ni en el bloqueo del portal.
        periodMonth: null,
        cuotaId: null,
        packId: null,
        amount: laFase.importe,
        paidAt: new Date(),
        // Sin decidir: mandar a cobro no es cobrar.
        method: null,
        status: "pending",
        notes: datosEntrevista.texto,
        invoiceText: textoEnFacturaDe(conceptoEntrevista),
      };
      try {
        await Diagnostico.sequelize.transaction(async (t) => {
          pago = await Payment.create(fila, { transaction: t });
          // Atado por id: es lo que permite descontarlo del producto y
          // encontrarlo sin adivinar por la nota.
          await expediente.update({ clientId, entrevistaPaymentId: pago.id }, { transaction: t });
        });
      } catch (err) {
        if (!tablaAusente(err)) throw err;
        return error("Este centro no tiene la tabla de cobros: no hay dónde apuntarlo", 422);
      }
      if (cobroProducto) {
        avisos.push(
          "El diagnóstico ya tenía su cobro apuntado con la entrevista dentro: ahora hay dos filas en Cobros. Ajusta la del diagnóstico si quieres cobrarlas por separado."
        );
      }
    } else {
      // El producto sale por la MISMA puerta que el cobro del bono
      // (`cobroPendienteDeBono`), para que se llame y se facture igual que el
      // que nace al «Seguir». Céntimos ahí, euros en `payments`: la frontera
      // es suya.
      const fila = cobroPendienteDeBono({
        amount: centimosDe(laFase.importe),
        clientId,
        patientId: expediente.patientId,
        packId: expediente.packId,
        conceptId: delProducto.conceptId,
        texto: delProducto.texto,
        invoiceText: textoEnFacturaDe(concepto),
      });
      if (!fila) return error("No hay precio para este producto: ponlo en su concepto del catálogo", 422);
      try {
        pago = await Payment.create(fila);
      } catch (err) {
        if (!tablaAusente(err)) throw err;
        return error("Este centro no tiene la tabla de cobros: no hay dónde apuntarlo", 422);
      }
      if (!expediente.clientId || (delProducto.conceptId && !expediente.conceptId)) {
        await expediente.update({
          clientId,
          ...(delProducto.conceptId && !expediente.conceptId ? { conceptId: delProducto.conceptId } : {}),
        });
      }
      if (delProducto.descuentoEuros > 0) {
        avisos.push(`Descontada la entrevista inicial de ${delProducto.descuentoEuros} €.`);
      }
    }

    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "diagnostico.cobrado",
      entity: "Diagnostico",
      entityId: expediente.id,
      after: {
        fase,
        cobroId: pago?.id ?? null,
        importe: laFase.importe !== null ? String(laFase.importe) : null,
        status: expediente.status,
        packId: expediente.packId ?? null,
      },
    });

    const [fila] = await filasDe({ tenantModels, tenant, expedientes: [expediente], puedeDecidir, catalogo });
    return ok({
      expediente: fila,
      fase,
      cobro: { ...resumenDeCobro(pago), texto: pago?.notes ?? null },
      avisos,
    });
  } catch (err) {
    if (tablaAusente(err)) return notFound("Ese diagnóstico no existe");
    return serverError(err);
  }
});
