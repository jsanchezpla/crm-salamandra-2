import { withTenant } from "@/lib/tenant/withTenant.js";
import { auditar, datosPeticion, resumen } from "@/lib/utils/auditoria.js";
import { ok, error, forbidden, notFound, unauthorized, serverError } from "@/lib/utils/apiResponse.js";
import { MODULE_KEYS } from "@/lib/tenant/moduleKeys.js";
import {
  getSupportSettings,
  currentAuthor,
  isAdminRequest,
  ticketIncludes,
  UUID_RE,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
} from "@/lib/support/context.js";
import { computeDueDates } from "@/lib/support/sla.js";
import { serializeTicket } from "@/lib/support/serialize.js";
import { notifyAssignment, emailClient, requestBaseUrl } from "@/lib/support/notify.js";
import { deleteTicketFolder } from "@/lib/support/ticketStorage.js";

const STATUS_LABELS = {
  open: "Abierto",
  in_progress: "En curso",
  waiting: "Esperando al cliente",
  resolved: "Resuelto",
  closed: "Cerrado",
};

async function loadTicket(ctx, id, { withThread = false } = {}) {
  const { Ticket, TicketMessage, TicketAttachment } = ctx.tenantModels;
  const include = ticketIncludes(ctx.tenantModels);
  if (withThread) {
    include.push(
      {
        model: TicketMessage,
        as: "messages",
        required: false,
        include: [{ model: TicketAttachment, as: "attachments", required: false }],
      },
      { model: TicketAttachment, as: "attachments", required: false }
    );
  }
  return Ticket.findByPk(id, {
    include,
    order: withThread ? [[{ model: TicketMessage, as: "messages" }, "createdAt", "ASC"]] : undefined,
  });
}

/** GET /api/tickets/[id] — ficha completa con hilo y adjuntos. */
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);
    const ticket = await loadTicket(ctx, id, { withThread: true });
    if (!ticket) return notFound("Ticket no encontrado");
    return ok(serializeTicket(ticket, { withThread: true }));
  } catch (err) {
    return serverError(err);
  }
});

/**
 * PATCH /api/tickets/[id] — cambios de propiedades y de estado.
 * Efectos encadenados: resolved pone `resolvedAt` y avisa al cliente; reabrir
 * limpia los cierres; cambiar la prioridad recalcula los SLA aún no cumplidos
 * (desde el ALTA, no desde ahora); cambiar el responsable le avisa.
 */
