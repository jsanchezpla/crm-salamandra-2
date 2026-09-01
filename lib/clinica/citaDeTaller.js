/**
 * lib/clinica/citaDeTaller.js — una cita que es un taller: quién la da y quién
 * va (01/09/2026, Aumenta por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: lo necesitan el alta de una cita, el modal
 * que la abre en la agenda, el calendario y el registro de la sesión. La regla
 * de «quién se considera asistente» tiene que salir igual en los cuatro: si se
 * copia, un día la lista de la agenda y la del registro dirán cosas distintas y
 * habrá niños con registro de una tarde a la que no fueron.)
 *
 * ── QUÉ ES UNA CITA DE TALLER ───────────────────────────────────────────────
 * Una fila de `bookings` con `taller_grupo_id` puesto y `patient_id` a NULL. No
 * tiene UN paciente porque tiene ocho, y en la agenda se pidió que fuese UNA
 * caja y no ocho apiladas a la misma hora. La lista de quién va vive en
 * `taller_asistencias`, una fila por niño; quién la da, en
 * `taller_cita_terapeutas`.
 *
 * ── LA LISTA SE COPIA AL CREAR LA CITA, NO SE LEE DEL GRUPO ─────────────────
 * Y esto es lo importante de todo el fichero. Al apuntar la cita se copian los
 * inscritos de ese momento; a partir de ahí, la lista de esa tarde va por su
 * cuenta. Si se leyera del grupo en vivo, dar de baja a un niño en enero lo
 * borraría de todas las tardes de octubre a las que sí fue —y con él, su
 * registro de sesión y su falta—. El pasado se queda quieto.
 */

import { terapeutasDeGrupo } from "./grupoDeTaller.js";

/** 42P01 = la tabla no existe en este schema (tenant sin la migración). */
const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

/** ¿Este tipo de cita es un grupo de taller? */
export function grupoDeTipoDeCita(eventType) {
  const j = eventType?.toJSON ? eventType.toJSON() : eventType ?? {};
  return typeof j.tallerGrupoId === "string" && j.tallerGrupoId ? j.tallerGrupoId : null;
}

/** ¿Esta cita es un taller? */
export function esCitaDeTaller(booking) {
  const j = booking?.toJSON ? booking.toJSON() : booking ?? {};
  return Boolean(j.tallerGrupoId);
}

/**
 * Los pacientes apuntados AHORA a un grupo. Es de aquí de donde sale la lista
 * de asistencia de una cita nueva.
 */
export async function inscritosDeGrupo({ tenantModels, grupoId }) {
  const { TallerInscripcion } = tenantModels;
  if (!TallerInscripcion || !grupoId) return [];
  try {
    const filas = await TallerInscripcion.findAll({
      where: { grupoId, leftAt: null },
      attributes: ["patientId"],
      raw: true,
    });
    return [...new Set(filas.map((f) => f.patientId).filter(Boolean))];
  } catch (err) {
    if (tablaAusente(err)) return [];
    throw err;
  }
}

/**
 * Monta la cita de taller recién creada: su lista de asistencia y quién la
 * imparte.
 *
 * Idempotente: se puede volver a llamar sobre una cita que ya los tenga (por
 * ejemplo al reconstruir una que se quedó a medias) y no duplica — los índices
 * únicos de la base lo garantizan y aquí se filtra antes.
 *
 * @returns {{ asistentes: number, impartidores: number }}
 */
