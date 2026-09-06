import { Op } from "sequelize";

import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { avisarComentarioIncidencia } from "../../../../../lib/clinica/avisoComentarioIncidencia.js";
import { incidenciaFueraDeAlcance, puedeBorrarIncidencia, puedeVerIncidencia } from "../../../../../lib/clinica/alcanceIncidencias.js";
import { esActualizacion, aQuienSeLeReabre, vistoDe, repasoDelEquipo } from "../../../../../lib/clinica/vistoIncidencia.js";
import { logClinicaAudit, auditSummary } from "../../../../../lib/clinica/audit.js";
import { fundirFalta, cierrePorRespuesta } from "../../../../../lib/clinica/faltas.js";
import {
  serializeIncidencia,
  isValidCategory,
  isValidStatus,
  isValidPriority,
  responsablesDe,
  sincronizarResponsables,
  isValidVerification,
  statusDeVerificacion,
} from "../../../../../lib/clinica/incidencias.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}
const INCLUDES = (M) => [
  { model: M.Patient, as: "patient", attributes: ["id", "firstName", "lastName"], required: false },
  { model: M.TeamMember, as: "assignedTo", attributes: ["id", "displayName", "avatarColor"], required: false },
  { model: M.TeamMember, as: "reportedBy", attributes: ["id", "displayName", "avatarColor"], required: false },
  // Multi-responsable (sprint 2026-07-29). Ver app/api/clinica/incidencias/route.js.
  { model: M.TeamMember, as: "assignees", attributes: ["id", "displayName", "avatarColor"], through: { attributes: [] }, required: false },
];

export const GET = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  // Pantalla de EQUIPO AVANZADO: se vende aparte del módulo Equipo
  // básico (que es solo plantilla, usuarios, roles y accesos).
  if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const M = ctx.tenantModels;
  const row = await M.Incidencia.findByPk(id, { include: INCLUDES(M) });
  if (!row) return notFound("Incidencia no encontrada");
  // Quién ve qué (02/09/2026, Aumenta AV-0018): una ajena no existe para ti.
  if (await incidenciaFueraDeAlcance(request, ctx, row)) return notFound("Incidencia no encontrada");
  return ok({ ...serializeIncidencia(row), ...(await miVisto(request, M, id)) });
});

/**
 * El «Visto» de QUIEN MIRA sobre esta incidencia (04/09/2026). Una consulta a
 * la pivote: la ficha necesita saber si puede ofrecer el botón y cómo está.
 * Ver `lib/clinica/vistoIncidencia.js`.
 */
async function miVisto(request, M, incidenciaId) {
  if (!M.IncidenciaAssignee) return { puedeMarcarVisto: false, visto: false, repaso: [] };
  const yoSoy = await resolveCurrentTeamMemberId(request, M);
  const filas = await M.IncidenciaAssignee.findAll({
    where: { incidenciaId },
    attributes: ["teamMemberId", "vistoAt"],
    raw: true,
  });
  const { puedeMarcar, visto } = vistoDe(filas, yoSoy);
  // Y el repaso del EQUIPO: quién la ha dado por vista y quién falta
  // (05/09/2026, vuelta de AV-0039). Sin nombres — los pone la pantalla, que ya
  // trae `assignees` con el suyo.
  const { repaso, vistos, total } = repasoDelEquipo(filas);
  return { puedeMarcarVisto: puedeMarcar, visto, repaso, vistos, responsables: total };
}

/**
 * PATCH /api/clinica/incidencias/[id]
 *   { title, description, category, subcategory, priority, incidenceDate,
 *     patientId, assignedToId }   editar campos
 *   { status: "in_progress" | "resolved" | "pending", resolution? }   cambiar estado
 *   { comment: "texto" }          añadir comentario al hilo
 */
