import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { limpiarContentSections } from "../../../../../lib/clinica/plantillas.js";
import { MAX_TRANSCRIPCION } from "../../../../../lib/clinica/registroCompleto.js";
import {
  ETIQUETA_NOTA_POR_DEFECTO,
  apartadosComunes,
  etiquetaNotaDe,
  valoresComunes,
} from "../../../../../lib/clinica/tallerSesion.js";
import { notasDeLaSesion, propagarSesionDeTaller } from "../../../../../lib/clinica/propagarTaller.js";

/**
 * /api/clinica/taller-sesiones/[id] — UNA sesión de taller (01/09/2026).
 *
 *   GET    → el registro común, sus asistentes y la nota individual de cada uno
 *   PUT    → reescribirla, y con ella el registro de todos los asistentes
 *   DELETE → quitarla, y con ella los registros que generó
 *
 * Vive en su propia ruta y no colgando del taller porque una sesión se abre por
 * su id: desde la lista del taller, desde el bloqueo de la agenda y desde la
 * ficha de un paciente, que no siempre saben de qué taller es.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);

function gate(ctx) {
  return ctx.hasModule("clinica");
}

const nombreDe = (p) => [p?.firstName, p?.lastName].filter(Boolean).join(" ") || "—";

export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { TallerSesion, Taller, TeamMember, TallerInscripcion, Patient } = ctx.tenantModels;
    if (!TallerSesion) return error("Los talleres no están disponibles en este cliente", 503);

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const fila = await TallerSesion.findByPk(id, {
      include: [
        { model: Taller, as: "taller", attributes: ["id", "name"], required: false },
        ...(TeamMember ? [{ model: TeamMember, as: "profesional", attributes: ["id", "displayName"], required: false }] : []),
      ],
    });
    if (!fila) return notFound("Esa sesión de taller ya no existe");

    // Quién tiene registro de ESTA sesión y con qué nota. Es la lista de
    // asistencia de verdad: lo que hay escrito, no lo que se marcó un día.
    const notas = await notasDeLaSesion({ tenantModels: ctx.tenantModels, sesionTallerId: id });

    /*
     * Y los que están apuntados al taller hoy, para poder añadir a quien vino
     * y no estaba. Se devuelven los dos: quien tiene registro sale marcado, el
     * resto sale por marcar.
     */
    let apuntados = [];
    if (TallerInscripcion && Patient) {
      const filas = await TallerInscripcion.findAll({
        where: { tallerId: fila.tallerId, leftAt: null },
        include: [{ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"] }],
      });
      apuntados = filas
        .filter((i) => i.patient)
        .map((i) => ({ patientId: i.patientId, nombre: nombreDe(i.patient) }));
    }

    // Los que tienen registro pero ya no están apuntados (se dieron de baja
    // después): tienen que salir igual o su nota desaparecería de la pantalla.
    const yaListados = new Set(apuntados.map((a) => a.patientId));
    for (const [patientId] of notas) {
      if (yaListados.has(patientId)) continue;
      const p = Patient ? await Patient.findByPk(patientId, { attributes: ["id", "firstName", "lastName"] }) : null;
      apuntados.push({ patientId, nombre: p ? nombreDe(p) : "—", yaNoApuntado: true });
    }

    const asistentes = apuntados.map((a) => ({
      ...a,
      asistio: notas.has(a.patientId),
      nota: notas.get(a.patientId)?.nota ?? "",
      sessionId: notas.get(a.patientId)?.sessionId ?? null,
      // Si ya se le envió el registro a su familia, la pantalla avisa antes de
      // quitarlo de la lista: ese no se borra (ver propagarTaller.js).
      enviada: notas.get(a.patientId)?.enviada ?? false,
    }));

    return ok({
      id: fila.id,
      tallerId: fila.tallerId,
      tallerName: fila.taller?.name ?? null,
      sessionDate: fila.sessionDate,
      duration: fila.duration ?? null,
      teamMemberId: fila.teamMemberId ?? null,
      teamMemberName: fila.profesional?.displayName ?? null,
      status: fila.status,
      internalNotes: fila.internalNotes ?? "",
      // De qué texto salió el registro (03/09/2026): para volver a pasar la IA
      // sin subir el audio otra vez. Material del equipo, solo para esta pantalla.
      aiTranscription: fila.aiTranscription ?? "",
      audioDurationSec: fila.audioDurationSec ?? null,
      contentSections: fila.contentSections ?? {},
      teamBlockId: fila.teamBlockId ?? null,
      // El título del apartado privado tal como se guardó, para que al reabrir
      // el formulario salga el que se puso y no el de fábrica.
      etiquetaNota: etiquetaNotaDe(await unContentSectionsDelGrupo(ctx.tenantModels, id)) || ETIQUETA_NOTA_POR_DEFECTO,
      asistentes,
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * El `contentSections` de UNO cualquiera de los registros generados, solo para
 * leerle el título del apartado privado. Todos tienen el mismo, porque los
 * escribe la misma propagación.
 */
async function unContentSectionsDelGrupo(tenantModels, sesionTallerId) {
  const { ClinicSession } = tenantModels;
  if (!ClinicSession) return {};
  const una = await ClinicSession.findOne({
    where: { tallerSesionId: sesionTallerId },
    attributes: ["contentSections"],
    raw: true,
  });
  return una?.contentSections ?? {};
}

export const PUT = withTenant(async (request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { TallerSesion } = ctx.tenantModels;
    if (!TallerSesion) return error("Los talleres no están disponibles en este cliente", 503);

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const fila = await TallerSesion.findByPk(id);
    if (!fila) return notFound("Esa sesión de taller ya no existe");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const cambios = {};
    if (body.sessionDate !== undefined) {
      const f = new Date(body.sessionDate);
      if (Number.isNaN(f.getTime())) return error("La fecha de la sesión no es válida", 422);
      cambios.sessionDate = f;
    }
    if (body.duration !== undefined) {
      cambios.duration = body.duration != null && body.duration !== "" ? Number(body.duration) : null;
    }
    if (body.teamMemberId !== undefined) {
      const tm = typeof body.teamMemberId === "string" && body.teamMemberId.trim() ? body.teamMemberId.trim() : null;
      if (tm && !UUID_RE.test(tm)) return error("teamMemberId inválido", 422);
      cambios.teamMemberId = tm;
    }
    if (body.internalNotes !== undefined) {
      cambios.internalNotes = typeof body.internalNotes === "string" && body.internalNotes.trim()
        ? body.internalNotes.trim()
        : null;
    }
    if (body.status !== undefined) {
      cambios.status = body.status === "published" ? "published" : "registered";
    }
    // De qué texto salió (03/09/2026): la transcripción del audio y/o las
    // notas pegadas, tal como las leyó la IA. Solo si la pantalla lo manda;
    // vacío = se borra (se quitó el audio).
    if (body.aiTranscription !== undefined) {
      const t = typeof body.aiTranscription === "string" ? body.aiTranscription.trim() : "";
      if (t.length > MAX_TRANSCRIPCION) return error("La transcripción es demasiado larga", 413);
      cambios.aiTranscription = t || null;
    }
    if (body.audioDurationSec !== undefined) {
      const n = Number(body.audioDurationSec);
      cambios.audioDurationSec = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    if (body.contentSections !== undefined) {
      const limpio = limpiarContentSections(body.contentSections);
      const comunes = apartadosComunes(limpio.apartados);
      cambios.contentSections = { ...valoresComunes(limpio), apartados: comunes };
      if (limpio.plantilla) cambios.contentSections.plantilla = limpio.plantilla;
    }

    if (Object.keys(cambios).length) await fila.update(cambios);

    /*
     * Y se vuelve a propagar SIEMPRE, aunque no haya cambiado nada de la fila:
     * lo que suele cambiar es una nota individual, que no vive aquí. Es
     * idempotente, así que repetirla no hace daño.
     *
     * Sin `asistentes` en el cuerpo NO se toca la lista: se re-propaga a los
     * que ya la tienen. Así, guardar solo el registro común desde otra pantalla
     * no borra los registros de ocho pacientes por no haber mandado la lista.
     */
    const notas = await notasDeLaSesion({ tenantModels: ctx.tenantModels, sesionTallerId: id });
    const asistentes = Array.isArray(body.asistentes)
      ? body.asistentes
      : [...notas.entries()].map(([patientId, v]) => ({ patientId, nota: v.nota }));

    const reparto = await propagarSesionDeTaller({
      tenantModels: ctx.tenantModels,
      sesionTaller: fila,
      asistentes,
      etiquetaNota: body.etiquetaNota,
    });

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "clinica.taller_sesion.updated",
      entity: "TallerSesion",
      entityId: fila.id,
      after: {
        sessionDate: fila.sessionDate,
        status: fila.status,
        pacientes: reparto.creadas + reparto.actualizadas,
        borradas: reparto.borradas,
      },
    });

    return ok({ id: fila.id, ...reparto });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * Quitar la sesión del taller se lleva por delante los registros que generó, y
 * eso son notas clínicas de ocho pacientes: **solo dirección**.
 *
 * Los que ya se enviaron al área privada de su familia NO se borran (se
 * desenganchan y se quedan en la ficha del paciente): un documento que alguien
 * ya ha leído no puede desaparecer del CRM. La respuesta dice cuántos.
 */
export const DELETE = withTenant(async (request, { params }, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    if (!ADMIN_ROLES.has(request.headers.get("x-user-role"))) {
      return forbidden("Quitar una sesión de taller borra el registro de todo el grupo: es cosa de dirección.");
    }

    const { TallerSesion } = ctx.tenantModels;
    if (!TallerSesion) return error("Los talleres no están disponibles en este cliente", 503);

    const { id } = await params;
    if (!UUID_RE.test(String(id ?? ""))) return error("id inválido", 422);

    const fila = await TallerSesion.findByPk(id);
    if (!fila) return ok({ eliminada: false }); // idempotente

    // Propagar con la lista VACÍA hace exactamente lo que hay que hacer: borra
    // los registros de los asistentes y conserva los ya enviados.
    const reparto = await propagarSesionDeTaller({
      tenantModels: ctx.tenantModels,
      sesionTaller: fila,
      asistentes: [],
    });

    const antes = { tallerId: fila.tallerId, sessionDate: fila.sessionDate };
    await fila.destroy();

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "clinica.taller_sesion.deleted",
      entity: "TallerSesion",
      entityId: id,
      before: { ...antes, borradas: reparto.borradas, conservadas: reparto.conservadas.length },
    });

    return ok({ eliminada: true, ...reparto });
  } catch (err) {
    return serverError(err);
  }
});
