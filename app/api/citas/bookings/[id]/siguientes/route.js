/**
 * /api/citas/bookings/[id]/siguientes — «esta y las siguientes» de una cita
 * que se repite (11/09/2026, Aumenta: AV-0107, AV-0118, AV-0054, AV-0105;
 * ampliado el 12/09/2026 a cancelar y borrar, por Rodrigo).
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
 *   POST  { accion: "cancelar", motivo }
 *                         cancela las siguientes. Mismo camino que cancelar
 *                         una (retira el borrador de sesión y resuelve su
 *                         dinero), pero SIN correo: cuarenta avisos de golpe
 *                         por una baja ya hablada en el centro son cuarenta
 *                         llamadas al día siguiente. Igual que la baja de un
 *                         paciente (`/api/pacientes/[id]/desprogramar`).
 *   DELETE                borra las siguientes para siempre, con la misma
 *                         regla que borrar una (`lib/citas/borrarCita.js`): la
 *                         que tenga dinero de por medio se queda y se cuenta.
 *
 * ── ESTA CITA NO SE TOCA AQUÍ ──────────────────────────────────────────────
 * Las tres operaciones actúan SOLO sobre las siguientes. La de la que se parte
 * la mueve, cancela o borra quien llama, por su camino de siempre —con su
 * correo, su reembolso y su línea de auditoría—, y así lo que ya funcionaba
 * para una cita sigue siendo exactamente lo mismo. El orden importa al borrar:
 * primero las siguientes (se DEDUCEN de esta, que tiene que existir todavía) y
 * esta al final.
 *
 * No hay serie: «las siguientes» se deducen (lib/citas/siguientesIguales.js).
 * Por eso la pantalla enseña el número ANTES y pregunta, y por eso se hace una
 * a una con los mismos frenos que la de una sola cita.
 */
import { Op } from "sequelize";
import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { findBookingOverlap } from "../../../../../../lib/citas/booking.js";
import { borrarCitaDeVerdad } from "../../../../../../lib/citas/borrarCita.js";
import { reembolsarCitaSiProcede } from "../../../../../../lib/citas/reembolsoCita.js";
import { retirarBorradoresDeLaCita } from "../../../../../../lib/clinica/borradorDeCita.js";
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

/**
 * Una fecha, o nada.
 *
 * El `null` y la cadena vacía se descartan ANTES de construir la fecha
 * (12/09/2026): `new Date(null)` no es una fecha inválida, es el 1 de enero de
 * 1970. Con eso, un `GET` sin `?anterior=` buscaba las hermanas de una cita de
 * 1970 y contestaba SIEMPRE «0 siguientes»: la pregunta del 11/09 no llegó a
 * salir ni una vez en la ficha de la cita.
 */
