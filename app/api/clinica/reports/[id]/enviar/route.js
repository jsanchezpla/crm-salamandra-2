import { randomUUID } from "node:crypto";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logClinicaAudit } from "../../../../../../lib/clinica/audit.js";
import { serializeReport } from "../../../../../../lib/clinica/serialize.js";
import { clientIdOfPatient } from "../../../../../../lib/clinica/patientClient.js";
import { buildReportPdfBuffer, reportPdfFilename } from "../../../../../../lib/clinica/reportPdf.js";
import {
  TENANT_QUOTA_BYTES,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
} from "../../../../../../lib/documents/documentStorage.js";

/**
 * POST /api/clinica/reports/[id]/enviar — «Enviar al paciente»
 * (sprint Aumenta 2026-07, punto 3.2).
 *
 * Antes solo existía «Marcar como entregado»: un cambio de estado que no
 * entregaba nada: la familia no recibía el informe por ningún sitio y el
 * seguimiento de plazos se apoyaba en que alguien se acordara de pulsarlo.
 *
 * Ahora el informe se exporta a PDF y se publica como documento del archivo
 * central (`source='informe'`, `client_visible=true`), visible en el área
 * privada de la familia. `deliveredDocumentId` enlaza el informe con ese PDF.
 *
 * Reenviar es reemplazar: se genera un PDF nuevo y se borra el anterior, para
 * que la familia nunca tenga dos versiones del mismo informe.
 *
 * OJO: el portal filtra por cliente, así que un informe de un paciente SIN
 * cliente pagador no se puede entregar. Se dice, no se falla en silencio.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE = "informe";

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicalReport, Patient, TeamMember, Document } = ctx.tenantModels;
    if (!Document) return error("Este cliente no tiene el archivo de documentos activado", 503);

    const report = await ClinicalReport.findByPk(id, {
      include: [
        { model: Patient, as: "patient", attributes: ["id", "firstName", "lastName", "clientId", "specialties"] },
        { model: TeamMember, as: "therapist", attributes: ["id", "displayName"] },
      ],
    });
    if (!report) return notFound("Informe no encontrado");

    const patientName = `${report.patient?.firstName ?? ""} ${report.patient?.lastName ?? ""}`.trim();
    const clientId = report.clientId ?? report.patient?.clientId ?? (await clientIdOfPatient(ctx.tenantModels, report.patientId));
    if (!clientId) {
      return error(
        "Este paciente no tiene cliente pagador enlazado, así que el informe no puede llegar a su área privada. Enlázalo en la ficha y vuelve a intentarlo.",
        409
      );
    }

    let buffer;
    try {
      buffer = await buildReportPdfBuffer({
        report,
        patientName,
        therapistName: report.therapist?.displayName ?? null,
        tenantName: ctx.tenant.name,
        brand: ctx.tenant.settings?.brand ?? {},
        // Para que la especialidad de derivación salga con la etiqueta que el
        // centro escribió en Configuración y no con su clave interna.
        tenant: ctx.tenant,
        // El informe de beca traduce estas claves a los nombres oficiales de la
        // convocatoria en su cabecera (lib/clinica/beca.js).
        patientSpecialties: report.patient?.specialties ?? [],
      });
    } catch (err) {
      process.stderr.write(`[clinica:enviar] PDF falló: ${err.message}\n`);
      return error("No se pudo generar el PDF del informe", 500);
    }

    const usage = await getTenantStorageUsage(ctx.tenant.slug);
    if (usage + buffer.length > TENANT_QUOTA_BYTES) return error("Cuota de almacenamiento superada", 507);

    // El anterior se lee ANTES de escribir el nuevo (si no, un fallo aquí
    // dejaría el fichero recién creado huérfano en disco).
    const previo = report.deliveredDocumentId ? await Document.findByPk(report.deliveredDocumentId) : null;

    const documentId = randomUUID();
    const fileName = sanitizeFileName(reportPdfFilename(report, patientName));
    const storagePath = await saveDocumentFile(ctx.tenant.slug, "shared", documentId, buffer, "pdf");

    try {
      await Document.create({
        id: documentId,
        folderId: null,
        visibility: "shared",
        ownerUserId: request.headers.get("x-user-id") || null,
        fileName,
        storagePath,
        fileSize: buffer.length,
        mimeType: "application/pdf",
        clientId,
        patientId: report.patientId,
        source: SOURCE,
        clientVisible: true, // es justo lo que se le entrega a la familia
      });
      await report.update({
        deliveredDocumentId: documentId,
        status: "delivered",
        deliveredAt: report.deliveredAt ?? new Date(),
        clientId: report.clientId ?? clientId,
      });
    } catch (dbErr) {
      await deleteDocumentFile(ctx.tenant.slug, storagePath);
      throw dbErr;
    }

    if (previo && previo.id !== documentId) {
      const pathPrevio = previo.storagePath;
      await previo.destroy().catch(() => {});
      await deleteDocumentFile(ctx.tenant.slug, pathPrevio).catch(() => {});
    }

    await logClinicaAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "clinica.report.sent",
      entity: "ClinicalReport",
      entityId: id,
      // Sin nombre del paciente: es un dato de salud y la auditoría vive en
      // master, compartida por todos los clientes.
      after: { documento: fileName, bytes: buffer.length, reenvio: !!previo },
      ip: request.headers.get("x-forwarded-for"),
    });

    await report.reload({
      include: [
        { model: Patient, as: "patient", attributes: ["id", "firstName", "lastName", "age", "objectives", "referralReason", "mainTherapistId"] },
        { model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] },
      ],
    });
    return ok({ ...serializeReport(report, ctx.tenant), deliveredDocumentId: documentId, deliveredFileName: fileName });
  } catch (err) {
    return serverError(err);
  }
});
