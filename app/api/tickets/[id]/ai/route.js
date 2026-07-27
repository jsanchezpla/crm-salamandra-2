import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import { UUID_RE } from "@/lib/support/context.js";
import { getTenantAnthropicKey } from "@/lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "@/lib/ai/anthropicModel.js";
import { ticketAiSummary, ticketAiDraft, ticketAiClassify } from "@/lib/support/ai.js";

/**
 * POST /api/tickets/[id]/ai — acciones de IA sobre un ticket, SIEMPRE a
 * petición del usuario (botón). Clave BYOK del tenant; sin clave → 503.
 *
 * Body: { action: "summarize" | "draft" | "classify" }
 *   summarize → { summary }               (resumen del hilo, notas incluidas)
 *   draft     → { draft }                 (borrador de respuesta al cliente)
 *   classify  → { priority, categoryId }  (sugerencia; la UI decide aplicarla)
 */
export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const apiKey = getTenantAnthropicKey(ctx);
    if (!apiKey) {
      return error("Este cliente no tiene configurada la clave de IA (Configuración → IA)", 503);
    }
    const model = getTenantAnthropicModel(ctx);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body JSON inválido");
    }
    const action = body?.action;

    const { Ticket, TicketMessage, TicketCategory } = ctx.tenantModels;
    const ticket = await Ticket.findByPk(id);
    if (!ticket) return notFound("Ticket no encontrado");
    const messages = await TicketMessage.findAll({
      where: { ticketId: ticket.id },
      order: [["createdAt", "ASC"]],
      limit: 200,
    });

    const t = ticket.toJSON();
    const msgs = messages.map((m) => m.toJSON());

    if (action === "summarize") {
      const summary = await ticketAiSummary({ ticket: t, messages: msgs, apiKey, model });
      return ok({ summary });
    }
    if (action === "draft") {
      const draft = await ticketAiDraft({ ticket: t, messages: msgs, apiKey, model });
      return ok({ draft });
    }
    if (action === "classify") {
      const categories = await TicketCategory.findAll({ where: { active: true }, raw: true });
      const sugerencia = await ticketAiClassify({ ticket: t, categories, apiKey, model });
      if (!sugerencia) return error("La IA no ha podido clasificar este ticket", 502);
      return ok(sugerencia);
    }
    return error("action debe ser summarize, draft o classify", 422);
  } catch (err) {
    if (err?.code === "NO_API_KEY") {
      return error("Este cliente no tiene configurada la clave de IA (Configuración → IA)", 503);
    }
    return serverError(err);
  }
});