const fecha = (v) => {
  if (v === null || v === undefined || v === "") return null;
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

/** Hasta cuándo llega la serie, para el texto de la pantalla. */
const hastaDe = (lista) => (lista.length ? fechaCorta(lista[lista.length - 1].scheduledAt) : null);

/** Las tres operaciones abren igual: módulo, id, cita y permiso. */
async function abrir(request, params, ctx) {
  if (!ctx.hasModule("citas")) return { veto: forbidden("Módulo citas no activo") };
  const { id } = await params;
  if (!UUID_RE.test(id)) return { veto: error("id inválido") };
  const { Booking } = ctx.tenantModels;
  const row = await Booking.findByPk(id);
  if (!row) return { veto: notFound("Cita no encontrada") };
  const veto = await noPuedeTocarla(request, ctx, row);
  if (veto) return { veto };
  return { Booking, row };
}

export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    const { veto, Booking, row } = await abrir(request, params, ctx);
    if (veto) return veto;

    const anterior = fecha(new URL(request.url).searchParams.get("anterior"));
    const base = { ...row.toJSON(), ...(anterior ? { scheduledAt: anterior } : {}) };
    const lista = await siguientesDe(Booking, base);
    return ok({ siguientes: lista.length, hasta: hastaDe(lista) });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * Cancelar las siguientes, una a una y no con un UPDATE masivo: cancelar una
 * cita hace dos cosas más que cambiar el estado —retirar el borrador de sesión
 * que dejó preparado y resolver su dinero—, y en bloque es igual de cierto.
 * Las dos son best-effort: la cita ya está cancelada cuando se intentan.
 */
async function cancelarLasSiguientes({ request, ctx, Booking, row, motivo }) {
  const { tenantModels } = ctx;
  const lista = await siguientesDe(Booking, row.toJSON());
  const conClinica = ctx.tenantHasModule("clinica") || ctx.tenantHasModule("pacientes");
  let canceladas = 0;
  for (const cita of lista) {
    await cita.update({
      status: "cancelled",
      cancelledAt: new Date(),
      cancellationReason: motivo ?? cita.cancellationReason ?? null,
    });
    canceladas += 1;
    if (conClinica && tenantModels.ClinicSession) {
      try {
        await retirarBorradoresDeLaCita({ ClinicSession: tenantModels.ClinicSession, bookingId: cita.id });
      } catch (e) {
        console.warn("[siguientes] no se pudo retirar el borrador de la cita", e?.message);
      }
    }
    try {
      await reembolsarCitaSiProcede(ctx, cita, { quienCancela: "profesional" });
    } catch (e) {
      console.warn("[siguientes] no se pudo resolver el dinero de la cita", e?.message);
    }
  }

  // Una línea con el recuento, no cuarenta, y sin la fila entera: datos de salud.
  if (canceladas) {
    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "citas.canceladas_en_bloque",
      entity: "Booking",
      entityId: row.id,
      after: { citas: canceladas, motivo: motivo ?? null },
    });
  }

  return ok({ canceladas, saltadas: [], hasta: hastaDe(lista) });
}

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    const { veto, Booking, row } = await abrir(request, params, ctx);
    if (veto) return veto;

    const body = await request.json().catch(() => ({}));
    if (body?.accion === "cancelar") {
      const motivo = typeof body?.motivo === "string" && body.motivo.trim() ? body.motivo.trim().slice(0, 500) : null;
      return await cancelarLasSiguientes({ request, ctx, Booking, row, motivo });
    }

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

    return ok({ movidas, saltadas, hasta: hastaDe(lista) });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * Borrar las siguientes para siempre (12/09/2026, Rodrigo: «por si me he
 * equivocado»). Cada una pasa por `borrarCitaDeVerdad`, que es la misma regla
 * que borrar una sola: la que está cobrada, con retención o con devolución
 * registrada NO se borra —el rastro del dinero tiene que quedar— y se cuenta
 * para poder decir cuáles siguen ahí.
 *
 * Se llama ANTES de borrar la cita de la que se parte: las siguientes se
 * deducen de ella y necesita existir todavía.
 */
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    const { veto, Booking, row } = await abrir(request, params, ctx);
    if (veto) return veto;

    const lista = await siguientesDe(Booking, row.toJSON());
    let borradas = 0;
    const saltadas = [];
    for (const cita of lista) {
      const res = await borrarCitaDeVerdad({ tenantModels: ctx.tenantModels, row: cita });
      if (!res.ok) {
        saltadas.push({ fecha: fechaCorta(cita.scheduledAt), motivo: res.freno });
        continue;
      }
      borradas += 1;
    }

    if (borradas) {
      await auditar({
        tenantId: ctx.tenant.id,
        ...datosPeticion(request),
        action: "citas.borradas_en_bloque",
        entity: "Booking",
        entityId: row.id,
        after: { citas: borradas, saltadas: saltadas.length },
      });
    }

    return ok({ borradas, saltadas, hasta: hastaDe(lista) });
  } catch (err) {
    return serverError(err);
  }
});
