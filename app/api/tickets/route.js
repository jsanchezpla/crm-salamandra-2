import { randomBytes } from "node:crypto";
import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, created, error, forbidden, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import {
  getSupportSettings,
  currentAuthor,
  ticketIncludes,
  UUID_RE,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  ACTIVE_STATUSES,
} from "@/lib/support/context.js";
import { computeDueDates } from "@/lib/support/sla.js";
import { serializeTicket } from "@/lib/support/serialize.js";
import { notifyAssignment, emailClient, requestBaseUrl } from "@/lib/support/notify.js";
import { resolveCurrentTeamMemberId } from "@/lib/team/currentTeamMember.js";

/**
 * GET /api/tickets — la bandeja.
 *
 * Query:
 *   ?status=open|in_progress|waiting|resolved|closed|active   (active = los 3 primeros; default active)
 *   ?priority=low|medium|high|critical
 *   ?categoryId=<uuid>  ?assignedTo=<uuid>|me|none  ?clientId=<uuid>
 *   ?q=texto  (busca en título y solicitante; "TK-12" o "12" busca por número)
 *   ?limit=50&offset=0
 *
 * Devuelve además el recuento por estado y los tickets con SLA vencido (para
 * los globos de las pestañas y el aviso rojo de la cabecera).
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const { Ticket } = ctx.tenantModels;
    const sp = new URL(request.url).searchParams;

    const where = {};

    const status = sp.get("status") || "active";
    if (status === "active") where.status = ACTIVE_STATUSES;
    else if (TICKET_STATUSES.includes(status)) where.status = status;

    const priority = sp.get("priority");
    if (TICKET_PRIORITIES.includes(priority)) where.priority = priority;

    const categoryId = sp.get("categoryId");
    if (categoryId && UUID_RE.test(categoryId)) where.categoryId = categoryId;

    const clientId = sp.get("clientId");
    if (clientId && UUID_RE.test(clientId)) where.clientId = clientId;

    const assignedTo = sp.get("assignedTo");
    if (assignedTo === "none") where.assignedTo = null;
    else if (assignedTo === "me") {
      const mine = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
      // Sin TeamMember propio, "mis tickets" es un conjunto vacío coherente.
      where.assignedTo = mine || "00000000-0000-0000-0000-000000000000";
    } else if (assignedTo && UUID_RE.test(assignedTo)) where.assignedTo = assignedTo;

    const q = (sp.get("q") || "").trim().slice(0, 120);
    if (q) {
      const num = q.match(/^tk-?\s*(\d{1,9})$/i) || q.match(/^#?(\d{1,9})$/);
      if (num) {
        where.number = Number(num[1]);
      } else {
        where[Op.or] = [
          { title: { [Op.iLike]: `%${q}%` } },
          { requesterName: { [Op.iLike]: `%${q}%` } },
          { requesterEmail: { [Op.iLike]: `%${q}%` } },
        ];
      }
    }

    const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(sp.get("offset")) || 0, 0);
    const now = new Date();

    const [{ rows, count }, porEstado, slaVencidos] = await Promise.all([
      Ticket.findAndCountAll({
        where,
        include: ticketIncludes(ctx.tenantModels),
        order: [
          [Ticket.sequelize.literal(`COALESCE("Ticket"."last_message_at", "Ticket"."created_at")`), "DESC"],
        ],
        limit,
        offset,
        distinct: true,
      }),
      Ticket.findAll({
        attributes: ["status", [Ticket.sequelize.fn("COUNT", Ticket.sequelize.col("id")), "n"]],
        group: ["status"],
        raw: true,
      }),
      Ticket.count({
        where: {
          status: ACTIVE_STATUSES,
          [Op.or]: [
            { firstResponseAt: null, firstResponseDueAt: { [Op.lt]: now } },
            { resolvedAt: null, resolutionDueAt: { [Op.lt]: now } },
          ],
        },
      }),
    ]);

    const recuento = { open: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0 };
    for (const fila of porEstado) {
      if (fila.status in recuento) recuento[fila.status] = Number(fila.n) || 0;
    }
    recuento.active = recuento.open + recuento.in_progress + recuento.waiting;

    return ok({
      tickets: rows.map((t) => serializeTicket(t)),
      total: count,
      recuento,
      slaVencidos,
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * POST /api/tickets — alta manual desde el CRM.
 * Body JSON: { title*, description?, clientId?, contactId?, categoryId?,
 *   priority?, assignedTo?, requesterName?, requesterEmail?, notifyClient? }
 *
 * Siempre se genera el token del portal: si el cliente tiene email y
 * `notifyClient` es true, recibe la confirmación con su enlace de seguimiento.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();

    const { Ticket, Client, Contact, TicketCategory, TeamMember } = ctx.tenantModels;

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body JSON inválido");
    }

    const title = String(body?.title || "").trim().slice(0, 255);
    if (!title) return error("El asunto es obligatorio", 422);
    const description = String(body?.description || "").trim() || null;

    const clientId = body?.clientId && UUID_RE.test(body.clientId) ? body.clientId : null;
    const contactId = body?.contactId && UUID_RE.test(body.contactId) ? body.contactId : null;
    const categoryId = body?.categoryId && UUID_RE.test(body.categoryId) ? body.categoryId : null;
    const assignedTo = body?.assignedTo && UUID_RE.test(body.assignedTo) ? body.assignedTo : null;
    const priority = TICKET_PRIORITIES.includes(body?.priority) ? body.priority : "medium";

    // Verificación de pertenencia al tenant (los ids llegan del navegador).
    const [client, contact, category, assignee] = await Promise.all([
      clientId ? Client.findByPk(clientId) : null,
      contactId ? Contact.findByPk(contactId) : null,
      categoryId ? TicketCategory.findByPk(categoryId) : null,
      assignedTo ? TeamMember.findByPk(assignedTo) : null,
    ]);
    if (clientId && !client) return error("Cliente no encontrado", 404);
    if (contactId && !contact) return error("Contacto no encontrado", 404);
    if (contact && client && contact.clientId && contact.clientId !== client.id) {
      return error("El contacto no pertenece a ese cliente", 422);
    }
    if (categoryId && !category) return error("Categoría no encontrada", 404);
    if (assignedTo && !assignee) return error("Miembro del equipo no encontrado", 404);

    const settings = await getSupportSettings(ctx.tenantModels);
    const dues = computeDueDates(priority, settings);

    const requesterName =
      String(body?.requesterName || "").trim().slice(0, 255) || contact?.name || client?.name || null;
    const requesterEmail =
      String(body?.requesterEmail || "").trim().slice(0, 255) || contact?.email || client?.email || null;

    const row = await Ticket.create({
      title,
      description,
      clientId,
      contactId,
      categoryId,
      priority,
      assignedTo,
      status: "open",
      channel: "manual",
      portalToken: randomBytes(24).toString("base64url"),
      requesterName,
      requesterEmail,
      createdBy: userId,
      firstResponseDueAt: dues.firstResponseDueAt,
      resolutionDueAt: dues.resolutionDueAt,
      lastMessageAt: new Date(),
    });

    const full = await Ticket.findByPk(row.id, { include: ticketIncludes(ctx.tenantModels) });
    const baseUrl = requestBaseUrl(request);

    // Avisos best-effort, sin bloquear la respuesta.
    if (assignee) notifyAssignment({ ctx, ticket: full, assignee, baseUrl }).catch(() => {});
    if (body?.notifyClient === true) emailClient({ ctx, ticket: full, kind: "created", baseUrl }).catch(() => {});

    return created(serializeTicket(full));
  } catch (err) {
    return serverError(err);
  }
});
