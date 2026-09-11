/**
 * /api/citas/bookings/[id]/siguientes — «esta y las siguientes» de una cita
 * que se repite (11/09/2026, Aumenta: AV-0107, AV-0118, AV-0054, AV-0105).
 *
 *   GET   ?anterior=ISO   cuántas citas iguales a esta vienen después y hasta
 *                         cuándo. `anterior` es la hora ANTES de moverla
 *                         (opcional): si la ficha ya la ha cambiado, las
 *                         hermanas se buscan por la hora que tenía.
 *   POST  { scheduledAtAnterior, scheduledAt }
 *                         mueve las siguientes igual que se movió esta: los
 *                         mismos días de calendario y a la misma hora de
 *                         pared. Sin correos. La que choca con otra cita de la
 *                         misma profesional se salta y se cuenta.
 *
 * No hay serie: «las siguientes» se deducen (lib/citas/siguientesIguales.js).
 * Por eso la pantalla enseña el número ANTES y pregunta, y por eso se mueve
 * una a una con el mismo freno de solape que el PATCH de una cita.
 */
import { Op } from "sequelize";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { findBookingOverlap } from "../../../../../../lib/citas/booking.js";
import { resolveCurrentTeamMemberId } from "../../../../../../lib/team/currentTeamMember.js";
import { veTodaLaAgenda, esSuya } from "../../../../../../lib/citas/visibilidad.js";
import {
  desplazamiento,
  esCitaSiguiente,
  fechaCorta,
  instanteMovido,
  ventanaDeBusqueda,
} from "../../../../../../lib/citas/siguientesIguales.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIVAS = ["pending", "confirmed"];

/** La misma valla que el PATCH de la cita: quien no ve toda la agenda solo toca las suyas. */
async function noPuedeTocarla(request, ctx, row) {
  const { tenant, tenantModels, tenantHasModule } = ctx;
  if (!tenantHasModule("team")) return null;
  const role = request.headers.get("x-user-role") ?? "user";
  if (veTodaLaAgenda({ tenant, role })) return null;
  const myId = await resolveCurrentTeamMemberId(request, tenantModels);
  if (!esSuya(row, myId)) return notFound("Cita no encontrada");
  return null;
}

const fecha = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Las siguientes de `base` (con `scheduledAt` ya puesto a la hora que manda). */
async function siguientesDe(Booking, base) {
  const candidatas = await Booking.findAll({
    where: {
      eventTypeId: base.eventTypeId ?? null,
      teamMemberId: base.teamMemberId ?? null,
      status: { [Op.in]: VIVAS },
      scheduledAt: ventanaDeBusqueda(Op, base.scheduledAt),
    },
    order: [["scheduledAt", "ASC"]],
  });
  return candidatas.filter((c) => esCitaSiguiente(base, c.toJSON ? c.toJSON() : c));
}

export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");
    const { Booking } = ctx.tenantModels;
    const row = await Booking.findByPk(id);
    if (!row) return notFound("Cita no encontrada");
    const veto = await noPuedeTocarla(request, ctx, row);
    if (veto) return veto;

    const anterior = fecha(new URL(request.url).searchParams.get("anterior"));
    const base = { ...row.toJSON(), ...(anterior ? { scheduledAt: anterior } : {}) };
    const lista = await siguientesDe(Booking, base);
    return ok({ siguientes: lista.length, hasta: lista.length ? fechaCorta(lista[lista.length - 1].scheduledAt) : null });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id } = await params;
    if (!UUID_RE.test(id)) return error("id inválido");
    const { Booking } = ctx.tenantModels;
    const row = await Booking.findByPk(id);
    if (!row) return notFound("Cita no encontrada");
    const veto = await noPuedeTocarla(request, ctx, row);
    if (veto) return veto;

    const body = await request.json().catch(() => ({}));
    const anterior = fecha(body?.scheduledAtAnterior);
    const nuevo = fecha(body?.scheduledAt) ?? fecha(row.scheduledAt);
    if (!anterior || !nuevo) return error("Hace falta la hora anterior y la nueva", 422);
    if (anterior.getTime() === nuevo.getTime()) return ok({ movidas: 0, saltadas: [] });

    const base = { ...row.toJSON(), scheduledAt: anterior };
    const lista = await siguientesDe(Booking, base);
    const salto = desplazamiento(anterior, nuevo);

    let movidas = 0;
    const saltadas = [];
    for (const cita of lista) {
      const destino = instanteMovido(cita.scheduledAt, salto);
      const choca = await findBookingOverlap(Booking, {
        scheduledAt: destino,
        duration: cita.duration,
        excludeId: cita.id,
        teamMemberId: cita.teamMemberId,
      });
      if (choca) {
        saltadas.push({ fecha: fechaCorta(cita.scheduledAt), motivo: "ya hay otra cita a esa hora" });
        continue;
      }
      await cita.update({ scheduledAt: destino });
      movidas += 1;
    }

    // Una línea con el recuento, no cuarenta, y sin la fila entera: son datos de salud.
    if (movidas) {
      await auditar({
        tenantId: ctx.tenant.id,
        ...datosPeticion(request),
        action: "citas.movidas_en_bloque",
        entity: "Booking",
        entityId: row.id,
        after: { citas: movidas, saltadas: saltadas.length, dias: salto.dias, hora: salto.hhmm },
      });
    }

    return ok({ movidas, saltadas, hasta: lista.length ? fechaCorta(lista[lista.length - 1].scheduledAt) : null });
  } catch (err) {
    return serverError(err);
  }
});