export const PATCH = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    const userId = request.headers.get("x-user-id");
    if (!userId) return unauthorized();
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { Ticket, TicketMessage, Client, Contact, TicketCategory, TeamMember } = ctx.tenantModels;
    const ticket = await Ticket.findByPk(id);
    if (!ticket) return notFound("Ticket no encontrado");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body JSON inválido");
    }

    const cambios = {};
    const efectos = [];
    const prevStatus = ticket.status;
    const prevAssigned = ticket.assignedTo;

    if (body.title !== undefined) {
      const title = String(body.title || "").trim().slice(0, 255);
      if (!title) return error("El asunto no puede quedar vacío", 422);
      cambios.title = title;
    }
    if (body.description !== undefined) {
      cambios.description = String(body.description || "").trim() || null;
    }
    if (body.requesterName !== undefined) {
      cambios.requesterName = String(body.requesterName || "").trim().slice(0, 255) || null;
    }
    if (body.requesterEmail !== undefined) {
      cambios.requesterEmail = String(body.requesterEmail || "").trim().slice(0, 255) || null;
    }

    // Relaciones (null explícito = desvincular).
    for (const [campo, Modelo, nombre] of [
      ["clientId", Client, "Cliente"],
      ["contactId", Contact, "Contacto"],
      ["categoryId", TicketCategory, "Categoría"],
      ["assignedTo", TeamMember, "Miembro del equipo"],
    ]) {
      if (body[campo] === undefined) continue;
      if (body[campo] === null) {
        cambios[campo] = null;
        continue;
      }
      if (!UUID_RE.test(body[campo])) return error(`${campo} inválido`, 400);
      const fila = await Modelo.findByPk(body[campo]);
      if (!fila) return error(`${nombre} no encontrado`, 404);
      cambios[campo] = body[campo];
    }

    // Prioridad → recalcular objetivos SLA no cumplidos, desde el alta.
    if (body.priority !== undefined) {
      if (!TICKET_PRIORITIES.includes(body.priority)) return error("priority inválida", 422);
      if (body.priority !== ticket.priority) {
        cambios.priority = body.priority;
        const settings = await getSupportSettings(ctx.tenantModels);
        const dues = computeDueDates(body.priority, settings, ticket.createdAt);
        if (!ticket.firstResponseAt) cambios.firstResponseDueAt = dues.firstResponseDueAt;
        if (!ticket.resolvedAt && !ticket.closedAt) cambios.resolutionDueAt = dues.resolutionDueAt;
      }
    }

    // SLA a medida para ESTE ticket (editable desde el drawer): fechas
    // objetivo explícitas (o null = sin objetivo). Pisan lo calculado por
    // prioridad; cambiar la prioridad después vuelve a recalcular.
    for (const campo of ["firstResponseDueAt", "resolutionDueAt"]) {
      if (body[campo] === undefined) continue;
      if (body[campo] === null) {
        cambios[campo] = null;
        continue;
      }
      const fecha = new Date(body[campo]);
      if (Number.isNaN(fecha.getTime())) return error(`${campo} inválida`, 422);
      cambios[campo] = fecha;
    }

    // Atajo del drawer: "restablecer SLA según prioridad" (desde el alta).
    if (body.slaReset === true) {
      const settings = await getSupportSettings(ctx.tenantModels);
      const dues = computeDueDates(cambios.priority || ticket.priority, settings, ticket.createdAt);
      cambios.firstResponseDueAt = dues.firstResponseDueAt;
      cambios.resolutionDueAt = dues.resolutionDueAt;
    }

    // Estado → fechas de cierre/reapertura + aviso al cliente si se resuelve.
    if (body.status !== undefined) {
      if (!TICKET_STATUSES.includes(body.status)) return error("status inválido", 422);
      if (body.status !== prevStatus) {
        cambios.status = body.status;
        if (body.status === "resolved") {
          cambios.resolvedAt = ticket.resolvedAt || new Date();
          efectos.push("email_resolved");
        } else if (body.status === "closed") {
          cambios.closedAt = ticket.closedAt || new Date();
          cambios.resolvedAt = ticket.resolvedAt || new Date();
        } else {
          // Reabierto (open / in_progress / waiting): se limpian los cierres.
          cambios.resolvedAt = null;
          cambios.closedAt = null;
        }
        efectos.push("nota_estado");
      }
    }

    if (Object.keys(cambios).length === 0) {
      const fullSin = await loadTicket(ctx, id, { withThread: true });
      return ok(serializeTicket(fullSin, { withThread: true }));
    }

    const antesTicket = resumen(ticket, ["number", "subject", "status", "priority"]);
    await ticket.update(cambios);
    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "ticket.updated",
      entity: "Ticket",
      entityId: ticket.id,
      before: antesTicket,
      after: resumen(ticket, ["number", "subject", "status", "priority"]),
    });

    // Nota de sistema en el hilo (interna) para que quede rastro de quién y cuándo.
    if (efectos.includes("nota_estado")) {
      const autor = await currentAuthor(request, ctx.tenantModels);
      await TicketMessage.create({
        ticketId: ticket.id,
        authorType: "system",
        authorUserId: autor.userId,
        authorName: autor.name,
        body: `Estado cambiado de "${STATUS_LABELS[prevStatus]}" a "${STATUS_LABELS[ticket.status]}" por ${autor.name || "el equipo"}.`,
        isInternal: true,
      }).catch(() => {});
    }

    const full = await loadTicket(ctx, id, { withThread: true });
    const baseUrl = requestBaseUrl(request);

    if (cambios.assignedTo && cambios.assignedTo !== prevAssigned) {
      const assignee = await TeamMember.findByPk(cambios.assignedTo);
      if (assignee) notifyAssignment({ ctx, ticket: full, assignee, baseUrl }).catch(() => {});
    }
    if (efectos.includes("email_resolved")) {
      emailClient({ ctx, ticket: full, kind: "resolved", baseUrl }).catch(() => {});
    }

    return ok(serializeTicket(full, { withThread: true }));
  } catch (err) {
    return serverError(err);
  }
});

/** DELETE /api/tickets/[id] — borrado físico (solo admin). Arrastra hilo y adjuntos. */
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule(MODULE_KEYS.SUPPORT)) return forbidden("Módulo support no activo");
    if (!isAdminRequest(request)) return forbidden("Solo administradores");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido", 400);

    const { Ticket, TicketMessage, TicketAttachment } = ctx.tenantModels;
    const ticket = await Ticket.findByPk(id);
    if (!ticket) return notFound("Ticket no encontrado");

    // Primero el disco, luego la BD (los CASCADE de la migración cubren hilo y
    // adjuntos; el destroy explícito cubre schemas creados por db:sync sin FK).
    await deleteTicketFolder(ctx.slug, ticket.id);
    await TicketAttachment.destroy({ where: { ticketId: ticket.id } });
    await TicketMessage.destroy({ where: { ticketId: ticket.id } });
    // Borrar un ticket elimina su hilo Y sus adjuntos del disco: sin rastro,
    // una conversación con un cliente podía desaparecer sin explicación.
    const antesBorrar = resumen(ticket, ["number", "subject", "status", "clientEmail"]);
    const idTicket = ticket.id;
    await ticket.destroy();
    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "ticket.deleted",
      entity: "Ticket",
      entityId: idTicket,
      before: antesBorrar,
    });

    return ok({ deleted: true });
  } catch (err) {
    return serverError(err);
  }
});
