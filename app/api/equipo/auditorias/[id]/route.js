import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../../lib/team/currentTeamMember.js";
import { esDireccion, gateAuditorias, serializarAuditoria } from "../../../../../lib/team/auditoriasStore.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import {
  avisosDelCierre,
  criteriosQueSeRepiten,
  loQuePendiaDeLaAnterior,
  normalizarAreas,
  puedeVerAuditoria,
  RESULTADOS,
} from "../../../../../lib/team/auditoriaDesempeno.js";

/**
 * /api/equipo/auditorias/[id] — una auditoría de desempeño.
 *
 * El GET trae además dos cosas que la pantalla no puede calcular sola y que son
 * lo que se pidió:
 *
 *   · `anterior` — lo que quedó pendiente del mes anterior de esa persona.
 *   · `seRepiten` — los criterios que salen «no apto» en meses CONSECUTIVOS,
 *     que es el «si el mismo incumplimiento se repite mes a mes, tiene que
 *     verse» de la petición.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

const texto = (v) => (v == null ? "" : String(v).trim());

async function cargar(ctx, id) {
  const { AuditoriaDesempeno, TeamMember } = ctx.tenantModels;
  return AuditoriaDesempeno.findByPk(id, {
    include: [
      { model: TeamMember, as: "auditado", attributes: ["id", "displayName", "avatarColor"], required: false },
      { model: TeamMember, as: "auditor", attributes: ["id", "displayName"], required: false },
    ],
  });
}

export const GET = withTenant(async (request, rc, ctx) => {
  try {
    const puerta = gateAuditorias(ctx);
    if (puerta) return forbidden(puerta);
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const fila = await cargar(ctx, id);
    if (!fila) return notFound("Auditoría no encontrada");

    const admin = esDireccion(ctx);
    const yoSoy = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
    if (!puedeVerAuditoria({ esAdmin: admin, teamMemberId: yoSoy }, fila)) {
      return forbidden("Esta auditoría no es tuya");
    }

    const { AuditoriaDesempeno, Patient } = ctx.tenantModels;
    const anterior = await AuditoriaDesempeno.findOne({
      where: { teamMemberId: fila.teamMemberId, mes: { [Op.lt]: fila.mes } },
      order: [["mes", "DESC"]],
    });
    // El histórico de esa persona hasta este mes incluido: es lo que hace falta
    // para ver una racha, y no se puede sacar de una sola auditoría.
    const historico = await AuditoriaDesempeno.findAll({
      where: { teamMemberId: fila.teamMemberId, mes: { [Op.lte]: fila.mes } },
      attributes: ["mes", "areas"],
      order: [["mes", "ASC"]],
      limit: 36,
    });

    /*
     * Los pacientes que se revisaron, con su nombre. Se guardan por id y el
     * nombre se pide aquí: una auditoría con el nombre copiado dentro seguiría
     * enseñándolo el día que la ficha se dé de baja.
     */
    let pacientes = [];
    const ids = (fila.pacientesRevisados ?? []).filter((x) => UUID_RE.test(String(x)));
    if (Patient && ids.length) {
      const filas = await Patient.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "firstName", "lastName"] });
      pacientes = filas.map((p) => ({ id: p.id, nombre: `${p.firstName ?? ""} ${p.lastName ?? ""}`.replace(/\s+/g, " ").trim() }));
    }

    return ok({
      auditoria: serializarAuditoria(fila),
      anterior: loQuePendiaDeLaAnterior(anterior),
      seRepiten: criteriosQueSeRepiten(historico.map((h) => (h.toJSON ? h.toJSON() : h))),
      pacientes,
      puedeEditar: admin,
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * PATCH — escribe. Solo dirección.
 *
 * `estado: "cerrada"` la firma. Al cerrar se devuelven los avisos de
 * `avisosDelCierre`, que NO impiden nada: un «no apto» no decide el resultado y
 * quien audita puede tener sus motivos. Se dicen, y ya está.
 */
export const PATCH = withTenant(async (request, rc, ctx) => {
  try {
    const puerta = gateAuditorias(ctx);
    if (puerta) return forbidden(puerta);
    if (!esDireccion(ctx)) return forbidden("Solo dirección puede escribir una auditoría");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const fila = await cargar(ctx, id);
    if (!fila) return notFound("Auditoría no encontrada");

    const body = await request.json().catch(() => ({}));
    const cambios = {};

    if (body.areas !== undefined) cambios.areas = normalizarAreas(body.areas);
    for (const campo of ["fortalezas", "aspectosAMejorar", "accionAcordada", "observaciones", "resueltoLoAnterior"]) {
      if (body[campo] !== undefined) cambios[campo] = texto(body[campo]) || null;
    }
    if (body.plazoRevision !== undefined) {
      const v = texto(body.plazoRevision);
      if (v && !FECHA_RE.test(v)) return error("El plazo de revisión debe ser una fecha", 422);
      cambios.plazoRevision = v || null;
    }
    if (body.fecha !== undefined) {
      const v = texto(body.fecha);
      if (v && !FECHA_RE.test(v)) return error("La fecha debe ser 'AAAA-MM-DD'", 422);
      cambios.fecha = v || null;
    }
    if (body.resultado !== undefined) {
      const v = texto(body.resultado);
      if (v && !RESULTADOS.includes(v)) return error("Resultado no válido", 422);
      cambios.resultado = v || null;
    }
    if (body.pacientesRevisados !== undefined) {
      cambios.pacientesRevisados = (Array.isArray(body.pacientesRevisados) ? body.pacientesRevisados : [])
        .map((x) => String(x))
        .filter((x) => UUID_RE.test(x));
    }
    if (body.estado !== undefined) {
      const v = texto(body.estado);
      if (v !== "borrador" && v !== "cerrada") return error("Estado no válido", 422);
      cambios.estado = v;
      cambios.cerradaAt = v === "cerrada" ? new Date() : null;
    }

    await fila.update(cambios);
    const fresca = await cargar(ctx, id);

    /*
     * Se audita el CIERRE y nada más, y solo con contadores: es lo que mueve
     * algo laboral. Ni una observación viaja a master — el resumen de auditoría
     * nunca lleva el texto (master es un schema compartido).
     */
    if (cambios.estado === "cerrada") {
      const { userId, ip } = datosPeticion(request);
      await auditar({
        tenantId: ctx.tenant.id,
        userId,
        ip,
        action: "auditorias.auditoria.cerrada",
        entity: "AuditoriaDesempeno",
        entityId: id,
        after: { mes: fresca.mes, resultado: fresca.resultado ?? null },
      });
    }

    return ok({
      auditoria: serializarAuditoria(fresca),
      avisos: avisosDelCierre(serializarAuditoria(fresca)),
    });
  } catch (err) {
    return serverError(err);
  }
});

/** DELETE — solo un borrador, y solo dirección. Una cerrada no se borra. */
export const DELETE = withTenant(async (request, rc, ctx) => {
  try {
    const puerta = gateAuditorias(ctx);
    if (puerta) return forbidden(puerta);
    if (!esDireccion(ctx)) return forbidden("Solo dirección puede borrar una auditoría");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { AuditoriaDesempeno } = ctx.tenantModels;
    const fila = await AuditoriaDesempeno.findByPk(id);
    if (!fila) return notFound("Auditoría no encontrada");
    /*
     * Una auditoría cerrada es una valoración firmada de una persona: si se
     * pudiera borrar, el histórico dejaría de ser un histórico. Se puede volver
     * a borrador y reescribir, que deja rastro; borrarla, no.
     */
    if (fila.estado === "cerrada") return error("Una auditoría cerrada no se borra: vuélvela a borrador si hay que corregirla", 409);

    const mes = fila.mes;
    await fila.destroy();
    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      ip,
      action: "auditorias.auditoria.deleted",
      entity: "AuditoriaDesempeno",
      entityId: id,
      before: { mes },
    });
    return ok({ borrada: true });
  } catch (err) {
    return serverError(err);
  }
});
