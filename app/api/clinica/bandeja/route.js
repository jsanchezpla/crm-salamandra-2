import { Op } from "sequelize";
import { veTodoElEquipo } from "../../../../lib/clinica/coordinadoras.js";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden } from "../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { madridToday, madridDayRange } from "../../../../lib/utils/madridDate.js";
import { REPORT_TYPE_LABEL } from "../../../../lib/clinica/serialize.js";
import { categoryLabel, statusLabel, priorityLabel, INCIDENCIA_STATUS } from "../../../../lib/clinica/incidencias.js";
import { whereIncidenciasDe } from "../../../../lib/clinica/incidenciasDe.js";
import { ventanaDeLaSemana, citasSinRegistro } from "../../../../lib/clinica/loMio.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const patientName = (p) => (p ? [p.firstName, p.lastName].filter(Boolean).join(" ") : null);
const isoDate = (d) => (d ? (typeof d === "string" ? d : new Date(d).toISOString()).slice(0, 10) : null);

/**
 * GET /api/clinica/bandeja — "lo mío pendiente" del terapeuta logueado:
 * informes sin entregar, incidencias asignadas sin resolver y citas de hoy.
 * Admin puede ver la de otro con ?therapistId=. Si el usuario no tiene ficha de
 * equipo, cae al primer terapeuta activo (igual que "Mi desempeño").
 *
 * ── Y DESDE EL 09/09/2026, LOS REGISTROS DE LA SEMANA (AV-0078) ───────────
 * Araceli: «no nos salen lo que deberíamos ir haciendo a la semana: registros,
 * informes, planes de intervención…». La Bandeja tenía la puerta abierta desde
 * el 02/09 —incluso para quien coordina— pero salía casi vacía: sus tres
 * secciones eran informes (2 en toda la base de Aumenta), incidencias y las
 * citas de HOY. Ahora trae también las citas de los últimos 7 días que se han
 * quedado sin registro, que es la única lista con trabajo real dentro.
 *
 * `?vista=equipo` devuelve esos mismos recuentos de TODO el equipo, para quien
 * coordina. Es lo que Araceli pidió de verdad —«poder dar el feedback a las
 * compis»— sin tener que ir picando quince nombres en el desplegable. No lleva
 * ni un euro ni una hora de nadie: solo cuántas cosas le quedan.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // Pantalla de EQUIPO AVANZADO: se vende aparte del módulo Equipo
  // básico (que es solo plantilla, usuarios, roles y accesos).
  if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
  const M = ctx.tenantModels;
  const { ClinicalReport, Incidencia, Booking, TeamMember, Patient, EventType, ClinicSession } = M;
  const sp = new URL(request.url).searchParams;

  let therapistId = await resolveCurrentTeamMemberId(request, M);
  // La ficha PROPIA, guardada antes de que `therapistId` pueda pasar a ser la
  // de otra persona: el permiso de la vista de equipo se decide con quien
  // pregunta, no con quien se está mirando.
  const miFicha = therapistId;
  // Quien NO tiene ficha de equipo propia (p. ej. el admin de dirección) puede
  // elegir la bandeja de otra persona; una terapeuta ve LA SUYA… salvo que
  // coordine (02/09/2026, AV-0022 de Aumenta): la lista de Configuración →
  // Módulos, lib/clinica/coordinadoras.js.
  const canSwitch = !therapistId || veTodoElEquipo({ tenant: ctx.tenant, role: ctx.user?.role, teamMemberId: therapistId });
  /*
   * ⚠️ `canSwitch` NO es «coordina»: lleva dentro el `!therapistId`, o sea que
   * quien no tenga ficha de equipo también lo tiene a true. Hoy eso solo abre
   * mirar la bandeja de UNA persona; la tabla del equipo entero es otra cosa,
   * así que se pregunta aparte y con la ficha propia. En aumenta hoy no hay
   * ningún usuario de rol `user` sin ficha, pero eso cambia el día que den de
   * alta a alguien de recepción con `team_avanzado`.
   */
  const coordina = veTodoElEquipo({ tenant: ctx.tenant, role: ctx.user?.role, teamMemberId: miFicha });
  const asked = sp.get("therapistId");
  if (canSwitch && asked && UUID_RE.test(asked)) therapistId = asked;
  if (!therapistId) {
    const first = await TeamMember.findOne({ where: { status: "active" }, order: [["createdAt", "ASC"]], attributes: ["id"] });
    therapistId = first?.id ?? null;
  }
  const therapist = therapistId ? await TeamMember.findByPk(therapistId, { attributes: ["id", "displayName", "position", "avatarColor"] }) : null;
  if (!therapist) {
    // Con las claves nuevas vacías: si faltan, la pantalla lee `undefined`.
    return ok({
      therapist: null, reports: [], incidencias: [], citasToday: [],
      registros: { sinEmpezar: [], aMedias: [] }, equipo: null, coordina,
      counts: { reports: 0, reportsOverdue: 0, incidencias: 0, citasToday: 0, registrosSinEmpezar: 0, registrosAMedias: 0 },
    });
  }

  // "Hoy" en hora ESPAÑOLA (el servidor corre en UTC; sin esto, entre las
  // 00:00 y las 02:00 de España se calcularía el día anterior).
  const todayStr = madridToday();

  // ── Informes pendientes (no entregados) ──
  const reportRows = await ClinicalReport.findAll({
    where: { therapistId, status: { [Op.ne]: "delivered" } },
    include: [{ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false }],
    order: [["dueDate", "ASC"], ["reportDate", "ASC"]],
    limit: 100,
  });
  const reports = reportRows.map((r) => {
    const j = r.toJSON();
    const overdue = j.dueDate ? isoDate(j.dueDate) < todayStr : false;
    return {
      id: j.id,
      patientId: j.patientId,
      patientName: patientName(j.patient),
      type: j.reportType,
      typeLabel: REPORT_TYPE_LABEL[j.reportType] ?? j.reportType,
      status: j.status,
      dueDate: isoDate(j.dueDate),
      overdue,
    };
  });
  const reportsOverdue = reports.filter((r) => r.overdue).length;

  // ── Incidencias asignadas sin resolver ──
  // Por la tabla PIVOTE (31/08/2026): antes el 2.º responsable no veía nada
  // aquí — la regla, en lib/clinica/incidenciasDe.js.
  // `soloPendientes` (04/09/2026): la que ella ya dio por VISTA sale de su
  // bandeja aunque la incidencia siga abierta para el resto del equipo.
  const deMio = await whereIncidenciasDe(M, therapistId, { soloPendientes: true });
  const incRows = await Incidencia.findAll({
    where: { ...deMio, status: { [Op.ne]: "resolved" } },
    include: [{ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false }],
    order: [["incidenceDate", "DESC"]],
    limit: 100,
  });
  const incidencias = incRows.map((r) => {
    const j = r.toJSON();
    return {
      id: j.id,
      title: j.title,
      category: j.category,
      categoryLabel: categoryLabel(j.category),
      status: j.status,
      statusLabel: statusLabel(j.status),
      statusLevel: INCIDENCIA_STATUS[j.status]?.level ?? "gray",
      priority: j.priority,
      priorityLabel: priorityLabel(j.priority),
      patientName: patientName(j.patient),
      date: isoDate(j.incidenceDate),
    };
  });

  // ── Citas de hoy (día de Madrid, como instantes reales) ──
  const { start: dayStart, end: dayEnd } = madridDayRange();
  const bookingRows = await Booking.findAll({
    where: {
      teamMemberId: therapistId,
      status: { [Op.in]: ["pending", "confirmed", "completed"] },
      scheduledAt: { [Op.gte]: dayStart, [Op.lt]: dayEnd },
    },
    include: [
      { model: EventType, as: "eventType", attributes: ["id", "name"], required: false },
      { model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false },
    ],
    order: [["scheduledAt", "ASC"]],
    limit: 100,
  });
  const citasToday = bookingRows.map((b) => {
    const j = b.toJSON();
    return {
      id: j.id,
      // ISO crudo: la hora se formatea en el cliente (zona del navegador),
      // no en el servidor (que puede estar en UTC).
      scheduledAt: j.scheduledAt,
      clientName: j.clientName,
      patientName: patientName(j.patient),
      eventType: j.eventType?.name ?? null,
      duration: j.duration,
      modality: j.modality,
      status: j.status,
    };
  });

  /*
   * ── LOS REGISTROS DE LA SEMANA (09/09/2026, AV-0078) ──────────────────
   *
   * Las citas de los últimos 7 días que se han quedado sin registro. Las dos
   * consultas van juntas porque el cruce lo hace `citasSinRegistro`, que es
   * puro y está probado: aquí solo se traen los datos.
   *
   * De las sesiones se piden SEIS campos y ninguno del cuerpo clínico: para
   * saber si el registro está escrito no hace falta leerlo, y una nota de
   * salud que no necesita viajar no viaja.
   */
  async function registrosDe(idsTerapeutas) {
    const ventana = ventanaDeLaSemana(new Date());
    const citas = await Booking.findAll({
      where: {
        teamMemberId: { [Op.in]: idsTerapeutas },
        patientId: { [Op.ne]: null },
        status: { [Op.in]: ["confirmed", "completed"] },
        scheduledAt: { [Op.gte]: ventana.desde, [Op.lte]: ventana.hasta },
      },
      include: [
        { model: EventType, as: "eventType", attributes: ["id", "name"], required: false },
        { model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false },
      ],
      order: [["scheduledAt", "DESC"]],
      limit: 600,
    });
    if (!citas.length) return { citas: [], sesiones: [] };
    const pacientes = [...new Set(citas.map((c) => c.patientId).filter(Boolean))];
    const sesiones = await ClinicSession.findAll({
      where: {
        patientId: { [Op.in]: pacientes },
        sessionDate: { [Op.gte]: ventana.desde, [Op.lte]: ventana.hasta },
      },
      attributes: ["id", "patientId", "bookingId", "tallerSesionId", "therapistId", "sessionDate", "status", "updatedAt"],
      limit: 2000,
    });
    return { citas: citas.map((c) => c.toJSON()), sesiones: sesiones.map((x) => x.toJSON()) };
  }

  const { citas: citasSemana, sesiones: sesionesSemana } = await registrosDe([therapistId]);
  const pendientes = citasSinRegistro(citasSemana, sesionesSemana, { ahora: new Date() });
  const filaDeRegistro = ({ cita, sesion }) => ({
    bookingId: cita.id,
    patientId: cita.patientId,
    patientName: patientName(cita.patient),
    scheduledAt: cita.scheduledAt,
    eventType: cita.eventType?.name ?? null,
    sessionId: sesion?.id ?? null,
  });
  const registros = {
    sinEmpezar: pendientes.sinEmpezar.map(filaDeRegistro),
    aMedias: pendientes.aMedias.map(filaDeRegistro),
  };

  /*
   * ── LA TABLA DEL EQUIPO, para quien coordina ─────────────────────────
   *
   * Una sola pasada para todo el mundo (dos consultas, no dos por persona) y
   * el reparto en memoria con la misma función pura. Solo recuentos: quién
   * tiene qué pendiente, ni un euro ni una hora.
   */
  let equipo = null;
  if (coordina && sp.get("vista") === "equipo") {
    const activos = await TeamMember.findAll({
      where: { status: "active" },
      attributes: ["id", "displayName", "position", "avatarColor"],
      order: [["displayName", "ASC"]],
    });
    const ids = activos.map((t) => t.id);
    const { citas, sesiones } = ids.length ? await registrosDe(ids) : { citas: [], sesiones: [] };
    const informes = await ClinicalReport.findAll({
      where: { therapistId: { [Op.in]: ids }, status: { [Op.ne]: "delivered" } },
      attributes: ["id", "therapistId"],
    });
    const porInformes = informes
      .map((r) => r.toJSON())
      .reduce((m, f) => m.set(String(f.therapistId), (m.get(String(f.therapistId)) ?? 0) + 1), new Map());
    /*
     * Las incidencias, con la MISMA regla que cada una ve en su bandeja
     * (`whereIncidenciasDe` con `soloPendientes`, que respeta el «Visto» del
     * 04/09 y la tabla pivote del 31/08). Es una consulta por persona en vez de
     * una para todas, y se paga a gusto: una tabla que enseñara a la
     * coordinadora un número distinto del que ve la compañera no sirve para dar
     * feedback, sirve para discutir.
     */
    const porIncidencias = new Map();
    for (const id of ids) {
      const suyo = await whereIncidenciasDe(M, id, { soloPendientes: true });
      porIncidencias.set(String(id), await Incidencia.count({ where: { ...suyo, status: { [Op.ne]: "resolved" } } }));
    }
    equipo = activos.map((t) => {
      const suyas = citas.filter((c) => String(c.teamMemberId) === String(t.id));
      const r = citasSinRegistro(suyas, sesiones, { ahora: new Date() });
      return {
        id: t.id,
        name: t.displayName,
        position: t.position ?? "",
        color: t.avatarColor ?? "#1B3A2D",
        counts: {
          registrosSinEmpezar: r.sinEmpezar.length,
          registrosAMedias: r.aMedias.length,
          reports: porInformes.get(String(t.id)) ?? 0,
          incidencias: porIncidencias.get(String(t.id)) ?? 0,
        },
      };
    });
  }

  // La lista de nombres del equipo solo para quien puede cambiar de bandeja:
  // hasta hoy viajaba a todo el mundo sin que nadie la usara.
  const therapists = canSwitch
    ? (
        await TeamMember.findAll({ where: { status: "active" }, attributes: ["id", "displayName"], order: [["displayName", "ASC"]] })
      ).map((t) => ({ id: t.id, name: t.displayName }))
    : [];

  return ok({
    therapist: { id: therapist.id, name: therapist.displayName, position: therapist.position ?? "", color: therapist.avatarColor ?? "#1B3A2D" },
    therapists,
    canSwitch,
    reports,
    incidencias,
    citasToday,
    registros,
    equipo,
    coordina,
    counts: {
      reports: reports.length,
      reportsOverdue,
      incidencias: incidencias.length,
      citasToday: citasToday.length,
      registrosSinEmpezar: registros.sinEmpezar.length,
      registrosAMedias: registros.aMedias.length,
    },
  });
});
