import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { gatePortal, resolvePortalContractSession, estadoContrato } from "../../../../../../../lib/citas/portalContract.js";

/**
 * GET — estado del Contrato del Centro para la familia que ha entrado al portal.
 *
 * Es lo PRIMERO que consulta el portal: si falta la firma de quien entra, la
 * pantalla del contrato tapa el resto hasta que firme (con un «lo firmo más
 * tarde» para poder pasar). Mientras falte alguna firma, la documentación del
 * paciente queda cerrada para AMBOS progenitores (decisión del 29/07).
 */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gatePortal(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client, guardian } = await resolvePortalContractSession(request, slug, tenantModels);
    if (response) return response;

    // Sin ficha todavía no hay contrato que firmar: no se le cierra el portal a
    // quien ni siquiera está dado de alta (mismo criterio que documentos).
    if (!client) return ok({ requiereFirma: false, bloqueado: false, motivo: "sin-ficha" });

    const { situacion, firmante, miFirma, documento, bloqueado } = await estadoContrato(tenantModels, client, guardian);

    return ok({
      bloqueado,
      // Hay que ponerle la pantalla del contrato delante: falta SU firma.
      requiereFirma: bloqueado && !!firmante && !miFirma,
      puedeFirmar: !!firmante && !miFirma && !situacion.viaPapel,
      yaFirme: !!miFirma,
      firmadoEl: miFirma?.signedAt ?? null,
      firmanteNombre: firmante?.name ?? null,
      documentoDisponible: !!documento,
      documentoNombre: documento?.fileName ?? null,
      ...situacion,
    });
  } catch (err) {
    return serverError(err);
  }
});
