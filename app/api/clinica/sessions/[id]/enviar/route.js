import { randomUUID } from "node:crypto";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { logClinicaAudit } from "@/lib/clinica/audit.js";
import { serializeSession } from "@/lib/clinica/serialize.js";
import { clientIdOfPatient } from "@/lib/clinica/patientClient.js";
import { buildSessionPdfBuffer, sessionPdfFilename } from "@/lib/clinica/sessionPdf.js";
import { documentoDeRegistro, motivoParaNoEnviar } from "@/lib/clinica/envioRegistro.js";
import {
  quotaBytesDe,
  getTenantStorageUsage,
  saveDocumentFile,
  deleteDocumentFile,
  sanitizeFileName,
} from "@/lib/documents/documentStorage.js";

/**
 * POST /api/clinica/sessions/[id]/enviar — «Enviar al paciente», pero de UN
 * registro de sesión (29/08/2026, Rodrigo, para Aumenta).
 *
 * Gemela de la del informe (`reports/[id]/enviar`) y a propósito: misma
 * mecánica, mismas salvaguardas y el mismo sitio donde acaba —el archivo
 * central como documento visible, y de ahí a «Mis documentos» de la familia—.
 * Lo que cambia es el papel: un registro es una sesión suelta, así que se envía
 * el que se quiera y cuando se quiera, sin redactar un informe para ello.
 *
 * **Lo que se sube es el PDF y nada más** (`lib/clinica/envioRegistro.js`), y
 * ese PDF ya deja fuera la preparación, sus adjuntos, las NOTAS INTERNAS y la
 * transcripción del audio: lo decide `lib/clinica/sessionPdf.js`, que es el
 * mismo generador que usa «Ver PDF». Una sola fuente, para que nadie
 * previsualice un documento y la familia reciba otro.
 *
 * Reenviar es reemplazar: PDF nuevo, se borra el anterior. La familia no tiene
 * nunca dos versiones del mismo registro.
 *
 * No lleva guard de demo: no manda correo, no gasta IA y no escribe en master.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicSession, Patient, TeamMember, Document } = ctx.tenantModels;
    if (!Document) return error("Este cliente no tiene el archivo de documentos activado", 503);

    const session = await ClinicSession.findByPk(id, {
      include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName"] }],
    });
    if (!session) return notFound("Sesión no encontrada");

    const patient = await Patient.findByPk(session.patientId, {
      attributes: ["id", "firstName", "lastName", "clientId"],
    });
    const patientName = `${patient?.firstName ?? ""} ${patient?.lastName ?? ""}`.trim();

    const clientId =
      session.clientId ?? patient?.clientId ?? (await clientIdOfPatient(ctx.tenantModels, session.patientId));
    const motivo = motivoParaNoEnviar({ clientId });
    if (motivo) return error(motivo, 409);

    let buffer;
    try {
      buffer = await buildSessionPdfBuffer({
        session,
        patientName,
        therapistName: session.therapist?.displayName ?? null,
        tenantName: ctx.tenant.name,
        brand: ctx.tenant.settings?.brand ?? {},
        tenant: ctx.tenant,
      });
    } catch (err) {
      process.stderr.write(`[clinica:enviar-registro] PDF falló: ${err.message}\n`);
      return error("No se pudo generar el PDF del registro", 500);
    }

    const usage = await getTenantStorageUsage(ctx.tenant.slug);
    if (usage + buffer.length > quotaBytesDe(ctx)) return error("Cuota de almacenamiento superada", 507);

    // El anterior se lee ANTES de escribir el nuevo: si algo falla aquí, el
    // fichero recién creado no se queda huérfano en disco.
    const previo = session.deliveredDocumentId ? await Document.findByPk(session.deliveredDocumentId) : null;

    const documentId = randomUUID();
    const fileName = sanitizeFileName(sessionPdfFilename(session, patientName));
    const storagePath = await saveDocumentFile(ctx.tenant.slug, "shared", documentId, buffer, "pdf");

    try {
      await Document.create(
        documentoDeRegistro({
          documentId,
          fileName,
          storagePath,
          fileSize: buffer.length,
          patientId: session.patientId,
          clientId,
          ownerUserId: request.headers.get("x-user-id") || null,
        })
      );
      await session.update({
        deliveredDocumentId: documentId,
        deliveredAt: session.deliveredAt ?? new Date(),
        clientId: session.clientId ?? clientId,
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
      action: "clinica.session.sent",
      entity: "ClinicSession",
      entityId: id,
      // Sin nombre del paciente: dato de salud, y la auditoría vive en master.
      after: { documento: fileName, bytes: buffer.length, reenvio: !!previo },
      ip: request.headers.get("x-forwarded-for"),
    });

    await session.reload({
      include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
    });
    return ok({ ...serializeSession(session), deliveredFileName: fileName });
  } catch (err) {
    return serverError(err);
  }
});
