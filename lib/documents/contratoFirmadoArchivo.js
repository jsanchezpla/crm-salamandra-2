import { randomUUID } from "node:crypto";
import { saveDocumentFile, deleteDocumentFile } from "./documentStorage.js";
import { buildContratoFirmadoPdf, contratoPdfFilename } from "./contratoFirmadoPdf.js";

/**
 * contratoFirmadoArchivo — el PDF firmado entra en el archivo del CRM
 * (sprint tunutrilaura 2026-08-04).
 *
 * (Fichero nuevo en /lib, regla #2: `contratoServicios.js` sube el contrato en
 * blanco del centro —uno por tenant, `contract_template`— y esto guarda el
 * firmado de UNA persona. Mismo almacén, dos cosas distintas: si se mezclaran,
 * cada firma reemplazaría a la plantilla del centro.)
 *
 * `source` es 'contrato_firmado' y NO 'contrato' a propósito. 'contrato' es el
 * PDF que el equipo sube a la ficha cuando alguien firmó en PAPEL, y el portal
 * lo lee como «esta familia ya ha firmado, no le pidas nada». Archivar aquí con
 * ese source haría que firmar el contrato cancelara el consentimiento parental
 * que viene detrás.
 *
 * Se marca `clientVisible` porque el documento ES de quien lo firma: tiene
 * derecho a su copia y la tiene en «Mis documentos» sin pedírsela a nadie. Eso
 * es justo lo que el HTML que mandó Laura no resolvía, que acababa en «recuerda
 * enviárselo por WhatsApp a tu nutricionista».
 */

export const SOURCE_CONTRATO_FIRMADO = "contrato_firmado";

/**
 * Genera el PDF y lo guarda como fila de `documents` de la ficha.
 * Devuelve la fila creada, o `null` si el tenant no tiene archivo documental.
 */
export async function archivarContratoFirmado({
  tenantModels,
  tenantSlug,
  tenantName,
  brand,
  plantilla,
  firma,
  imagenFirma,
  imagenSegunda = null,
  client,
}) {
  const { Document } = tenantModels;
  if (!Document) return null;

  const buffer = await buildContratoFirmadoPdf({
    plantilla,
    firma,
    imagenFirma,
    imagenSegunda,
    tenantName,
    brand,
  });

  const documentId = randomUUID();
  const storagePath = await saveDocumentFile(tenantSlug, "shared", documentId, buffer, "pdf");

  try {
    return await Document.create({
      id: documentId,
      folderId: null,
      visibility: "shared",
      ownerUserId: null, // lo genera el portal, no un usuario del CRM
      fileName: contratoPdfFilename(plantilla?.title, firma?.signerName, firma?.signedAt),
      storagePath,
      fileSize: buffer.length,
      mimeType: "application/pdf",
      clientId: client?.id ?? null,
      patientId: null,
      source: SOURCE_CONTRATO_FIRMADO,
      clientVisible: true,
      uploadedByClient: false,
    });
  } catch (err) {
    // Sin fila en BD el fichero no lo encontraría nadie: fuera del disco.
    await deleteDocumentFile(tenantSlug, storagePath).catch(() => {});
    throw err;
  }
}
