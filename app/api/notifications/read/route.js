import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error } from "../../../../lib/utils/apiResponse.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/notifications/read — marcar como leída(s).
 *   { id: "<uuid>" }   una concreta
 *   { all: true }      todas las del usuario
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  const userId = request.headers.get("x-user-id");
  if (!userId) return error("No autenticado", 401);
  const { Notification } = ctx.tenantModels;
  if (!Notification) return ok({ unread: 0 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* sin body */
  }

  try {
    const where = { userId, channel: "app", read: false };
    if (body.id && UUID_RE.test(body.id)) where.id = body.id;
    else if (!body.all) return error("Indica id o all:true", 422);
    await Notification.update({ read: true, readAt: new Date() }, { where });
    const unread = await Notification.count({ where: { userId, channel: "app", read: false } });
    return ok({ unread });
  } catch {
    return ok({ unread: 0 });
  }
});
