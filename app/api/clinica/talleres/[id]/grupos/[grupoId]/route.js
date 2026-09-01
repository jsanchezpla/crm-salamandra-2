import { withTenant } from "../../../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, error } from "../../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../../lib/utils/auditoria.js";
import { asegurarTipoDeCitaDeGrupo } from "../../../../../../../lib/clinica/tipoCitaTaller.js";
import { serializarGrupo, guardarTerapeutas, limpiarIds } from "../../../../../../../lib/clinica/grupoDeTaller.js";

/**
 * La ficha de UN grupo: quién lo imparte, quién va, qué se le cobra y sus
 * sesiones (01/09/2026).
 *
 * Aquí es donde se hace lo que pidió Rodrigo: «en la propia pestaña de talleres
 * se marca quién o quiénes imparten y qué pacientes van».
 */

const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

async function traerGrupo(tenantModels, tallerId, grupoId) {
  const { TallerGrupo, TallerGrupoTerapeuta, TeamMember } = tenantModels;
  return TallerGrupo.findOne({
    where: { id: grupoId, tallerId },
    include: [
      {
        model: TallerGrupoTerapeuta,
        as: "terapeutas",
        include: [{ model: TeamMember, as: "profesional", attributes: ["id", "displayName", "avatarColor"] }],
      },
    ],
  });
}

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller, TallerInscripcion, TallerSesion, Patient, TeamMember, BillingConcept, Cuota } = tenantModels;
  const { id, grupoId } = await params;

  try {
    const taller = await Taller.findByPk(id);
    if (!taller) return notFound("Taller no encontrado");
    const grupo = await traerGrupo(tenantModels, id, grupoId);
    if (!grupo) return notFound("Ese grupo no es de este taller");

    const inscripciones = await TallerInscripcion.findAll({
      where: { grupoId },
      order: [["joinedAt", "DESC"]],
      include: [{ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"] }],
    });

    /*
     * El estado de la cuota de cada uno. Es la mitad de «así se complementan la
     * zona de pago y las citas»: en la lista de apuntados hay que poder ver de
     * un vistazo quién está pagando el taller y quién no.
     */
    const cuotaIds = [...new Set(inscripciones.map((i) => i.cuotaId).filter(Boolean))];
    const cuotas = new Map();
    if (Cuota && cuotaIds.length) {
      try {
        const filas = await Cuota.findAll({
          where: { id: cuotaIds },
          attributes: ["id", "active", "amount", "startDate", "endDate"],
          raw: true,
        });
        for (const c of filas) cuotas.set(c.id, c);
      } catch (e) {
        if (!tablaAusente(e)) throw e;
      }
    }

    // El concepto con el que se cobra: el del grupo si lo tiene, si no el de la
    // actividad (ver `lib/clinica/cuotaDeTaller.js`).
    const conceptId = grupo.conceptId || taller.conceptId || null;
    let concepto = null;
    if (conceptId && BillingConcept) {
      try {
        concepto = await BillingConcept.findByPk(conceptId, {
          attributes: ["id", "name", "unitPrice", "periodicity"],
          raw: true,
        });
      } catch (e) {
        if (!tablaAusente(e)) throw e;
      }
    }

    /*
     * Su tipo de cita: es lo que hay que decirle a quien mire la ficha para que
     * sepa qué buscar en el desplegable de la agenda. Sin esto, el grupo se
     * puede apuntar pero nadie sabe con qué nombre.
     */
    const { EventType } = tenantModels;
    let tipoCita = null;
    if (EventType) {
      try {
        tipoCita = await EventType.findOne({
          where: { tallerGrupoId: grupoId },
          attributes: ["id", "name", "active"],
          raw: true,
        });
      } catch (e) {
        if (!tablaAusente(e)) throw e;
      }
    }

    const sesiones = TallerSesion
      ? await TallerSesion.findAll({
          where: { grupoId },
          order: [["sessionDate", "DESC"]],
          limit: 60,
          include: [{ model: TeamMember, as: "profesional", attributes: ["id", "displayName"] }],
        })
      : [];

    const conCuota = (i) => {
      const j = i.toJSON();
      const c = j.cuotaId ? cuotas.get(j.cuotaId) ?? null : null;
      return {
        ...j,
        cuota: c ? { id: c.id, active: c.active, amount: c.amount, startDate: c.startDate, endDate: c.endDate } : null,
      };
    };

    return ok({
      taller: { id: taller.id, name: taller.name, active: taller.active },
      grupo: serializarGrupo(grupo, {
        apuntados: inscripciones.filter((i) => !i.leftAt).length,
        tipoCita,
      }),
      concepto,
      // Separados como en la ficha del taller: quién está AHORA es lo que se
      // mira; quién pasó por él es consulta de histórico.
      apuntados: inscripciones.filter((i) => !i.leftAt).map(conCuota),
      pasaron: inscripciones.filter((i) => i.leftAt).map(conCuota),
      sesiones: sesiones.map((s) => ({
        id: s.id,
        sessionDate: s.sessionDate,
        status: s.status,
        bookingId: s.bookingId ?? null,
        teamMemberName: s.profesional?.displayName ?? null,
      })),
    });
  } catch (err) {
    if (tablaAusente(err)) return ok({ sinMigrar: true });
    throw err;
  }
});

