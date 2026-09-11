/**
 * GET /api/clinica/incidencias/export — el listado de incidencias, tal cual se
 * ve en pantalla, en un Excel (11/09/2026, AV-0125 de Aumenta).
 *
 * Olga (administración): «el listado de incidencias, que se pueda descargar el
 * Excel, por facilidad para poder ir controlando mejor y tener otra visión; en
 * administración recibimos casi todas».
 *
 * Mismos parámetros que la lista (`?status= ?faltas=1 ?category= ?reportedById=
 * ?mine=1 ?assignedToId= ?q= ?vistas=1`) y, sobre todo, el MISMO alcance: los
 * dos pasan por `whereDeIncidencias`, así que quien no es dirección se lleva
 * exactamente lo que ve y ni una más. Es la lección del Excel de Clientes
 * (`app/api/clients/export/route.js`), que un día ignoró el filtro de la lista.
 *
 * Una hoja «Datos» con una fila por incidencia y otra «Filtros aplicados» que
 * dice con qué se sacó, para que dentro de un mes el fichero se explique solo.
 */
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { xlsxResponse, fmtDateEs } from "../../../../../lib/billing/exportXlsx.js";
import { includesDeIncidencias, whereDeIncidencias } from "../../../../../lib/clinica/filtroIncidencias.js";
import { serializeIncidencia, INCIDENCIA_CATEGORIES } from "../../../../../lib/clinica/incidencias.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PESTANAS = {
  "": "Todas",
  pending: "Pendientes",
  in_progress: "En proceso",
  resolved: "Resueltas",
};

