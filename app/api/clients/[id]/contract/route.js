import { randomUUID } from "node:crypto";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound, noContent, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import {
  MAX_FILE_SIZE_BYTES,
  TENANT_QUOTA_BYTES,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
  validateMimeMagicBytes,
} from "../../../../../lib/documents/documentStorage.js";
import { CONTRACT_SOURCE, findClientContract, serializeContract, signatureStatus } from "../../../../../lib/clients/clientContract.js";

/**
 * /api/clients/[id]/contract — Contrato del Centro de una FAMILIA
 * (sprint Aumenta 2026-07, punto 1.1).
 *
 *   GET    → contrato subido (o null) + estado de firma de los tutores
 *   POST   → sube/reemplaza el PDF firmado (multipart, campo "file")
 *   DELETE → lo elimina
 *
 * ANTES VIVÍA EN EL PACIENTE (`patients.contract_file`). Se movió porque quien
 * firma y quien paga son los padres: con dos hermanos en el centro había dos
 * contratos para una sola familia. El PDF se guarda como documento del archivo
 * central (source='contrato') y el cliente apunta a él con contract_document_id.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PDF_MIME = "application/pdf";

function gate(ctx) {
  return ctx.hasModule("clients") ? null : forbidden("Módulo clients no activo");
}

// `documents` (el archivo central) no existe en todos los schemas: solo en los
// tenants que pasaron la migración del módulo Documentos. Sin esta comprobación,
// la ficha de cliente de un tenant sin esa tabla se rompía entera con un 500 por
// una sección opcional (mismo patrón que el GET de la ficha con `interactions`).
function esTablaAusente(err) {
  return err?.parent?.code === "42P01" || err?.original?.code === "42P01";
}

async function estadoFirma(ctx, cliente, contratoEnPapel = false) {
  const { ContractSignature } = ctx.tenantModels;
  // La tabla puede no existir en tenants que aún no pasaron la migración del
  // sprint: sin firmas, el contrato se sigue viendo (mismo patrón defensivo que
  // el GET de la ficha con `interactions`).
  let firmas = [];
  if (ContractSignature) {
    try {
      firmas = await ContractSignature.findAll({
        where: { clientId: cliente.id },
        attributes: ["guardianId", "signerName", "signedAt"],
      });
    } catch (err) {
      if (err?.parent?.code !== "42P01" && err?.original?.code !== "42P01") throw err;
    }
  }
  return signatureStatus(cliente, firmas, contratoEnPapel);
}

export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { Client, Document } = ctx.tenantModels;
    const cliente = await Client.findByPk(id, { attributes: ["id", "name", "guardians", "contractDocumentId"] });
    if (!cliente) return notFound("Cliente no encontrado");

    let doc = null;
    let archivoDisponible = true;
    try {
      doc = await findClientContract(Document, cliente);
    } catch (err) {
      if (!esTablaAusente(err)) throw err;
      archivoDisponible = false;
    }
    return ok({
      clientId: id,
      // false = este tenant aún no tiene el archivo central (tabla `documents`),
      // así que la ficha esconde la sección en vez de ofrecer una subida que
      // fallaría.
      archivoDisponible,
      contract: serializeContract(doc),
      ...(await estadoFirma(ctx, cliente, !!doc)),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);
    const ownerUserId = request.headers.get("x-user-id");
    if (!ownerUserId) return error("No autorizado", 401);

    const { Client, Document } = ctx.tenantModels;
    const cliente = await Client.findByPk(id);
    if (!cliente) return notFound("Cliente no encontrado");

    // Tope por Content-Length ANTES de bufferizar el cuerpo entero (si no, un
    // fichero enorme se carga del todo en memoria antes de rechazarlo).
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_FILE_SIZE_BYTES + 1024 * 1024) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return error("Body inválido: se esperaba multipart/form-data", 400);
    }

    const file = form.get("file");
    if (!file || typeof file === "string") return error("Campo 'file' obligatorio (multipart)", 422);
    if ((file.type || "") !== PDF_MIME) {
      return error(`Tipo no permitido: solo PDF. Recibido: ${file.type || "desconocido"}`, 422);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const realSize = buffer.length;
    if (realSize > MAX_FILE_SIZE_BYTES) {
      return error(`Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`, 413);
    }
    // Magic bytes: un .exe renombrado a .pdf declara application/pdf sin problema.
    if (!validateMimeMagicBytes(buffer, PDF_MIME)) return error("El archivo no es un PDF válido", 422);

    const usage = await getTenantStorageUsage(ctx.tenant.slug);
    if (usage + realSize > TENANT_QUOTA_BYTES) return error("Cuota de almacenamiento superada", 507);

    const nameRaw = form.get("name");
    const name = (typeof nameRaw === "string" ? nameRaw.trim() : "").slice(0, 200) || file.name || "Contrato firmado";
    const fileName = sanitizeFileName(/\.pdf$/i.test(name) ? name : `${name}.pdf`);

    // Leer el anterior ANTES de escribir el nuevo: si la consulta fallara
    // después, el fichero recién escrito quedaría huérfano en disco.
    let previo;
    try {
      previo = await findClientContract(Document, cliente);
    } catch (err) {
      if (!esTablaAusente(err)) throw err;
      return error("Este cliente aún no tiene el archivo de documentos activado; no se puede guardar el contrato", 503);
    }

    const documentId = randomUUID();
    const storagePath = await saveDocumentFile(ctx.tenant.slug, "shared", documentId, buffer, "pdf");

    let row;
    try {
      row = await Document.create({
        id: documentId,
        folderId: null,
        visibility: "shared",
        ownerUserId,
        fileName,
        storagePath,
        fileSize: realSize,
        mimeType: PDF_MIME,
        clientId: id,
        patientId: null,
        source: CONTRACT_SOURCE,
        // El contrato firmado SÍ lo ve la familia en su portal: es su documento.
        clientVisible: true,
      });
      await cliente.update({ contractDocumentId: documentId });
    } catch (dbErr) {
      await deleteDocumentFile(ctx.tenant.slug, storagePath);
      throw dbErr;
    }

    // El anterior se borra solo tras persistir el nuevo (y es best-effort).
    if (previo && previo.id !== documentId) {
      const pathPrevio = previo.storagePath;
      await previo.destroy().catch(() => {});
      await deleteDocumentFile(ctx.tenant.slug, pathPrevio).catch(() => {});
    }

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "client.contract.uploaded",
      entity: "Client",
      entityId: id,
      // Solo el nombre del fichero y el tamaño: el contrato lleva datos
      // personales de la familia y la auditoría vive en master, compartida.
      before: previo ? { fichero: previo.fileName, bytes: Number(previo.fileSize) } : null,
      after: { fichero: fileName, bytes: realSize },
    });

    return created({ clientId: id, contract: serializeContract(row), ...(await estadoFirma(ctx, cliente, true)) });
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { Client, Document } = ctx.tenantModels;
    const cliente = await Client.findByPk(id);
    if (!cliente) return notFound("Cliente no encontrado");

    const doc = await findClientContract(Document, cliente);
    if (!doc) {
      // Idempotente, pero si el puntero apuntaba a un documento ya borrado se
      // limpia de paso (si no, la ficha seguiría creyendo que hay contrato).
      if (cliente.contractDocumentId) await cliente.update({ contractDocumentId: null });
      return noContent();
    }

    const { fileName, storagePath, fileSize } = doc;
    await doc.destroy();
    if (cliente.contractDocumentId) await cliente.update({ contractDocumentId: null });
    await deleteDocumentFile(ctx.tenant.slug, storagePath).catch(() => {});

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "client.contract.deleted",
      entity: "Client",
      entityId: id,
      before: { fichero: fileName, bytes: Number(fileSize) },
    });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