export const PUT = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller, TallerGrupo } = tenantModels;
  const { id, grupoId } = await params;
  const body = await request.json();

  const taller = await Taller.findByPk(id);
  if (!taller) return notFound("Taller no encontrado");
  const grupo = await TallerGrupo.findOne({ where: { id: grupoId, tallerId: id } });
  if (!grupo) return notFound("Ese grupo no es de este taller");

  const cambios = {};
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return error("El nombre del grupo es obligatorio", 422);
    const { Op } = await import("sequelize");
    const choca = await TallerGrupo.findOne({ where: { tallerId: id, name, id: { [Op.ne]: grupoId } } });
    if (choca) return error(`Ya hay un grupo «${name}» en este taller`, 409, { id: choca.id });
    cambios.name = name;
  }
  if ("schedule" in body) cambios.schedule = typeof body.schedule === "string" ? body.schedule.trim() || null : null;
  if ("notes" in body) cambios.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  if ("duration" in body) {
    const d = Number(body.duration);
    if (!Number.isFinite(d) || d < 1 || d > 480) return error("La duración tiene que estar entre 1 y 480 minutos", 422);
    cambios.duration = Math.round(d);
  }
  if ("color" in body) {
    cambios.color =
      typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color.trim()) ? body.color.trim() : null;
  }
  if ("capacity" in body) {
    const c = Number(body.capacity);
    cambios.capacity = Number.isFinite(c) && c > 0 ? Math.round(c) : null;
  }
  if ("conceptId" in body) cambios.conceptId = typeof body.conceptId === "string" && body.conceptId ? body.conceptId : null;
  if ("active" in body) cambios.active = !!body.active;

  await grupo.update(cambios);

  if ("terapeutas" in body) {
    await guardarTerapeutas({ tenantModels, grupo, ids: limpiarIds(body.terapeutas), coordinaId: body.coordinaId });
  }

  // El tipo de cita sigue al grupo: renombrarlo o cambiarle la duración tiene
  // que verse en la agenda sin tocar nada más.
  const tipoCita = await asegurarTipoDeCitaDeGrupo({ tenantModels, taller, grupo });

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "clinica.taller.grupo.actualizado",
    entity: "TallerGrupo",
    entityId: grupo.id,
    after: { tallerId: id, name: grupo.name, active: grupo.active },
  });

  const fresco = await traerGrupo(tenantModels, id, grupoId);
  return ok(serializarGrupo(fresco ?? grupo, { tipoCita }));
});

/**
 * Retirar un grupo. NO lo borra si pasó gente por él o si ya tiene citas: su
 * historial es de pacientes y de la agenda. Misma regla que retirar un taller.
 */
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller, TallerGrupo, TallerInscripcion, Booking } = tenantModels;
  const { id, grupoId } = await params;

  const taller = await Taller.findByPk(id);
  if (!taller) return notFound("Taller no encontrado");
  const grupo = await TallerGrupo.findOne({ where: { id: grupoId, tallerId: id } });
  if (!grupo) return notFound("Ese grupo no es de este taller");

  const usos = await TallerInscripcion.count({ where: { grupoId } });
  let citas = 0;
  if (Booking) {
    try {
      citas = await Booking.count({ where: { tallerGrupoId: grupoId } });
    } catch (e) {
      if (!tablaAusente(e)) throw e;
    }
  }

  if (usos > 0 || citas > 0) {
    await grupo.update({ active: false });
    await asegurarTipoDeCitaDeGrupo({ tenantModels, taller, grupo });
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "clinica.taller.grupo.retirado",
      entity: "TallerGrupo",
      entityId: grupo.id,
      before: { tallerId: id, name: grupo.name },
    });
    return ok({
      desactivado: true,
      usos,
      citas,
      mensaje: `Retirado: han pasado ${usos} paciente(s) y tiene ${citas} cita(s) en la agenda`,
    });
  }

  /*
   * Grupo virgen: se borra de verdad, y con él su tipo de cita. Aquí sí se
   * borra el tipo —y no solo se desactiva— porque no hay ninguna cita
   * apuntándole: un tipo apagado que no usó nadie es basura en el catálogo.
   */
  const { EventType } = tenantModels;
  if (EventType) {
    try {
      await EventType.destroy({ where: { tallerGrupoId: grupoId } });
    } catch (e) {
      if (!tablaAusente(e)) throw e;
    }
  }
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "clinica.taller.grupo.borrado",
    entity: "TallerGrupo",
    entityId: grupo.id,
    before: { tallerId: id, name: grupo.name },
  });
  await grupo.destroy();
  return ok({ eliminado: true });
});
