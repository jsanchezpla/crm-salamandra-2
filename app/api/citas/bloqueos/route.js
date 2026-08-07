import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../lib/citas/audit.js";
import { buildMadridDate } from "../../../../lib/citas/slots.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /api/citas/bloqueos — «Vacaciones» (06/08/2026, Rodrigo).
 *
 *   GET    ?from=ISO&to=ISO    listar (todo el equipo lo lee: la agenda los pinta)
 *   POST   { teamMemberId, startAt, endAt, label, notes }   crear (solo admin)
 *   DELETE ?id=UUID            quitarlo (solo admin)
 *
 * Rodrigo lo pidió como «un tipo de cita especial sin paciente, con fecha y
 * hora de inicio y fin, asignado a un miembro del equipo». Por dentro NO es una
 * cita —el porqué está en `models/tenant/TeamBlock.model.js`— pero en la
 * pantalla se crea igual: se elige a quién, desde cuándo y hasta cuándo.
 *
 * `teamMemberId` a null = no está NADIE, o sea un cierre del centro con hora.
 *
 * Crear un bloqueo NO cancela las citas que ya hubiera dentro: eso lo decide el
 * centro (avisar, reubicar, cobrar o no), igual que con los festivos. La
 * respuesta dice cuántas hay para que la pantalla pueda avisar.
 */

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^(\d{1,2}):(\d{2})$/;

/**
 * "2026-08-17" + "07:00" → el instante en que en MADRID son las 7 de la mañana.
 *
 * `respaldo` es un ISO completo, para no romper a quien llame al endpoint a la
 * vieja usanza (o a una pestaña abierta desde antes de este arreglo). Ahí sí se
 * respeta la zona que traiga la cadena, porque un ISO con zona no es ambiguo.
 */
function instanteDeMadrid(fecha, hora, respaldo) {
  if (FECHA_RE.test(String(fecha ?? "")) && HORA_RE.test(String(hora ?? ""))) {
    const [y, m, d] = String(fecha).split("-").map(Number);
    const [hh, mm] = HORA_RE.exec(String(hora)).slice(1).map(Number);
    if (hh > 23 || mm > 59) return null;
    return buildMadridDate(y, m, d, hh, mm);
  }
  if (respaldo) {
    const t = new Date(respaldo);
    return Number.isNaN(t.getTime()) ? null : t;
  }
  return null;
}

function gate(ctx) {
  if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
  return null;
}

function serializa(f) {
  return {
    id: f.id,
    teamMemberId: f.teamMemberId ?? null,
    teamMemberName: f.teamMember?.displayName ?? null,
    startAt: f.startAt,
    endAt: f.endAt,
    label: f.label,
    notes: f.notes ?? null,
  };
}

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { TeamBlock, TeamMember } = ctx.tenantModels;
    if (!TeamBlock) return ok({ bloqueos: [] });

    const sp = new URL(request.url).searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const where = {};
    if (from && to && !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to))) {
      // Los que PISAN el rango, no los que caben dentro: unas vacaciones de tres
      // semanas tienen que salir aunque el rango pedido sea de un solo día.
      where.startAt = { [Op.lt]: new Date(to) };
      where.endAt = { [Op.gt]: new Date(from) };
    }

    const filas = await TeamBlock.findAll({
      where,
      include: TeamMember ? [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"], required: false }] : [],
      order: [["startAt", "ASC"]],
      limit: 500,
    });
    return ok({ bloqueos: filas.map(serializa) });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede bloquear días");
    const { TeamBlock, TeamMember, Booking } = ctx.tenantModels;
    if (!TeamBlock) return error("Los bloqueos no están disponibles en este cliente", 503);

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    /*
     * ⚠️ LA HORA VIENE PARTIDA (fecha + hora), NO COMO UN INSTANTE. Corrige el
     * fallo del 07/08/2026 que reportó Rodrigo: metía «de 7 a 9» y salía «de 9
     * a 11».
     *
     * La pantalla mandaba "2026-08-17T07:00:00", sin zona. `new Date()` de una
     * cadena así la interpreta en la hora LOCAL DE QUIEN LA LEE, y el
     * contenedor de producción va en UTC: las 7 se guardaban como las 7 UTC, o
     * sea las 9 de Madrid. En local no se veía porque mi reloj ya es de Madrid
     * — el fallo solo aparecía en el servidor.
     *
     * Con `buildMadridDate` la hora que se teclea es la hora de Madrid siempre,
     * la lea quien la lea y esté el servidor donde esté; y resuelve solo el
     * cambio de hora (+02:00 en verano, +01:00 en invierno).
     */
    const startAt = instanteDeMadrid(body.startDate, body.startTime, body.startAt);
    const endAt = instanteDeMadrid(body.endDate, body.endTime, body.endAt);
    if (!startAt) return error("La fecha u hora de inicio no es válida", 422);
    if (!endAt) return error("La fecha u hora de fin no es válida", 422);
    if (endAt <= startAt) return error("La fecha de fin tiene que ser posterior a la de inicio", 422);

    let teamMemberId = null;
    const tmId = typeof body.teamMemberId === "string" && body.teamMemberId.trim() ? body.teamMemberId.trim() : null;
    if (tmId) {
      if (!UUID_RE.test(tmId)) return error("teamMemberId inválido", 422);
      if (TeamMember) {
        const tm = await TeamMember.findByPk(tmId, { attributes: ["id"] });
        if (!tm) return error("Esa persona no está en el equipo", 422);
      }
      teamMemberId = tmId;
    }

    const label = (body.label ? String(body.label).trim() : "").slice(0, 120) || "Vacaciones";
    const notes = body.notes ? String(body.notes).trim() : null;

    const fila = await TeamBlock.create({
      teamMemberId,
      startAt,
      endAt,
      label,
      notes,
      createdById: request.headers.get("x-user-id") || null,
    });

    // Citas que ya estaban dentro del tramo: NO se tocan, pero se cuentan para
    // que la pantalla pueda avisar de que hay que reubicarlas.
    let citasDentro = 0;
    if (Booking) {
      const donde = {
        scheduledAt: { [Op.gte]: startAt, [Op.lt]: endAt },
        status: { [Op.notIn]: ["cancelled", "no_show"] },
      };
      // Si el bloqueo es de una persona, solo cuentan SUS citas.
      if (teamMemberId) donde.teamMemberId = teamMemberId;
      citasDentro = await Booking.count({ where: donde });
    }

    await logCitasAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "citas.bloqueo_created",
      entity: "TeamBlock",
      entityId: fila.id,
      after: { teamMemberId, startAt, endAt, label },
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    return created({ ...serializa(fila), citasDentro });
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin puede quitar bloqueos");
    const { TeamBlock } = ctx.tenantModels;
    if (!TeamBlock) return error("Los bloqueos no están disponibles en este cliente", 503);

    const id = String(new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const fila = await TeamBlock.findByPk(id);
    if (!fila) return ok({ removed: false }); // idempotente

    const antes = { teamMemberId: fila.teamMemberId, startAt: fila.startAt, endAt: fila.endAt, label: fila.label };
    await fila.destroy();

    await logCitasAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "citas.bloqueo_deleted",
      entity: "TeamBlock",
      entityId: id,
      before: antes,
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    return ok({ removed: true });
  } catch (err) {
    return serverError(err);
  }
});