export async function montarCitaDeTaller({ tenantModels, booking, grupoId }) {
  const { TallerAsistencia, TallerCitaTerapeuta } = tenantModels;
  if (!booking?.id || !grupoId) return { asistentes: 0, impartidores: 0 };

  let asistentes = 0;
  let impartidores = 0;

  try {
    if (TallerAsistencia) {
      const yaEstan = await TallerAsistencia.findAll({
        where: { bookingId: booking.id },
        attributes: ["patientId"],
        raw: true,
      });
      const puestos = new Set(yaEstan.map((f) => f.patientId));
      const pacientes = (await inscritosDeGrupo({ tenantModels, grupoId })).filter((p) => !puestos.has(p));
      if (pacientes.length) {
        await TallerAsistencia.bulkCreate(
          // Nacen como `prevista`: están apuntados y todavía nadie ha dicho si
          // vinieron. Es exactamente el estado de una cita del día que viene.
          pacientes.map((patientId) => ({ bookingId: booking.id, patientId, grupoId, status: "prevista" }))
        );
        asistentes = pacientes.length;
      }
    }

    if (TallerCitaTerapeuta) {
      const yaEstan = await TallerCitaTerapeuta.findAll({
        where: { bookingId: booking.id },
        attributes: ["teamMemberId"],
        raw: true,
      });
      const puestos = new Set(yaEstan.map((f) => f.teamMemberId));
      const equipo = (await terapeutasDeGrupo({ tenantModels, grupoId })).filter((m) => !puestos.has(m));
      if (equipo.length) {
        await TallerCitaTerapeuta.bulkCreate(
          equipo.map((teamMemberId) => ({ bookingId: booking.id, teamMemberId }))
        );
        impartidores = equipo.length;
      }
    }
  } catch (err) {
    if (!tablaAusente(err)) throw err;
  }

  return { asistentes, impartidores };
}

/**
 * Los ids de las citas de taller que ESTA persona imparte en un rango.
 *
 * ── PARA QUÉ, Y POR QUÉ HACÍA FALTA ─────────────────────────────────────────
 * La agenda de quien no es dirección se filtra por `bookings.team_member_id`
 * (`lib/citas/visibilidad.js`): ve lo suyo y lo que no es de nadie. Una cita de
 * taller solo puede tener UN dueño ahí —hace falta para el color y para que el
 * solape se compruebe contra una agenda—, así que sin esto la segunda terapeuta
 * de un taller no lo vería en su calendario. Y estuvo dándolo.
 *
 * Se acota por fechas a propósito: son las citas de UNA semana en pantalla, no
 * las de toda la vida de esa persona.
 *
 * Devuelve `[]` sin reventar cuando el centro no tiene talleres migrados: la
 * agenda se pinta igual, solo que sin esta ampliación.
 */
export async function citasDeTallerQueImparte({ tenantModels, teamMemberId, desde, hasta }) {
  const { TallerCitaTerapeuta, Booking } = tenantModels;
  if (!TallerCitaTerapeuta || !Booking || !teamMemberId) return [];
  try {
    const { Op } = await import("sequelize");
    const filas = await TallerCitaTerapeuta.findAll({
      where: { teamMemberId },
      attributes: ["bookingId"],
      include: [
        {
          model: Booking,
          as: "cita",
          attributes: [],
          required: true,
          where: desde && hasta ? { scheduledAt: { [Op.gte]: desde, [Op.lt]: hasta } } : undefined,
        },
      ],
      raw: true,
    });
    return [...new Set(filas.map((f) => f.bookingId).filter(Boolean))];
  } catch (err) {
    if (tablaAusente(err)) return [];
    throw err;
  }
}

/**
 * Cuántos asistentes tiene cada una de estas citas, y cuántos consta que
 * vinieron: `Map<bookingId, { total, vinieron }>`.
 *
 * De una sola consulta para toda la semana: es lo que pinta el «(8)» de la caja
 * en la agenda, y con un viaje por cita serían cien viajes por pantalla.
 */
export async function conteoDeAsistentes({ tenantModels, bookingIds }) {
  const { TallerAsistencia } = tenantModels;
  const vacio = new Map();
  if (!TallerAsistencia || !Array.isArray(bookingIds) || !bookingIds.length) return vacio;
  try {
    const filas = await TallerAsistencia.findAll({
      where: { bookingId: bookingIds },
      attributes: ["bookingId", "status"],
      raw: true,
    });
    for (const f of filas) {
      const acc = vacio.get(f.bookingId) ?? { total: 0, vinieron: 0 };
      acc.total += 1;
      if (f.status === "asistio") acc.vinieron += 1;
      vacio.set(f.bookingId, acc);
    }
    return vacio;
  } catch (err) {
    if (tablaAusente(err)) return vacio;
    throw err;
  }
}