export const PATCH = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const M = ctx.tenantModels;
  const { Incidencia, Patient, TeamMember } = M;
  const row = await Incidencia.findByPk(id);
  if (!row) return notFound("Incidencia no encontrada");
  if (await incidenciaFueraDeAlcance(request, ctx, row)) return notFound("Incidencia no encontrada");

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }

  const changes = {};

  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (!t) return error("El título no puede quedar vacío");
    changes.title = t.slice(0, 200);
  }
  if (body.description !== undefined) changes.description = body.description ? String(body.description).slice(0, 5000) : null;
  if (body.category !== undefined) {
    if (!isValidCategory(body.category)) return error("Categoría inválida");
    changes.category = body.category;
  }
  if (body.subcategory !== undefined) changes.subcategory = body.subcategory ? String(body.subcategory).slice(0, 120) : null;
  if (body.priority !== undefined) {
    if (!isValidPriority(body.priority)) return error("Prioridad inválida");
    changes.priority = body.priority;
  }
  if (body.incidenceDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(body.incidenceDate)) {
    changes.incidenceDate = body.incidenceDate;
  }
  // Responsables: `assigneeIds` (multi) manda; `assignedToId` sigue aceptándose
  // solo. El espejo assignedToId lo pone sincronizarResponsables más abajo.
  const responsables = body.assigneeIds !== undefined || body.assignedToId !== undefined
    ? responsablesDe(body)
    : null;
  if (body.patientId !== undefined) {
    const pid = body.patientId && UUID_RE.test(body.patientId) ? body.patientId : null;
    changes.patientId = pid;
    // Recomputar la foto del cliente.
    if (pid) {
      const p = await Patient.findByPk(pid, { attributes: ["id", "clientId"] });
      changes.clientId = p?.clientId ?? null;
    } else {
      changes.clientId = null;
    }
  }

  // La acción realizada se puede escribir en cualquier momento, no solo al
  // cerrar: se apunta cuando se hace, que es cuando se recuerda.
  if (body.resolution !== undefined) {
    changes.resolution = body.resolution ? String(body.resolution).slice(0, 5000) : null;
  }

  /*
   * LA FALTA (03/09/2026, AV-0038): huecos ofrecidos, respuesta de la familia
   * y fecha de recuperación. Aceptar o rechazar la CIERRA («y se elimine esa
   * falta pendiente»); volver a «sin respuesta» la reabre. Solo se toca si
   * viene, y solo en una incidencia que sea falta (`fundirFalta` lo exige).
   */
  if (body.falta !== undefined) {
    const r = fundirFalta(row.falta, body.falta);
    if (!r.ok) return error(r.error);
    changes.falta = r.falta;
    const cierre = cierrePorRespuesta(r.falta);
    if (cierre) {
      changes.status = cierre.status;
      changes.verification = cierre.verification;
      changes.resolvedAt = new Date();
    } else if (row.status === "resolved") {
      changes.status = "pending";
      changes.verification = null;
      changes.resolvedAt = null;
    }
  }

  // VERIFICACIÓN → arrastra el estado. Es el control que ve el usuario.
  if (body.verification !== undefined) {
    const v = body.verification === null || body.verification === "" ? null : body.verification;
    if (v !== null && !isValidVerification(v)) return error("Verificación inválida");
    changes.verification = v;
    changes.status = statusDeVerificacion(v);
    changes.resolvedAt = v === "resuelta" ? new Date() : null;
  } else if (body.status !== undefined) {
    // Compatibilidad: quien siga mandando `status` a pelo (o un cliente viejo)
    // sigue funcionando, y la verificación se mantiene coherente con él.
    if (!isValidStatus(body.status)) return error("Estado inválido");
    changes.status = body.status;
    if (body.status === "resolved") {
      changes.resolvedAt = new Date();
      changes.verification = row.verification ?? "resuelta";
      if (body.resolution !== undefined) changes.resolution = body.resolution ? String(body.resolution).slice(0, 5000) : null;
    } else {
      changes.resolvedAt = null;
      if (row.verification === "resuelta") changes.verification = null;
    }
  }

  if (body.reportedById !== undefined) {
    changes.reportedById = body.reportedById && UUID_RE.test(body.reportedById) ? body.reportedById : null;
  }

  let commentEntry = null;
  if (body.comment !== undefined) {
    const text = String(body.comment).trim();
    if (text) {
      const tmId = await resolveCurrentTeamMemberId(request, M);
      let authorName = request.headers.get("x-user-email") || "—";
      if (tmId) {
        const tm = await TeamMember.findByPk(tmId, { attributes: ["displayName"] });
        if (tm?.displayName) authorName = tm.displayName;
      }
      commentEntry = { authorId: tmId || null, authorName, text: text.slice(0, 3000), at: new Date().toISOString() };
    }
  }

  /*
   * ── EL «VISTO» DE QUIEN LLAMA (04/09/2026, Rodrigo) ───────────────────────
   * `{ visto: true }` marca que ESTA persona ya hizo su parte; `false` lo
   * deshace. No toca `status`: la incidencia sigue abierta para el resto. Vive
   * en la pivote y por eso, como los responsables, tampoco va en `changes`.
   * Reglas y porqué en `lib/clinica/vistoIncidencia.js`.
   */
  const vistoPedido = typeof body.visto === "boolean" ? body.visto : null;

  // `responsables` NO va en `changes` (vive en la tabla pivote), así que hay
  // que contarlo aparte: si no, cambiar solo los responsables se rechazaba con
  // "Nada que cambiar".
  if (Object.keys(changes).length === 0 && !commentEntry && !responsables && vistoPedido === null) {
    return error("Nada que cambiar", 422);
  }

  if (Object.keys(changes).length > 0) await row.update(changes);
  // Si cambió el paciente, los documentos adjuntos siguen a la incidencia: se
  // re-enlazan a la ficha nueva (o se sueltan de la vieja si se quitó). Sin
  // esto, un documento subido antes de corregir el paciente se quedaría
  // colgado en la ficha equivocada.
  if ("patientId" in changes && M.Document) {
    await M.Document.update(
      { patientId: changes.patientId, clientId: changes.clientId ?? null },
      { where: { incidenciaId: id, source: "incidencia" } }
    );
  }
  if (commentEntry) {
    // Append ATÓMICO en PostgreSQL: dos comentarios simultáneos se concatenan
    // en vez de pisarse (leer-modificar-escribir perdería uno de los dos).
    // ctx.slug está validado por el resolver ([a-z0-9_]) — sin inyección.
    await ctx.tenantSequelize.query(
      `UPDATE "crm_${ctx.slug}"."incidencias"
          SET comments = comments || :entry::jsonb, updated_at = now()
        WHERE id = :id`,
      { replacements: { entry: JSON.stringify([commentEntry]), id } }
    );
  }
  if (responsables) await sincronizarResponsables(row, responsables, M);

  /*
   * ── EL VISTO, Y A QUIÉN SE LE REABRE ──────────────────────────────────────
   * Quien llama se resuelve una sola vez: hace falta para escribir SU visto y
   * para saber a quién NO reabrírselo (si Ana comenta después de darla por
   * vista, no se le devuelve a Ana).
   */
  if (M.IncidenciaAssignee && (vistoPedido !== null || esActualizacion({ cambios: changes, hayComentario: !!commentEntry, cambiaronResponsables: !!responsables }))) {
    const quienLlama = commentEntry?.authorId ?? (await resolveCurrentTeamMemberId(request, M));

    if (vistoPedido !== null) {
      // Solo los RESPONSABLES tienen «su parte» que dar por hecha. A quien solo
      // registró la incidencia no se le inventa una fila en la pivote.
      const [tocadas] = await M.IncidenciaAssignee.update(
        { vistoAt: vistoPedido ? new Date() : null },
        { where: { incidenciaId: id, teamMemberId: quienLlama ?? null } }
      );
      if (!tocadas) return error("Solo quien es responsable de la incidencia puede marcarla como vista", 422);
    }

    // Cualquier novedad se la devuelve a quien la había dado por vista. Va
    // DESPUÉS de escribir el visto propio y excluye a quien la provoca, así
    // que marcar visto y comentar a la vez no se pisa a sí mismo.
    if (esActualizacion({ cambios: changes, hayComentario: !!commentEntry, cambiaronResponsables: !!responsables })) {
      await M.IncidenciaAssignee.update(
        { vistoAt: null },
        { where: aQuienSeLeReabre(id, quienLlama, Op) }
      );
    }
  }

  /*
   * ── Y SE CIERRA SOLA CUANDO LA MARCAN TODAS (05/09/2026, vuelta de AV-0039,
   *    Rodrigo: «la incidencia se cierra sola cuando todo el mundo da el visto,
   *    sí») ──────────────────────────────────────────────────────────────────
   * Se mira DESPUÉS de escribir este visto y con las filas frescas: el último
   * en marcar es el que cierra. Se escribe con la misma tripleta que la
   * verificación «resuelta» —que es lo que significa—, y directamente sobre la
   * fila, no por `changes`: cerrar por vistos no es una novedad que haya que
   * devolverle a nadie a la bandeja. La regla, con nombre y prueba, en
   * `lib/clinica/vistoIncidencia.js` (`cierraAlMarcarTodas`).
   */
  let cerradaPorVistos = false;
  if (M.IncidenciaAssignee && vistoPedido === true && row.status !== "resolved") {
    const filas = await M.IncidenciaAssignee.findAll({
      where: { incidenciaId: id },
      attributes: ["teamMemberId", "vistoAt"],
      raw: true,
    });
    if (cierraAlMarcarTodas(filas)) {
      await row.update({ verification: "resuelta", status: "resolved", resolvedAt: new Date() });
      cerradaPorVistos = true;
    }
  }

  const full = await Incidencia.findByPk(id, { include: INCLUDES(M) });
  if (commentEntry) {
    // Que los compañeros se enteren (02/09/2026): hasta hoy el comentario se
    // guardaba y ahí se quedaba. Best-effort: el comentario YA está guardado.
    // Regla y destinatarios en lib/clinica/avisoComentarioIncidencia.js.
    await avisarComentarioIncidencia({
      ctx,
      row: full,
      comentario: commentEntry,
      autorTeamMemberId: commentEntry.authorId,
      autorUserId: request.headers.get("x-user-id"),
    });
  }
  return ok({ ...serializeIncidencia(full), ...(await miVisto(request, M, id)), cerradaPorVistos });
});

