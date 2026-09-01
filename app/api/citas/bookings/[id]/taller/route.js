import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, error, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import { detalleDeCitaDeTaller, inscritosDeGrupo } from "../../../../../../lib/clinica/citaDeTaller.js";
import { abrirIncidenciaPorFalta } from "../../../../../../lib/citas/incidenciaPorFalta.js";
import { propagarSesionDeTaller } from "../../../../../../lib/clinica/propagarTaller.js";
import { etiquetaNotaDe } from "../../../../../../lib/clinica/tallerSesion.js";

/**
 * La lista de asistencia de una cita de taller (01/09/2026, Aumenta por
 * Rodrigo).
 *
 * Un taller es una cita a la que van ocho, y en la agenda es UNA caja: quién va
 * y si vino se gestiona aquí. Se marca uno a uno, con el mismo vocabulario que
 * una cita individual —vino / faltó justificada / faltó sin justificar—, y por
 * eso la falta entra por la misma puerta: abre incidencia igual que las demás.
 *
 * GET   → el grupo, quién lo imparte y la lista con su estado.
 * PATCH → marca la asistencia de uno, o vuelve a traerse a los inscritos del
 *         grupo (`sincronizar: true`) para el caso de siempre: se apunta a un
 *         niño el martes y la cita del jueves ya estaba creada.
 */

const ESTADOS = new Set(["prevista", "asistio", "no_show"]);

