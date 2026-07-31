import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../lib/citas/audit.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * /api/citas/blocked-days — festivos y cierres del centro (sprint 2026-07-29).
 *
 *   GET    ?from=YYYY-MM-DD&to=YYYY-MM-DD   listar (todo el equipo puede leer:
 *                                           el calendario los pinta para todos)
 *   POST   { date, label }                  marcar un día (solo admin)
 *   DELETE ?date=YYYY-MM-DD                 desmarcarlo (solo admin)
 *
 * Es del TENANT entero: un cierre del centro afecta a todos. Una ausencia de
 * una persona concreta se resuelve con SU disponibilidad, que es otra cosa.
 *
 * Marcar un festivo NO cancela las citas que ya hubiera ese día: eso lo decide
 * el centro (avisar, reubicar, cobrar o no). La respuesta del POST dice cuántas
 * hay para que la UI pueda avisar.
 */

function gate(ctx) {
  if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
  return null;
}

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { BlockedDay } = ctx.tenantModels;
    if (!BlockedDay) return ok({ blockedDays: [] });

    const sp = new URL(request.url).searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const where = {};
    if (FECHA_RE.test(from ?? "") && FECHA_RE.test(to ?? "")) {
      where.date = { [Op.between]: [from, to] };
    }

    const filas = await BlockedDay.findAll({ where, order: [["date", "ASC"]], limit: 500 });
    return ok({
      blockedDays: filas.map((f) => ({
        id: f.id,
        date: String(f.date).slice(0, 10),
        label: f.label ?? null,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede marcar festivos");
    const { BlockedDay, Booking } = ctx.tenantModels;
    if (!BlockedDay) return error("El calendario de festivos no está disponible en este cliente", 503);

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const date = String(body.date ?? "").trim();
    if (!FECHA_RE.test(date)) return error("date debe tener el formato YYYY-MM-DD", 422);
    const label = body.label ? String(body.label).trim().slice(0, 120) : null;

    // Idempotente: volver a marcar un día ya marcado actualiza la etiqueta en
    // vez de reventar con un 500 por el índice único.
    const [fila, nuevo] = await BlockedDay.findOrCreate({
      where: { date },
      defaults: { date, label, createdById: request.headers.get("x-user-id") || null },
    });
    if (!nuevo && label && fila.label !== label) await fila.update({ label });

    // Citas ya existentes ese día: NO se tocan, pero se cuentan para avisar.
    let citasEseDia = 0;
    if (Booking) {
      citasEseDia = await Booking.count({
        where: {
          scheduledAt: { [Op.gte]: `${date} 00:00:00`, [Op.lte]: `${date} 23:59:59` },
          status: { [Op.notIn]: ["cancelled", "no_show"] },
        },
      });
    }

    await logCitasAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "citas.blocked_day_created",
      entity: "BlockedDay",
      entityId: fila.id,
      after: { date, label },
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    return created({ id: fila.id, date, label, citasEseDia, yaEstaba: !nuevo });
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede quitar festivos");
    const { BlockedDay } = ctx.tenantModels;
    if (!BlockedDay) return error("El calendario de festivos no está disponible en este cliente", 503);

    const date = String(new URL(request.url).searchParams.get("date") ?? "").trim();
    if (!FECHA_RE.test(date)) return error("date debe tener el formato YYYY-MM-DD", 422);

    const fila = await BlockedDay.findOne({ where: { date } });
    if (!fila) return ok({ removed: false }); // idempotente

    const antes = { date, label: fila.label ?? null };
    const idBorrado = fila.id;
    await fila.destroy();

    await logCitasAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "citas.blocked_day_deleted",
      entity: "BlockedDay",
      entityId: idBorrado,
      before: antes,
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    return ok({ removed: true });
  } catch (err) {
    return serverError(err);
  }
});