// DELETE — borrado físico. Solo dirección.
// Borrar (02/09/2026, Aumenta AV-0013): dirección cualquiera; el resto SOLO la
// que registró —una incidencia abierta por error se la quita quien la abrió—.
export const DELETE = withTenant(async (request, rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
  const { id } = await rc.params;
  if (!UUID_RE.test(id)) return error("id inválido");
  const M = ctx.tenantModels;
  const row = await M.Incidencia.findByPk(id);
  if (!row) return notFound("Incidencia no encontrada");
  const esAdmin = ADMIN_ROLES.has(ctx.user?.role);
  const yoSoy = esAdmin ? null : await resolveCurrentTeamMemberId(request, M);
  // Responsable por la pivote (03/09/2026, AV-0039): la misma lectura que
  // decide si la ve; `puedeBorrarIncidencia` ya mira el espejo `assignedToId`.
  const esResponsable = !esAdmin && !!yoSoy && (await puedeVerIncidencia(M, row, yoSoy));
  if (!puedeBorrarIncidencia({ esAdmin, row, teamMemberId: yoSoy, esResponsable })) {
    return forbidden("Solo dirección, quien la registró o quien es responsable puede eliminar una incidencia");
  }
  const before = auditSummary(row);
  await row.destroy();
  // Lo destructivo deja rastro (02/09/2026; hasta hoy se borraba sin auditar):
  // un resumen, nunca la fila entera —lib/clinica/audit.js—.
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.incidencia.deleted",
    entity: "Incidencia",
    entityId: id,
    before,
    after: null,
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok({ deleted: id });
});
