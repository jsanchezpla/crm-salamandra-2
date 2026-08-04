import { randomUUID } from "node:crypto";
import { withPublicTenant } from "../../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, created, error, serverError } from "../../../../../../../../lib/utils/apiResponse.js";
import { auditar } from "../../../../../../../../lib/utils/auditoria.js";
import { gatePortal, resolvePortalContractSession, estadoContrato } from "../../../../../../../../lib/citas/portalContract.js";
import { bufferFromDataUrl, writeSignature } from "../../../../../../../../lib/clients/signatureStorage.js";
import { validarDatos, validarAceptaciones, camposDe } from "../../../../../../../../lib/clients/contratoFirma.js";
import { datosDeFicha, actualizacionDeFicha, tutorDeclarado } from "../../../../../../../../lib/clients/datosFicha.js";
import { archivarContratoFirmado } from "../../../../../../../../lib/documents/contratoFirmadoArchivo.js";

/**
 * POST — firma web del contrato del centro (sprint Aumenta 2026-07, punto 2.1;
 * ampliado el 2026-08-04 con los datos y los anexos de tunutrilaura).
 *
 * Firma electrónica SIMPLE: se dibuja la firma con el dedo y se guarda la
 * imagen junto a los datos declarados, qué documentos se aceptaron, la fecha,
 * la IP y el navegador. Cada persona firma UNA vez CADA documento (índice único
 * client+guardian+template); con padres separados hacen falta las firmas de los
 * dos para que la documentación se abra.
 *
 * Body:
 *   { signature: "data:image/png;base64,…" }                    ← contrato simple
 *   { templateKey, datos, aceptaciones, signature, firmaSecundaria? }  ← estructurado
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

    const { firmante, miFirma, situacion, siguienteDocumento, estructurado } = await estadoContrato(
      tenantModels,
      client,
      guardian
    );
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

    // ── Contrato estructurado: datos + aceptación documento a documento ──────
    let templateKey = "simple";
    let templateVersion = null;
    let signerData = {};
    let acceptances = [];
    let bufferSecundario = null;
    let plantillaFila = null;

    if (estructurado) {
      if (!siguienteDocumento) return error("No tienes ningún documento pendiente de firmar", 409);

      // El cliente dice qué está firmando: si no coincide con lo que le toca,
      // es una pestaña vieja. Mejor rechazarlo que guardar la firma de un
      // documento contra el clausulado de otro.
      const pedido = typeof body?.templateKey === "string" ? body.templateKey.trim() : siguienteDocumento.key;
      if (pedido !== siguienteDocumento.key) {
        return error("Este documento ya no es el que te toca firmar. Recarga la página, por favor.", 409);
      }

      plantillaFila = await cargarPlantilla(tenantModels, siguienteDocumento.key);
      if (!plantillaFila) return error("El documento ya no está disponible. Recarga la página, por favor.", 409);

      // Lo que hay en la FICHA manda sobre lo que llegue del navegador: esos
      // campos ya no se preguntan en pantalla, así que si llegan es porque
      // alguien los ha puesto a mano en la petición. El DNI que se imprime en
      // el contrato tiene que ser el de la ficha, no el que se teclee aquí.
      const campos = camposDe(plantillaFila);
      const dat = validarDatos(
        plantillaFila,
        { ...body?.datos, ...datosDeFicha(campos, client) },
        client
      );
      if (dat.error) return error(dat.error, 422);

      const acc = validarAceptaciones(plantillaFila, body?.aceptaciones);
      if (acc.error) return error(acc.error, 422);

      if (plantillaFila.secondSignatureLabel && body?.firmaSecundaria) {
        bufferSecundario = bufferFromDataUrl(body.firmaSecundaria);
        if (!bufferSecundario) return error("La segunda firma no ha llegado bien. Vuelve a dibujarla.", 422);
      }

      templateKey = plantillaFila.key;
      templateVersion = plantillaFila.version ?? 1;
      signerData = dat.datos;
      acceptances = acc.aceptaciones;
    }

    const signaturePath = await writeSignature(tenant.slug, client.id, buffer);
    const secondSignaturePath = bufferSecundario
      ? await writeSignature(tenant.slug, client.id, bufferSecundario)
      : null;

    // El nombre que declaró manda sobre el de la ficha: es el que va en el
    // documento. Sin plantilla estructurada no hay declaración y vale el de
    // `guardians`, como hasta ahora.
    const nombreDeclarado = typeof signerData.nombre === "string" ? signerData.nombre.trim() : "";

    let fila;
    try {
      fila = await ContractSignature.create({
        clientId: client.id,
        guardianId: firmante.id,
        templateKey,
        templateVersion,
        // Foto del nombre al firmar: `guardians` es editable después.
        signerName: (nombreDeclarado || String(firmante.name || "")).slice(0, 200) || "Firmante",
        signerData,
        acceptances,
        signaturePath,
        secondSignaturePath,
        signedAt: new Date(),
        ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64) || null,
        userAgent: (request.headers.get("user-agent") || "").slice(0, 255) || null,
      });
    } catch (err) {
      // Índice único client+guardian+template: dos pestañas abiertas, doble
      // toque… No es un error para quien firma, ya está firmado.
      if (err?.name === "SequelizeUniqueConstraintError") {
        const estado = await estadoContrato(tenantModels, client, guardian);
        return ok({ yaFirmado: true, firmadoEl: estado.miFirma?.signedAt ?? null, ...estado.situacion });
      }
      throw err;
    }

    // Lo declarado que la ficha aún no tenía se guarda EN LA FICHA (04/08/2026):
    // el DNI de una menor «si dispone de él», el tutor del consentimiento
    // parental. Solo huecos, nunca pisando lo que el centro ya tiene puesto.
    if (plantillaFila) {
      const campos = camposDe(plantillaFila);
      const update = actualizacionDeFicha(campos, client, signerData) ?? {};

      const tutor = tutorDeclarado(campos, client, signerData, randomUUID());
      if (tutor) update.guardians = [...(Array.isArray(client.guardians) ? client.guardians : []), tutor];

      // Best-effort: la firma ya está guardada y es válida. Si esto fallara,
      // perder el volcado a la ficha es mucho menos grave que devolver un error
      // a quien acaba de firmar y hacerle creer que no ha firmado.
      if (Object.keys(update).length) await client.update(update).catch(() => {});
    }

    // El PDF va DESPUÉS de guardar la firma y no dentro de ella: si falla al
    // escribirlo, la firma sigue siendo válida (los datos, el clausulado y la
    // traza están en la fila). Se puede regenerar; no se puede volver a pedir.
    let documentoFirmado = null;
    if (plantillaFila) {
      documentoFirmado = await archivarContratoFirmado({
        tenantModels,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        brand: tenant.settings?.brand,
        plantilla: plantillaFila,
        firma: fila,
        imagenFirma: buffer,
        imagenSegunda: bufferSecundario,
        client,
      }).catch(() => null);
      if (documentoFirmado) await fila.update({ documentId: documentoFirmado.id }).catch(() => {});
    }

    const despues = await estadoContrato(tenantModels, client, guardian);

    await auditar({
      tenantId: tenant.id,
      userId: null, // el portal no es un usuario del CRM
      ip: request.headers.get("x-forwarded-for") ?? null,
      action: "client.contract.signed",
      entity: "Client",
      entityId: client.id,
      // Nombre y datos declarados NO: la auditoría vive en master y la comparten
      // todos los clientes. Con saber QUÉ documento se firmó, cuántas firmas hay
      // y si ya está completo sobra.
      after: {
        documento: templateKey,
        firmas: despues.situacion.firmas,
        de: despues.situacion.firmantes,
        completo: despues.situacion.contratoCompleto,
      },
    });

    return created({
      firmadoEl: fila.signedAt,
      bloqueado: despues.bloqueado,
      // Con el consentimiento parental detrás del contrato, aquí todavía queda
      // trabajo: la pantalla tiene que saber que no ha terminado.
      quedanDocumentos: despues.documentosPendientes ?? 0,
      plantilla: despues.siguienteDocumento ?? null,
      documentoFirmadoId: documentoFirmado?.id ?? null,
      ...despues.situacion,
    });
  } catch (err) {
    return serverError(err);
  }
});

/** La fila real de la plantilla (el estado solo devuelve la vista pública). */
async function cargarPlantilla(tenantModels, key) {
  const { ContractTemplate } = tenantModels;
  if (!ContractTemplate) return null;
  return ContractTemplate.findOne({ where: { key, active: true } });
}