/**
 * Todo lo que la pantalla necesita de una cita de taller: el grupo, quién la
 * imparte y la lista de asistencia con nombres.
 *
 * Devuelve `null` si la cita no es un taller, para que quien lo llame no tenga
 * que preguntarlo dos veces.
 */
export async function detalleDeCitaDeTaller({ tenantModels, booking }) {
  const grupoId = booking?.tallerGrupoId;
  if (!grupoId) return null;

  const { TallerGrupo, Taller, TallerAsistencia, TallerCitaTerapeuta, TallerSesion, Patient, TeamMember } =
    tenantModels;

  try {
    const grupo = TallerGrupo
      ? await TallerGrupo.findByPk(grupoId, { include: Taller ? [{ model: Taller, as: "taller" }] : [] })
      : null;

    const asistencias = TallerAsistencia
      ? await TallerAsistencia.findAll({
          where: { bookingId: booking.id },
          include: Patient ? [{ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"] }] : [],
        })
      : [];

    const impartidores = TallerCitaTerapeuta
      ? await TallerCitaTerapeuta.findAll({
          where: { bookingId: booking.id },
          include: TeamMember
            ? [{ model: TeamMember, as: "profesional", attributes: ["id", "displayName", "avatarColor"] }]
            : [],
        })
      : [];

    // El registro de esa tarde, si ya se escribió. Es lo que hace que el botón
    // diga «Ver registro» en vez de «Registrar sesión».
    const sesion = TallerSesion ? await TallerSesion.findOne({ where: { bookingId: booking.id } }) : null;

    return {
      grupo: grupo
        ? {
            id: grupo.id,
            name: grupo.name,
            tallerId: grupo.tallerId,
            tallerName: grupo.taller?.name ?? null,
            schedule: grupo.schedule ?? null,
            duration: grupo.duration ?? null,
            capacity: grupo.capacity ?? null,
          }
        : null,
      impartidores: impartidores.map((i) => ({
        teamMemberId: i.teamMemberId,
        displayName: i.profesional?.displayName ?? null,
        avatarColor: i.profesional?.avatarColor ?? null,
      })),
      asistentes: asistencias
        .map((a) => ({
          id: a.id,
          patientId: a.patientId,
          nombre: [a.patient?.firstName, a.patient?.lastName].filter(Boolean).join(" ") || "—",
          status: a.status,
          justified: a.justified,
          noShowReason: a.noShowReason ?? null,
        }))
        .sort((x, y) => x.nombre.localeCompare(y.nombre, "es")),
      sesion: sesion ? { id: sesion.id, status: sesion.status } : null,
    };
  } catch (err) {
    if (tablaAusente(err)) return null;
    throw err;
  }
}

/**
 * Los pacientes de una cita que constan como que VINIERON. Es la lista a la que
 * se le copia el registro del grupo (`lib/clinica/propagarTaller.js`).
 *
 * Los que faltaron no reciben registro, y eso es lo correcto: no se le puede
 * dejar a un niño en su historia clínica una sesión a la que no fue.
 */
export async function asistentesQueVinieron({ tenantModels, bookingId }) {
  const { TallerAsistencia } = tenantModels;
  if (!TallerAsistencia || !bookingId) return [];
  try {
    const filas = await TallerAsistencia.findAll({
      where: { bookingId, status: "asistio" },
      attributes: ["patientId"],
      raw: true,
    });
    return filas.map((f) => f.patientId);
  } catch (err) {
    if (tablaAusente(err)) return [];
    throw err;
  }
}