function nombreDe(lista, id) {
  return lista.find((x) => x.id === id)?.name ?? "—";
}

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    if (!(ctx.hasModule("clinica") || ctx.hasModule("pacientes"))) return forbidden("Módulo Clínica no activo");
    if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
    const M = ctx.tenantModels;
    const { Incidencia } = M;
    const sp = new URL(request.url).searchParams;

    const { where, yoSoy, verVistas, esAdmin } = await whereDeIncidencias({ request, sp, M, ctx });

    const rows = await Incidencia.findAll({
      where,
      include: includesDeIncidencias(M),
      order: [["incidenceDate", "DESC"], ["createdAt", "DESC"]],
      limit: 2000,
    });

    /*
     * ── LA PESTAÑA «FALTAS» LLEVA SUS PROPIAS COLUMNAS (11/09/2026, AV-0127) ──
     * Olga: «que se vaya descargando en un excel… terapeuta, fecha falta,
     * paciente, justificada/injustificada, estado (recuperada o no), fecha
     * primer/segundo/tercer intento, fecha recuperación, horario de la
     * recuperación, observaciones». La terapeuta y la hora salen de la CITA
     * que faltó (`falta.bookingId`) y la recuperación de la cita enlazada
     * (`recovered_by_booking_id`); los «intentos» no son un dato del CRM: se
     * ponen las fechas de los tres primeros comentarios de la incidencia, que
     * es donde se apunta cada llamada a la familia.
     */
    const soloFaltas = sp.get("faltas") === "1";
    const citas = new Map();
    if (soloFaltas && M.Booking) {
      const ids = rows.map((r) => r.falta?.bookingId).filter((x) => x && UUID_RE.test(x));
      if (ids.length) {
        const filasCita = await M.Booking.findAll({
          where: { id: ids },
          attributes: ["id", "scheduledAt", "teamMemberId", "recoveredByBookingId"],
          include: M.TeamMember ? [{ model: M.TeamMember, as: "teamMember", attributes: ["id", "displayName"], required: false }] : [],
        });
        const recuperadoras = filasCita.map((c) => c.recoveredByBookingId).filter(Boolean);
        const porId = new Map();
        if (recuperadoras.length) {
          const rec = await M.Booking.findAll({ where: { id: recuperadoras }, attributes: ["id", "scheduledAt"], raw: true });
          for (const c of rec) porId.set(c.id, c);
        }
        for (const c of filasCita) {
          citas.set(c.id, {
            cuando: c.scheduledAt,
            terapeuta: c.teamMember?.displayName ?? null,
            recuperacion: c.recoveredByBookingId ? porId.get(c.recoveredByBookingId)?.scheduledAt ?? null : null,
          });
        }
      }
    }
    const horaMadrid = (d) => (d ? new Date(d).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }) : "");
    const fechaMadrid = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" }) : "");

    const filasDeFaltas = rows.map((r) => {
      const i = serializeIncidencia(r);
      const f = i.falta ?? {};
      const cita = citas.get(f.bookingId) ?? null;
      const intentos = (i.comments ?? []).map((c) => c.at).filter(Boolean).sort();
      const recuperada = f.respuesta === "aceptada";
      return {
        terapeuta: cita?.terapeuta ?? (i.assignees ?? []).map((a) => a.name).filter(Boolean).join(", "),
        fechaFalta: cita?.cuando ? fechaMadrid(cita.cuando) : i.date ? fmtDateEs(i.date) : "",
        paciente: i.patient?.name ?? "",
        justificada: f.justificada ? "Justificada" : "Injustificada",
        estado: recuperada ? "Recuperada" : f.respuesta === "rechazada" ? "No recupera" : "Sin respuesta",
        intento1: intentos[0] ? fechaMadrid(intentos[0]) : "",
        intento2: intentos[1] ? fechaMadrid(intentos[1]) : "",
        intento3: intentos[2] ? fechaMadrid(intentos[2]) : "",
        fechaRecuperacion: cita?.recuperacion ? fechaMadrid(cita.recuperacion) : f.fechaRecuperacion ? fmtDateEs(f.fechaRecuperacion) : "",
        horarioRecuperacion: cita?.recuperacion ? horaMadrid(cita.recuperacion) : "",
        huecos: f.huecosOfrecidos ?? "",
        observaciones: [f.nota, i.resolution].filter(Boolean).join(" · "),
        asunto: i.title ?? "",
      };
    });

    const filas = rows.map((r) => {
      const i = serializeIncidencia(r);
      return {
        fecha: i.date ? fmtDateEs(i.date) : "",
        asunto: i.title ?? "",
        categoria: i.faltaResumen ? "Falta" : i.categoryLabel ?? i.category ?? "",
        subcategoria: i.faltaResumen ?? i.subcategory ?? "",
        paciente: i.patient?.name ?? "",
        prioridad: i.priorityLabel ?? i.priority ?? "",
        estado: i.verificationLabel ?? i.statusLabel ?? i.status ?? "",
        responsables: (i.assignees ?? []).map((a) => a.name).filter(Boolean).join(", ") || "sin asignar",
        registradaPor: i.reportedBy?.name ?? "",
        comentarios: (i.comments ?? []).length,
        resolucion: i.resolution ?? "",
        resueltaEl: i.resolvedAt ? fmtDateEs(i.resolvedAt) : "",
        descripcion: i.description ?? "",
      };
    });

    // Para que la hoja de filtros hable en nombres y no en ids.
    const equipo = (
      await M.TeamMember.findAll({ attributes: ["id", "displayName"], raw: true })
    ).map((t) => ({ id: t.id, name: t.displayName }));
    const categoria = sp.get("category");
    const etiquetaCategoria = INCIDENCIA_CATEGORIES.find((c) => c.key === categoria)?.label ?? categoria;
    const responsable = sp.get("mine") === "1" && esAdmin ? yoSoy : sp.get("assignedToId");

    return await xlsxResponse({
      filename: `incidencias-${ctx.tenant.slug}.xlsx`,
      sheetName: soloFaltas ? "Faltas" : "Incidencias",
      columns: soloFaltas ? [
        { header: "Terapeuta", key: "terapeuta", width: 26 },
        { header: "Fecha falta", key: "fechaFalta", width: 12 },
        { header: "Paciente", key: "paciente", width: 28 },
        { header: "Justificada / injustificada", key: "justificada", width: 16 },
        { header: "Estado (recuperada o no)", key: "estado", width: 18 },
        { header: "Fecha primer intento", key: "intento1", width: 14 },
        { header: "Fecha segundo intento", key: "intento2", width: 14 },
        { header: "Fecha tercer intento", key: "intento3", width: 14 },
        { header: "Fecha recuperación", key: "fechaRecuperacion", width: 14 },
        { header: "Horario de la recuperación", key: "horarioRecuperacion", width: 14 },
        { header: "Huecos ofrecidos", key: "huecos", width: 30 },
        { header: "Observaciones", key: "observaciones", width: 50 },
        { header: "Asunto", key: "asunto", width: 40 },
      ] : [
        { header: "Fecha", key: "fecha", width: 12 },
        { header: "Asunto", key: "asunto", width: 40 },
        { header: "Categoría", key: "categoria", width: 18 },
        { header: "Subcategoría / falta", key: "subcategoria", width: 24 },
        { header: "Paciente", key: "paciente", width: 28 },
        { header: "Prioridad", key: "prioridad", width: 10 },
        { header: "Estado", key: "estado", width: 14 },
        { header: "Responsables", key: "responsables", width: 32 },
        { header: "Registrada por", key: "registradaPor", width: 24 },
        { header: "Comentarios", key: "comentarios", width: 12 },
        { header: "Resolución", key: "resolucion", width: 40 },
        { header: "Resuelta el", key: "resueltaEl", width: 12 },
        { header: "Descripción", key: "descripcion", width: 60 },
      ],
      rows: soloFaltas ? filasDeFaltas : filas,
      filters: [
        { label: "Pestaña", value: sp.get("faltas") === "1" ? "Faltas" : PESTANAS[sp.get("status") ?? ""] ?? sp.get("status") },
        { label: "Categoría", value: etiquetaCategoria || "Todas" },
        { label: "Responsable", value: responsable ? nombreDe(equipo, responsable) : "Cualquiera" },
        { label: "Registrada por", value: sp.get("reportedById") ? nombreDe(equipo, sp.get("reportedById")) : "Cualquiera" },
        { label: "Texto buscado", value: (sp.get("q") || "").trim() || "—" },
        { label: "Incluye las dadas por vistas", value: verVistas ? "Sí" : "No" },
        { label: "Alcance", value: esAdmin ? "Todas (dirección)" : "Las que registró o tiene asignadas quien exporta" },
        { label: "Filas", value: String(filas.length) },
        { label: "Generado", value: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) },
      ],
    });
  } catch (err) {
    return serverError(err);
  }
});
