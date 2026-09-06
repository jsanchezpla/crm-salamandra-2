import { randomUUID } from "node:crypto";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { logClinicaAudit } from "@/lib/clinica/audit.js";
import { serializeSession } from "@/lib/clinica/serialize.js";
import { clientIdOfPatient } from "@/lib/clinica/patientClient.js";
import { buildSessionPdfBuffer, sessionPdfFilename } from "@/lib/clinica/sessionPdf.js";
import { includesDeLaSesion, argumentosDelPdfDeSesion } from "@/lib/clinica/argumentosDelPdf.js";
import { documentoDeRegistro, motivoParaNoEnviar } from "@/lib/clinica/envioRegistro.js";
import { propuestaDeCorreo, limpiarCorreo, motivoParaNoAvisar } from "@/lib/clinica/correoRegistro.js";
import { registroEnviadoTemplate } from "@/lib/email/templates/clinica/registroEnviado.js";
import { getTenantResendConfig } from "@/lib/outreach/resendConfig.js";
import { sendEmail, envioRealizado } from "@/lib/email/resendClient.js";
import { isDemoTenant } from "@/lib/demo/isDemo.js";
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
 * ── Y AVISA POR CORREO (04/09/2026, Rodrigo) ────────────────────────────────
 * Publicar el PDF no le decía nada a nadie: la familia se enteraba si entraba a
 * mirar. Ahora, opcionalmente, sale un correo con un RESUMEN de la sesión.
 * El texto lo propone `lib/clinica/correoRegistro.js` a partir de la Devolución
 * a la familia y quien envía lo repasa y lo cambia antes de mandarlo — se pide
 * con `GET` y se manda con el `POST`. El PDF **no se adjunta**: es un documento
 * clínico de un menor y se recoge en el área privada, que pide identificarse.
 *
 * Desde que manda correo SÍ lleva guard de demo: las cuatro demos son públicas
 * con sesión de admin.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * GET — qué se va a enviar: la propuesta de correo (editable) y a quién iría.
 * Se pide al abrir el cajón de envío, para que el texto se pueda repasar antes
 * de que salga nada.
 */
export const GET = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicSession, Client } = ctx.tenantModels;
    const session = await ClinicSession.findByPk(id, { include: includesDeLaSesion(ctx.tenantModels) });
    if (!session) return notFound("Sesión no encontrada");

    const argumentos = await argumentosDelPdfDeSesion(session, ctx);
    const clientId =
      session.clientId ?? argumentos.patientClientId ?? (await clientIdOfPatient(ctx.tenantModels, session.patientId));
    const cliente = clientId && Client ? await Client.findByPk(clientId, { attributes: ["id", "name", "email"] }) : null;

    return ok({
      propuesta: propuestaDeCorreo({
        sesion: session,
        tenant: ctx.tenant,
        patientName: argumentos.patientName,
        centro: ctx.tenant?.name ?? null,
      }),
      destinatario: cliente ? { nombre: cliente.name, email: cliente.email ?? null } : null,
      motivoParaNoEnviar: motivoParaNoEnviar({ clientId }),
      motivoParaNoAvisar: motivoParaNoAvisar({ email: cliente?.email }),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicSession, TeamMember, Document, Client } = ctx.tenantModels;
    if (!Document) return error("Este cliente no tiene el archivo de documentos activado", 503);

    /*
     * ── EL CORREO A LA FAMILIA (04/09/2026, Rodrigo) ────────────────────────
     * Opcional: sin `correo.enviar` esto se comporta EXACTAMENTE como hasta
     * hoy —publica el PDF y calla—. El texto viene YA repasado desde la
     * pantalla; aquí solo se sanea. Se valida ANTES de escribir nada: un
     * correo vacío se dice antes de mover documentos, no después.
     */
    let correo = null;
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      if (body?.correo?.enviar) {
        // Manda correo: las cuatro demos son públicas con sesión de admin. Con
        // `return`, no con el `assert` que lanza: dentro de este `try` el
        // ForbiddenError acababa en el `catch` como un 500 mudo (06/09/2026).
        if (isDemoTenant(ctx)) return forbidden("Avisar por correo está desactivado en la demo: usa datos de ejemplo.");
        const limpio = limpiarCorreo(body.correo);
        if (limpio.error) return error(limpio.error, 422);
        correo = limpio;
      }
    }

    const session = await ClinicSession.findByPk(id, { include: includesDeLaSesion(ctx.tenantModels) });
    if (!session) return notFound("Sesión no encontrada");

    // Los MISMOS argumentos que «Ver PDF» (03/09/2026): lo que la profesional
    // previsualiza es lo que recibe la familia.
    const argumentos = await argumentosDelPdfDeSesion(session, ctx);
    const { patientName } = argumentos;

    const clientId =
      session.clientId ?? argumentos.patientClientId ?? (await clientIdOfPatient(ctx.tenantModels, session.patientId));
    const motivo = motivoParaNoEnviar({ clientId });
    if (motivo) return error(motivo, 409);

    let buffer;
    try {
      buffer = await buildSessionPdfBuffer(argumentos);
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

    /*
     * El correo va AL FINAL y es best-effort: el registro YA está publicado en
     * el área privada, que es lo que de verdad se ha pedido. Si Resend falla,
     * el envío no se deshace — se cuenta en la respuesta (`correoEnviado` /
     * `correoError`) y la pantalla lo dice. Misma regla que el envío de
     * facturas: el estado no puede depender de que conteste un proveedor.
     */
    let correoEnviado = null;
    let correoError = null;
    if (correo) {
      try {
        const cliente = Client ? await Client.findByPk(clientId, { attributes: ["id", "name", "email"] }) : null;
        const motivoCorreo = motivoParaNoAvisar({ email: cliente?.email });
        if (motivoCorreo) {
          correoEnviado = false;
          correoError = motivoCorreo;
        } else {
          const resend = getTenantResendConfig({ tenant: ctx.tenant });
          const tpl = registroEnviadoTemplate({
            tenantName: ctx.tenant.name,
            brand: ctx.tenant.settings?.brand,
            asunto: correo.asunto,
            texto: correo.texto,
            portalUrl: ctx.tenant.settings?.widget?.auth?.loginUrl ?? null,
          });
          const envio = await sendEmail({
            to: cliente.email,
            subject: tpl.subject,
            html: tpl.html,
            text: tpl.text,
            from: resend.fromEmail || undefined,
            replyTo: resend.replyTo || undefined,
            apiKey: resend.apiKey || undefined,
          });
          const { salio, motivo } = envioRealizado(envio, `clinica:registro ${id}`);
          correoEnviado = salio;
          correoError = salio ? null : motivo;
        }
      } catch (mailErr) {
        process.stderr.write(`[clinica:enviar-registro] correo falló: ${mailErr.message}\n`);
        correoEnviado = false;
        correoError = "No se pudo enviar el correo";
      }
    }

    await session.reload({
      include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
    });
    return ok({ ...serializeSession(session), deliveredFileName: fileName, correoEnviado, correoError });
  } catch (err) {
    return serverError(err);
  }
});
