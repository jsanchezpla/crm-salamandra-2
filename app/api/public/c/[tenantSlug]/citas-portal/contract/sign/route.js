import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, created, error, serverError } from "../../../../../../../../lib/utils/apiResponse.js";
import { auditar } from "../../../../../../../../lib/utils/auditoria.js";
import { gatePortal, resolvePortalContractSession, estadoContrato } from "../../../../../../../../lib/citas/portalContract.js";
import { bufferFromDataUrl, writeSignature } from "../../../../../../../../lib/clients/signatureStorage.js";

/**
 * POST — firma web del Contrato del Centro (sprint Aumenta 2026-07, punto 2.1).
 *
 * Firma electrónica SIMPLE: el tutor dibuja su firma con el dedo y se guarda la
 * imagen junto a fecha, IP y navegador. Cada tutor firma UNA vez (índice único
 * client+guardian); con padres separados hacen falta las dos firmas para que la
 * documentación se abra.
 *
 * Body: { signature: "data:image/png;base64,…" }
 */
export const POST = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gatePortal(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client, guardian } = await resolvePortalContractSession(request, slug, tenantModels);
    if (response) return response;
    if (!client) return error("Todavía no tenemos tu ficha. Escríbenos y lo revisamos.", 409);

    const { ContractSignature } = tenantModels;
    if (!ContractSignature) return error("La firma no está disponible en este centro", 503);

    const { firmante, miFirma, situacion } = await estadoContrato(tenantModels, client, guardian);
    if (!firmante) {
      // Entra con un correo que no es el de ningún firmante (p. ej. el de la
      // ficha cuando los que firman son los dos tutores). Decirlo, no fallar.
      return error("Este contrato lo tienen que firmar los tutores de la ficha", 403);
    }
    if (miFirma) return ok({ yaFirmado: true, firmadoEl: miFirma.signedAt, ...situacion });
    if (situacion.viaPapel) return ok({ yaFirmado: true, viaPapel: true, ...situacion });

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    const buffer = bufferFromDataUrl(body?.signature);
    if (!buffer) return error("La firma no ha llegado bien. Vuelve a dibujarla, por favor.", 422);

    const signaturePath = await writeSignature(tenant.slug, client.id, buffer);

    let fila;
    try {
      fila = await ContractSignature.create({
        clientId: client.id,
        guardianId: firmante.id,
        // Foto del nombre al firmar: `guardians` es editable después.
        signerName: String(firmante.name || "").slice(0, 200) || "Firmante",
        signaturePath,
        signedAt: new Date(),
        ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64) || null,
        userAgent: (request.headers.get("user-agent") || "").slice(0, 255) || null,
      });
    } catch (err) {
      // Índice único client+guardian: dos pestañas abiertas, doble toque… No es
      // un error para quien firma, ya está firmado.
      if (err?.name === "SequelizeUniqueConstraintError") {
        const estado = await estadoContrato(tenantModels, client, guardian);
        return ok({ yaFirmado: true, firmadoEl: estado.miFirma?.signedAt ?? null, ...estado.situacion });
      }
      throw err;
    }

    const despues = await estadoContrato(tenantModels, client, guardian);

    await auditar({
      tenantId: tenant.id,
      userId: null, // el portal no es un usuario del CRM
      ip: request.headers.get("x-forwarded-for") ?? null,
      action: "client.contract.signed",
      entity: "Client",
      entityId: client.id,
      // Nombre no: la auditoría vive en master y la comparten todos los
      // clientes. Con saber cuántas firmas hay y si ya está completo sobra.
      after: { firmas: despues.situacion.firmas, de: despues.situacion.firmantes, completo: despues.situacion.contratoCompleto },
    });

    return created({
      firmadoEl: fila.signedAt,
      bloqueado: despues.bloqueado,
      ...despues.situacion,
    });
  } catch (err) {
    return serverError(err);
  }
});
