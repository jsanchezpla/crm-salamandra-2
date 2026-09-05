import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { madridToday } from "../../../../../lib/utils/madridDate.js";

/**
 * GET/POST /api/pacientes/[id]/desprogramar — quitarle a un paciente sus citas
 * a partir de una fecha, de una vez.
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * AV-0049 (Aumenta, Olga García, 04/09/2026): «al dar de alta en agenda un
 * paciente y programar para todas las semanas, al querer desprogramar no
 * podemos hacerlo; tendríamos que eliminar cita por cita semanalmente.
 * Queremos poder indicarle, al igual que al programar dando de alta,
 * desprogramar para dar de baja».
 *
 * Repetir una cita NO crea una «serie»: crea N citas independientes, a
 * propósito (`lib/citas/recurrencia.js` explica por qué). Así que no hay tanda
 * que deshacer. Lo que sí hay siempre es un PACIENTE y una FECHA, y eso es lo
 * que de verdad querían: dar de baja a un niño a mitad de curso sin abrir
 * cuarenta citas. Vale además para las citas que nunca vinieron de una
 * repetición, que la «serie» no habría cubierto.
 *
 * ── LO QUE HACE Y LO QUE NO ────────────────────────────────────────────────
 *   · CANCELA, no borra: la cita cancelada libera el hueco y se queda en el
 *     histórico, que es lo que distingue «se dio de baja» de «nunca existió».
 *   · Solo hacia ADELANTE (`desde`, por defecto hoy en Madrid). El pasado es
 *     lo que pasó y no se toca ni por error de dedo.
 *   · Solo las que están vivas (`pending` y `confirmed`): una completada, una
 *     falta o una ya cancelada se quedan como están.
 *   · **NO manda ni un correo.** La cancelación de UNA cita avisa a la familia;
 *     cuarenta correos de golpe por una baja que ya se ha hablado en el centro
 *     serían cuarenta llamadas al día siguiente. La pantalla lo dice antes de
 *     confirmar: avisar a la familia es cosa de quien da la baja.
 *   · Tampoco abre incidencias por falta: esto no es que nadie viniera, es que
 *     la cita ya no toca.
 *
 * Una línea de auditoría con el recuento, no cuarenta.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Las que siguen en pie. Lo demás ya está resuelto de una forma o de otra. */
const VIVAS = ["pending", "confirmed"];

function gate(ctx) {
  return ctx.hasModule("citas") && (ctx.hasModule("clinica") || ctx.hasModule("pacientes"));
}

/** El instante desde el que se corta: las 00:00 de esa fecha, hora local. */
function desdeDe(valor) {
  const fecha = FECHA_RE.test(String(valor ?? "")) ? String(valor) : madridToday();
  return { fecha, instante: new Date(`${fecha}T00:00:00`) };
}

/** Cuántas citas vivas tiene por delante — para poder decirlo ANTES de tocar nada. */
export const GET = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulos Citas y Clínica no activos");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { Patient, Booking } = ctx.tenantModels;
    const paciente = await Patient.findByPk(id, { attributes: ["id"] });
    if (!paciente) return notFound("Paciente no encontrado");

    const { fecha, instante } = desdeDe(new URL(request.url).searchParams.get("desde"));
    const futuras = await Booking.count({
      where: { patientId: id, status: { [Op.in]: VIVAS }, scheduledAt: { [Op.gte]: instante } },
    });
    return ok({ desde: fecha, futuras });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulos Citas y Clínica no activos");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { tenant, tenantModels } = ctx;
    const { Patient, Booking } = tenantModels;
    const paciente = await Patient.findByPk(id, { attributes: ["id"] });
    if (!paciente) return notFound("Paciente no encontrado");

    const body = await request.json().catch(() => ({}));
    const { fecha, instante } = desdeDe(body?.desde);
    const motivo = typeof body?.motivo === "string" && body.motivo.trim()
      ? body.motivo.trim().slice(0, 500)
      : "Baja del paciente";

    const [quitadas] = await Booking.update(
      { status: "cancelled", cancelledAt: new Date(), cancellationReason: motivo },
      { where: { patientId: id, status: { [Op.in]: VIVAS }, scheduledAt: { [Op.gte]: instante } } }
    );

    // DESPUÉS de mutar y con el RECUENTO, no la fila entera: son datos de salud.
    if (quitadas) {
      await auditar({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "citas.desprogramadas_en_bloque",
        entity: "Booking",
        entityId: null,
        after: { pacienteId: id, citas: quitadas, desde: fecha, motivo },
      });
    }

    return ok({ quitadas, desde: fecha, motivo });
  } catch (err) {
    return serverError(err);
  }
});
