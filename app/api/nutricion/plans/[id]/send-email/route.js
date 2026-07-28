import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../../../lib/demo/isDemo.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import { UUID_RE, loadPlanTree } from "../../../../../../lib/nutricion/plans.js";
import { buildMenuPdfBuffer, menuPdfFilename } from "../../../../../../lib/nutricion/menuPdf.js";
import { menuEmail } from "../../../../../../lib/email/templates/nutricion/menuEmail.js";
import { sendEmail } from "../../../../../../lib/email/resendClient.js";
import { getTenantResendConfig } from "../../../../../../lib/outreach/resendConfig.js";

async function logAudit({ tenantId, userId, action, entityId, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId, action, entity: "Plan", entityId, after, ip });
  } catch {
    /* silent */
  }
}

// Anti-spam en proceso: un mismo plan no se reenvía más de una vez cada 30 s.
// Mitiga bucles de reenvío (el botón deshabilitado por sendingId solo cubre una
// pestaña). NO persiste entre reinicios ni entre instancias — producción corre
// un único contenedor `app`. Un dedup persistente (columna emailedAt) queda para
// un sprint con migración.
const THROTTLE_MS = 30_000;
const lastSentByPlan = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/nutricion/plans/[id]/send-email — envía el menú del plan asignado
// al email del paciente, con el PDF adjunto. Solo planes `assigned` (una
// plantilla no tiene destinatario).
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, ctx, tenantCtx) => {
  const { tenant, tenantModels, hasModule, brand } = tenantCtx;
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    // Demo pública: no enviar correo real con la clave de Resend del tenant.
    // (Se devuelve 403 en vez de lanzar: este handler tiene su propio catch,
    // que convertiría cualquier excepción en un 500 genérico.)
    if (isDemoTenant(tenantCtx)) {
      return forbidden("El envío del menú por correo está desactivado en la demo: usa datos de ejemplo.");
    }
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Plan, Client } = tenantModels;
    const tree = await loadPlanTree(Plan, tenantModels, id);
    if (!tree || tree.archivedAt) return notFound("Plan no encontrado");
    if (tree.type !== "assigned") {
      return error("Solo se puede enviar un plan asignado a un paciente");
    }
    // No enviar un menú vacío. OJO: desde Nutrinotas todo plan nace con las 5
    // comidas estándar, así que contar comidas ya no sirve — hay que comprobar
    // que al menos una opción tiene contenido (alimentos o recetas). Si no, el
    // paciente recibiría un PDF de aspecto oficial lleno de "(vacía)".
    const hasContent = (tree.meals || []).some((m) =>
      (m.options || []).some((o) => (o.foods || []).length > 0 || (o.recipes || []).length > 0)
    );
    if (!hasContent) {
      return error("El plan no tiene contenido todavía. Añade alimentos o recetas antes de enviarlo.");
    }

    const client = tree.clientId
      ? await Client.findByPk(tree.clientId, { attributes: ["id", "name", "email"] })
      : null;
    if (!client) return error("El plan no tiene paciente asociado");
    if (!client.email) {
      return error("El paciente no tiene email en su ficha. Añádelo en Clientes y vuelve a intentarlo.");
    }

    // Throttle anti-bucle (reserva optimista: también corta envíos concurrentes).
    const now = Date.now();
    for (const [k, t] of lastSentByPlan) if (now - t > THROTTLE_MS) lastSentByPlan.delete(k);
    const prev = lastSentByPlan.get(id);
    if (prev && now - prev < THROTTLE_MS) {
      return error("Este menú se acaba de enviar. Espera unos segundos antes de reenviarlo.", 429);
    }
    lastSentByPlan.set(id, now);

    const buffer = await buildMenuPdfBuffer({
      plan: tree,
      client: { name: client.name },
      tenantName: tenant.name,
      brand,
      tenantSlug: tenant.slug, // fotos de receta embebidas en el PDF
    });

    const { subject, html, text } = menuEmail({
      tenantName: tenant.name,
      brand,
      clientName: client.name,
      planName: tree.name,
    });

    // BYOK: el menú sale de la cuenta de Resend de la nutricionista.
    const cfgResend = getTenantResendConfig({ tenant });
    const result = await sendEmail({
      to: client.email,
      subject,
      html,
      text,
      from: cfgResend.fromEmail || undefined,
      replyTo: cfgResend.replyTo || undefined,
      apiKey: cfgResend.apiKey || undefined,
      attachments: [{ filename: menuPdfFilename(tree, client), content: buffer }],
      tags: [
        { name: "module", value: "nutricion" },
        { name: "tenant", value: tenant.slug || "" },
      ],
    });

    // Envío fallido: liberar la reserva del throttle y devolver un error
    // GENÉRICO (no filtrar el mensaje crudo de Resend a usuarios finales; el
    // detalle queda en los logs de sendEmail). Espeja el patrón de outreach.
    if (!result.ok) {
      lastSentByPlan.delete(id);
      return error("No se pudo enviar el email. Revisa la configuración de email del CRM.", 502);
    }

    // En PRODUCCIÓN, un dry-run significa que RESEND_API_KEY no está configurada:
    // el email NUNCA sale. No hay que reportarlo como éxito (Laura creería que el
    // paciente lo recibió). En desarrollo el dry-run es el modo normal y se
    // devuelve como tal para que la UI lo indique.
    if (result.dryRun && process.env.NODE_ENV === "production") {
      lastSentByPlan.delete(id);
      return error(
        "El envío de email no está configurado en el servidor (falta RESEND_API_KEY). Avisa al administrador.",
        503
      );
    }

    await logAudit({
      tenantId: tenant.id,
      userId: request.headers.get("x-user-id") || null,
      action: "nutricion.menu_emailed",
      entityId: id,
      after: { to: client.email, planName: tree.name, dryRun: !!result.dryRun },
      ip: request.headers.get("x-forwarded-for") || null,
    });

    return ok({ sentTo: client.email, dryRun: !!result.dryRun });
  } catch (err) {
    return serverError(err);
  }
});