async function traerCita(tenantModels, id) {
  const { Booking } = tenantModels;
  return Booking.findByPk(id);
}

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const { id } = await params;
    const cita = await traerCita(tenantModels, id);
    if (!cita) return notFound("Cita no encontrada");
    if (!cita.tallerGrupoId) return error("Esa cita no es un taller", 409);

    const detalle = await detalleDeCitaDeTaller({ tenantModels, booking: cita });
    if (!detalle) return error("Este centro todavía no tiene los talleres al día", 409);
    return ok(detalle);
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const { TallerAsistencia } = tenantModels;
    if (!TallerAsistencia) return error("Este centro todavía no tiene los talleres al día", 409);

    const { id } = await params;
    const cita = await traerCita(tenantModels, id);
    if (!cita) return notFound("Cita no encontrada");
    if (!cita.tallerGrupoId) return error("Esa cita no es un taller", 409);

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    /*
     * ── Volver a traerse a los inscritos ─────────────────────────────────────
     * La lista de una cita se copió el día que se apuntó (a propósito: ver
     * `lib/clinica/citaDeTaller.js`). Cuando se apunta a alguien DESPUÉS, hay
     * que poder meterlo en las tardes que aún no han pasado — y eso lo pide una
     * persona, no lo hace el CRM por su cuenta: reescribir listas solo sería
     * justo lo que rompería el pasado.
     *
     * Solo AÑADE. A nadie que ya esté en la lista se le toca el estado.
     */
    if (body.sincronizar === true) {
      const actuales = await TallerAsistencia.findAll({
        where: { bookingId: id },
        attributes: ["patientId"],
        raw: true,
      });
      const puestos = new Set(actuales.map((f) => f.patientId));
      const nuevos = (await inscritosDeGrupo({ tenantModels, grupoId: cita.tallerGrupoId })).filter(
        (p) => !puestos.has(p)
      );
      if (nuevos.length) {
        await TallerAsistencia.bulkCreate(
          nuevos.map((patientId) => ({
            bookingId: id,
            patientId,
            grupoId: cita.tallerGrupoId,
            status: "prevista",
          }))
        );
      }
      const detalle = await detalleDeCitaDeTaller({ tenantModels, booking: cita });
      return ok({ ...detalle, añadidos: nuevos.length });
    }

    // ── Marcar la asistencia de UNO ─────────────────────────────────────────
    const asistenciaId = typeof body.asistenciaId === "string" ? body.asistenciaId.trim() : "";
    if (!asistenciaId) return error("Falta el asistente", 422);

    const fila = await TallerAsistencia.findOne({ where: { id: asistenciaId, bookingId: id } });
    if (!fila) return notFound("Ese asistente no es de esta cita");

    const status = typeof body.status === "string" ? body.status : null;
    if (!status || !ESTADOS.has(status)) return error("Estado inválido", 422);

    const antes = fila.status;
    const cambios = { status };
    if (status === "no_show") {
      // Tri-estado, igual que en `bookings`: null = sin clasificar.
      cambios.justified = typeof body.justified === "boolean" ? body.justified : null;
      cambios.noShowReason = typeof body.noShowReason === "string" ? body.noShowReason.trim() || null : null;
    } else {
      // Dejar de ser una falta limpia lo que era de la falta: si no, un niño
      // marcado por error como ausente se quedaría con el motivo colgando.
      cambios.justified = null;
      cambios.noShowReason = null;
    }
    await fila.update(cambios);

    /*
     * ── La falta abre incidencia, como en una cita individual ────────────────
     * Misma regla y mismo fichero (`lib/citas/incidenciaPorFalta.js`): las DOS
     * faltas —justificada y no— se gestionan, y quien las gestiona es
     * administración. Best-effort: si falla, la asistencia queda marcada igual.
     */
    let incidencia = null;
    if (status === "no_show" && antes !== "no_show") {
      /*
       * Se le pasa la cita CON la falta de este niño encima. La función espera
       * una cita («¿de quién es la falta, cuándo era y estaba justificada?») y
       * en un taller esos tres datos son: el paciente de esta fila, la hora de
       * la cita del grupo y lo que se acaba de marcar. Así el texto de la
       * incidencia sale con el nombre del niño y no con el del taller.
       */
      incidencia = await abrirIncidenciaPorFalta({
        tenant,
        tenantModels,
        hasModule,
        booking: {
          id: cita.id,
          patientId: fila.patientId,
          clientName: cita.clientName,
          scheduledAt: cita.scheduledAt,
          noShowJustified: cambios.justified === true,
          noShowReason: cambios.noShowReason,
        },
      });
      if (incidencia?.id) await fila.update({ incidenciaId: incidencia.id });
    }

    /*
     * ── Y el registro de esa tarde sigue a la lista ──────────────────────────
     * El registro común del taller se copia SOLO a quien vino. Marcar una falta
     * después de haberlo escrito le quita a ese niño su copia, y marcarlo como
     * presente se la da: no se le puede dejar en la historia clínica una sesión
     * a la que no fue, ni quitarle una a la que sí.
     *
     * Solo si ya hay registro escrito; si no, no hay nada que repartir.
     */
    let registro = null;
    const { TallerSesion, ClinicSession } = tenantModels;
    if (TallerSesion) {
      const sesion = await TallerSesion.findOne({ where: { bookingId: id } });
      if (sesion) {
        const vinieron = await TallerAsistencia.findAll({
          where: { bookingId: id, status: "asistio" },
          attributes: ["patientId"],
          raw: true,
        });
        /*
         * El título del apartado privado se lee de lo que YA hay escrito. Sin
         * esto, re-propagar desde aquí le pondría a los ocho el rótulo de
         * fábrica encima del que el centro puso al escribir el registro.
         */
        let etiquetaNota = "";
        if (ClinicSession) {
          const una = await ClinicSession.findOne({
            where: { tallerSesionId: sesion.id },
            attributes: ["contentSections"],
          });
          if (una) etiquetaNota = etiquetaNotaDe(una.contentSections);
        }
        registro = await propagarSesionDeTaller({
          tenantModels,
          sesionTaller: sesion,
          // Nota vacía = «conserva la que tuviera». La nota individual de cada
          // niño no se toca nunca al pasar lista.
          asistentes: vinieron.map((v) => ({ patientId: v.patientId, nota: "" })),
          etiquetaNota,
        });
      }
    }

    await logCitasAudit({
      tenantId: tenant.id,
      userId: request.headers.get("x-user-id") ?? null,
      action: "citas.taller_asistencia",
      entity: "TallerAsistencia",
      entityId: fila.id,
      before: { status: antes },
      // Sin nombres: la auditoría vive en master y aquí hay datos de menores.
      after: { status, justified: cambios.justified ?? null, bookingId: id },
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    const detalle = await detalleDeCitaDeTaller({ tenantModels, booking: cita });
    return ok({ ...detalle, incidenciaAbierta: Boolean(incidencia), registro });
  } catch (err) {
    return serverError(err);
  }
});
