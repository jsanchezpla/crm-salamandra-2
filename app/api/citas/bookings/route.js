import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { filtrarCitas } from "../../../../lib/citas/dinero.js";
import {
  normalizeString,
  normalizeEmail,
  isValidEmail,
  VALID_MODALITIES,
} from "../../../../lib/citas/validation.js";
import { logCitasAudit } from "../../../../lib/citas/audit.js";
import { findBookingOverlap, noEsCarritoAbandonado } from "../../../../lib/citas/booking.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { meetUrlInicial } from "../../../../lib/citas/videollamada.js";
import { veTodaLaAgenda } from "../../../../lib/citas/visibilidad.js";
import { cargarFestivos, esFestivo } from "../../../../lib/citas/festivos.js";
import { cargarAusencias, minutosOcupados } from "../../../../lib/citas/ausencias.js";
import { getMadridParts } from "../../../../lib/citas/slots.js";
import { asignarSesion } from "../../../../lib/citas/packs.js";

const NADIE = "00000000-0000-0000-0000-000000000000";

const VALID_STATUS = new Set(["pending", "confirmed", "completed", "cancelled", "no_show"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El paciente sólo aplica en tenants con módulo Clínica/Pacientes (nutri_laura
// tiene citas pero NO tabla patients). Devuelve { patientId } o un error string.
async function resolvePatientId(body, tenantModels, hasModule) {
  if (!(hasModule("clinica") || hasModule("pacientes"))) return { patientId: null };
  const pid = typeof body.patientId === "string" && body.patientId.trim() ? body.patientId.trim() : null;
  if (!pid) return { patientId: null };
  if (!UUID_RE.test(pid)) return { err: "patientId inválido" };
  const { Patient } = tenantModels;
  if (!Patient) return { patientId: null };
  const p = await Patient.findByPk(pid, { attributes: ["id"] });
  if (!p) return { err: "patientId no existe" };
  return { patientId: pid };
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/citas/bookings — listado paginado
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const { Booking, EventType, TeamMember, Patient } = tenantModels;
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;

    const where = {};
    if (searchParams.get("from") || searchParams.get("to")) {
      where.scheduledAt = {};
      if (searchParams.get("from")) where.scheduledAt[Op.gte] = new Date(searchParams.get("from"));
      if (searchParams.get("to")) where.scheduledAt[Op.lte] = new Date(searchParams.get("to"));
    }
    // ?future=true filtra a partir de ahora (útil para "próximas citas" en la ficha cliente).
    // Convive con ?from: el MÁS RESTRICTIVO gana de verdad (arreglo 2026-07-23).
    // Antes se reasignaba Op.gte con `now`, que PISABA un `from` posterior y
    // devolvía citas de más; ahora se toma el máximo de los dos.
    if (searchParams.get("future") === "true") {
      const previo = where.scheduledAt?.[Op.gte];
      const desde = new Date(Math.max(Date.now(), previo ? new Date(previo).getTime() : 0));
      where.scheduledAt = { ...(where.scheduledAt || {}), [Op.gte]: desde };
    }
    if (searchParams.get("status")) {
      const s = searchParams.get("status");
      if (!VALID_STATUS.has(s)) return error("status inválido");
      where.status = s;
    }
    if (searchParams.get("eventTypeId")) where.eventTypeId = searchParams.get("eventTypeId");
    if (searchParams.get("teamMemberId")) where.teamMemberId = searchParams.get("teamMemberId");
    // ?patientId=… — citas de un paciente concreto (sección "Próximas citas" de su ficha).
    if (searchParams.get("patientId")) where.patientId = searchParams.get("patientId");
    // ?clientId=… — las citas de una ficha concreta. Desde 2026-07-22 hay FK
    // real (bookings.client_id). Se acepta además `clientEmail` en la misma
    // llamada y se buscan las que casen por CUALQUIERA de los dos: el enlace
    // nuevo no puede dejar fuera de la ficha las citas antiguas que se
    // quedaron sin enlazar (email escrito de otra forma, o compartido entre
    // dos fichas, casos que la migración deja a NULL a propósito).
    const filtroCliente = [];
    if (searchParams.get("clientId")) {
      filtroCliente.push({ clientId: searchParams.get("clientId").trim() });
    }
    if (searchParams.get("clientEmail")) {
      filtroCliente.push({ clientEmail: { [Op.iLike]: searchParams.get("clientEmail").trim() } });
    }
    // OJO: filtro de cliente y búsqueda de texto son DOS grupos "o" distintos y
    // tienen que combinarse con "y". Escribir los dos en where[Op.or] hacía que
    // el segundo pisara al primero en silencio.
    const grupos = [];
    if (filtroCliente.length === 1) grupos.push(filtroCliente[0]);
    else if (filtroCliente.length > 1) grupos.push({ [Op.or]: filtroCliente });

    const q = (searchParams.get("search") || "").trim();
    if (q) {
      grupos.push({
        [Op.or]: [
          { clientName: { [Op.iLike]: `%${q}%` } },
          { clientEmail: { [Op.iLike]: `%${q}%` } },
          { clientPhone: { [Op.iLike]: `%${q}%` } },
        ],
      });
    }
    // Fuera los carritos abandonados: alguien empezó a reservar, se fue a pagar
    // y no volvió. Esas filas se quedan en 'pending' y aparecían en la lista de
    // espera mezcladas con las solicitudes de verdad, indistinguibles — la
    // profesional podía confirmar a mano una cita que nadie ha pagado.
    // El webhook `checkout.session.expired` las retira, pero filtrar también al
    // leer hace que no dependa de que ese evento llegue.
    // Las YA retiradas (cancelled) siguen viéndose: esto solo esconde las que
    // están en el limbo.
    grupos.push(noEsCarritoAbandonado());

    if (grupos.length) where[Op.and] = grupos;

    // Acceso por rol: un profesional no-admin solo ve SUS citas (misma regla que
    // el calendario; sin esto, la lista/lista de espera filtraba los datos
    // personales de las citas de todo el equipo). El jefe (admin) ve todo, y
    // un tenant con agenda compartida enseña la de todos (lib/citas/visibilidad.js).
    if (hasModule("team")) {
      const userRole = request.headers.get("x-user-role") ?? "user";
      if (!veTodaLaAgenda({ tenant, role: userRole })) {
        const myId = await resolveCurrentTeamMemberId(request, tenantModels);
        where.teamMemberId = myId ?? NADIE;
      }
    }

    // teamMember solo si el tenant tiene módulo team (si no, la tabla
    // team_members no existe y el JOIN daría 500 — p.ej. nutri_laura).
    // `sessionsCount` para poder decir «sesión 3 de 10» en la lista de sesiones
    // de la ficha. Sequelize solo trae los atributos pedidos: sin él, el total
    // llegaría como `undefined` y la etiqueta saldría a medias.
    const include = [
      { model: EventType, as: "eventType", attributes: ["id", "name", "slug", "color", "sessionsCount"] },
    ];
    if (hasModule("team")) {
      include.push({ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"] });
    }
    if ((hasModule("clinica") || hasModule("pacientes")) && Patient) {
      include.push({ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"] });
    }

    // ?future=true = "próximas citas": orden ASCENDENTE (la más cercana primero),
    // para que un limit pequeño devuelva las SIGUIENTES, no las más lejanas.
    // El resto (listado, lista de espera) mantiene DESC (lo más reciente arriba).
    const sortDir = searchParams.get("future") === "true" ? "ASC" : "DESC";
    const { count, rows } = await Booking.findAndCountAll({
      where,
      include,
      order: [["scheduledAt", sortDir]],
      limit,
      offset,
    });

    return ok({
      // Sin importes ni estado de cobro si no es dirección (07/08/2026). Este
      // es el endpoint de la LISTA DE ESPERA, donde más se ve el dinero: es de
      // donde salía el «No se pudo cobrar · 360,00 €» que vio la empleada.
      bookings: filtrarCitas(rows.map((r) => r.toJSON()), request.headers.get("x-user-role")),
      total: count,
      page,
      limit,
    });
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/citas/bookings — creación manual por admin
//   - NO valida minNoticeHours / maxAdvanceDays
//   - NO valida disponibilidad (admin puede crear donde quiera)
//   - SÍ valida solapamiento con otros bookings activos
//   - SÍ valida que modality esté en EventType.modalities
// ───────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");
    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;
    /*
     * Apuntar una cita a mano lo puede hacer CUALQUIERA del equipo (06/08/2026,
     * Rodrigo; universal, no solo nutri_laura). Era solo admin y no tenía
     * sentido: quien coge el teléfono en recepción es justo quien la apunta, y
     * tener que pedírselo a la dirección para cada llamada convertía la agenda
     * en un cuello de botella.
     *
     * Sigue haciendo falta tener el módulo de citas y una sesión: la puerta no
     * desaparece, se abre al equipo. Lo que mueve DINERO —confirmar y cobrar,
     * pedir la tarjeta— se queda en admin.
     */

    const { Booking, EventType, TeamMember } = tenantModels;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const eventTypeId = body.eventTypeId;
    if (!eventTypeId || typeof eventTypeId !== "string") return error("eventTypeId es obligatorio");

    const eventType = await EventType.findByPk(eventTypeId);
    if (!eventType) return error("eventTypeId no existe", 404);

    const clientName = normalizeString(body.clientName);
    if (!clientName) return error("clientName es obligatorio");

    const clientEmail = normalizeEmail(body.clientEmail);
    if (!clientEmail || !isValidEmail(clientEmail)) return error("clientEmail inválido");

    const clientPhone = normalizeString(body.clientPhone);
    if (!clientPhone) return error("clientPhone es obligatorio");

    // Enlace con la ficha de cliente (2026-07-22). Opcional: una cita para
    // alguien que todavía no es cliente es válida. Si viene, se comprueba que
    // la ficha existe DE VERDAD en este tenant antes de guardarla — si no,
    // una FK rota tumbaría el insert con un error feo.
    let clientId = null;
    if (body.clientId != null && body.clientId !== "") {
      if (typeof body.clientId !== "string" || !UUID_RE.test(body.clientId)) {
        return error("clientId inválido");
      }
      const { Client } = tenantModels;
      const ficha = Client ? await Client.findByPk(body.clientId, { attributes: ["id"] }) : null;
      if (!ficha) return error("La ficha de cliente indicada no existe", 422);
      clientId = ficha.id;
    }

    const additionalData = body.additionalData != null ? String(body.additionalData) : null;
    if (eventType.additionalDataRequired && (!additionalData || additionalData.trim() === "")) {
      return error("additionalData es obligatorio para este tipo de cita");
    }

    if (!body.scheduledAt) return error("scheduledAt es obligatorio");
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return error("scheduledAt inválido");

    // Día cerrado del centro. Se avisa, no se impone: si el admin insiste
    // (una urgencia el día del puente) puede mandar `permitirFestivo: true`.
    // El festivo protege la agenda pública, no ata las manos a quien manda.
    const festivos = await cargarFestivos(tenantModels);
    if (esFestivo(festivos, getMadridParts(scheduledAt)) && body.permitirFestivo !== true) {
      return error("Ese día está marcado como festivo o cierre del centro. Vuelve a enviarlo confirmando si quieres crearla igualmente.", 409);
    }

    const modality = String(body.modality || "").toLowerCase();
    if (!VALID_MODALITIES.includes(modality)) return error("modality inválida");
    if (!eventType.modalities.includes(modality)) {
      return error(`modality '${modality}' no está permitida para este tipo de cita`);
    }

    const duration = eventType.duration; // snapshot
    // El enlace solo se hereda del tipo de cita si el tenant tiene el modo
    // "automatico" (Configuración → Citas). Por defecto la cita nace sin
    // enlace y se pega a mano con «Guardar y enviar».
    const meetUrl = meetUrlInicial(tenant, eventType, modality);

    const notes = body.notes != null ? String(body.notes) : null;

    // teamMemberId solo si el tenant tiene módulo team; valida existencia. Se
    // resuelve ANTES del solape porque el solape es POR PROFESIONAL.
    let teamMemberId = null;
    if (hasModule("team")) {
      const tmId = typeof body.teamMemberId === "string" && body.teamMemberId.trim()
        ? body.teamMemberId.trim()
        : null;
      if (tmId) {
        if (!UUID_RE.test(tmId)) return error("teamMemberId inválido");
        const tm = await TeamMember.findByPk(tmId, { attributes: ["id"] });
        if (!tm) return error("teamMemberId no existe");
      }
      teamMemberId = tmId;
    }

    /*
     * «Vacaciones» (06/08/2026): esa persona no está ese día. Igual que el
     * festivo, se AVISA pero no se impone —quien manda es el centro, y a veces
     * se atiende una urgencia a la vuelta—; se reenvía con `permitirBloqueo`.
     *
     * Va después de resolver `teamMemberId` porque el bloqueo es POR PERSONA:
     * antes no se sabría de quién mirar las vacaciones.
     */
    if (body.permitirBloqueo !== true) {
      const bloqueos = await cargarAusencias(tenantModels, {
        desde: new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000),
        hasta: new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000),
        profesionalId: teamMemberId,
      });
      const partes = getMadridParts(scheduledAt);
      const inicio = partes.hour * 60 + partes.minute;
      const fin = inicio + duration;
      const choca = bloqueos.find((b) => {
        const t = minutosOcupados(b, partes);
        return t && inicio < t.fin && fin > t.inicio;
      });
      if (choca) {
        return error(
          `Ese tramo está bloqueado (${choca.label}). Vuelve a enviarlo confirmando si quieres crearla igualmente.`,
          409
        );
      }
    }

    // Solapamiento (solo con citas del MISMO profesional, o sin asignar).
    const overlap = await findBookingOverlap(Booking, { scheduledAt, duration, teamMemberId });
    if (overlap) {
      return error(`Solapa con otra cita activa el ${overlap.scheduledAt.toISOString?.() ?? overlap.scheduledAt}`, 409);
    }

    // Paciente asignado (Clínica/Pacientes). Opcional.
    const patRes = await resolvePatientId(body, tenantModels, hasModule);
    if (patRes.err) return error(patRes.err);

    // Si esta persona tiene bono con sesiones libres para este tipo de cita, la
    // cita se engancha y se numera. La agenda del CRM no cobra —lo apunta la
    // profesional a mano—, así que aquí solo importa la numeración. Sin correo
    // no hay a quién buscarle el bono: el correo es opcional desde el 02/08.
    const enBono = clientEmail
      ? await asignarSesion(tenantModels, { email: clientEmail, eventTypeId })
      : null;

    const row = await Booking.create({
      eventTypeId,
      clientName,
      clientEmail,
      clientPhone,
      additionalData,
      scheduledAt,
      duration,
      modality,
      meetUrl,
      status: "confirmed",
      notes,
      teamMemberId,
      patientId: patRes.patientId,
      clientId,
      packId: enBono?.packId ?? null,
      sessionNumber: enBono?.sessionNumber ?? null,
    });

    await logCitasAudit({
      tenantId: tenant.id,
      userId,
      action: "citas.booking_created",
      entity: "Booking",
      entityId: row.id,
      before: null,
      after: { ...row.toJSON(), source: "manual" },
      ip,
    });

    return created(row.toJSON());
  } catch (err) {
    return serverError(err);
  }
});
