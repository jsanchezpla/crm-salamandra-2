import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { esDireccion, gateAuditorias, serializarAuditoria } from "../../../../lib/team/auditoriasStore.js";
import { areasEnBlanco, loQuePendiaDeLaAnterior, mesAnterior } from "../../../../lib/team/auditoriaDesempeno.js";

/**
 * /api/equipo/auditorias — la auditoría mensual de desempeño (09/09/2026,
 * AV-0100 de Isabel, dirección de Aumenta).
 *
 * ── QUIÉN VE QUÉ ───────────────────────────────────────────────────────────
 * Es material laboral sobre una persona, la misma conversación que tuvieron las
 * incidencias en agosto (AV-0018):
 *
 *   · Dirección ve, escribe y cierra todas.
 *   · Cada profesional ve LAS SUYAS y solo cuando están cerradas.
 *   · Nadie más ve nada.
 *
 * La regla está escrita una vez en `lib/team/auditoriaDesempeno.js` y aquí solo
 * se aplica, para que la lista, la ficha y la edición no puedan discrepar.
 */

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/equipo/auditorias?teamMemberId=&mes=&estado=
 *
 * Devuelve además `yoSoy` y `esDireccion`, que es lo que la pantalla necesita
 * para saber si enseña el botón de crear.
 */
export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const puerta = gateAuditorias(ctx);
    if (puerta) return forbidden(puerta);

    const { AuditoriaDesempeno, TeamMember } = ctx.tenantModels;
    const admin = esDireccion(ctx);
    const yoSoy = await resolveCurrentTeamMemberId(request, ctx.tenantModels);

    const sp = new URL(request.url).searchParams;
    const where = {};
    const teamMemberId = sp.get("teamMemberId");
    if (teamMemberId && UUID_RE.test(teamMemberId)) where.teamMemberId = teamMemberId;
    const mes = sp.get("mes");
    if (mes && MES_RE.test(mes)) where.mes = mes;
    const estado = sp.get("estado");
    if (estado === "borrador" || estado === "cerrada") where.estado = estado;

    // Quien no es dirección solo ve LAS SUYAS y CERRADAS. Sin ficha de equipo no
    // ve ninguna: es la misma decisión que en incidencias, y por lo mismo —
    // enseñar todo «para no dejar la lista vacía» es justo lo que no puede pasar
    // con material laboral.
    if (!admin) {
      if (!yoSoy) return ok({ auditorias: [], yoSoy: null, esDireccion: false });
      where.teamMemberId = yoSoy;
      where.estado = "cerrada";
    }

    const filas = await AuditoriaDesempeno.findAll({
      where,
      include: [
        { model: TeamMember, as: "auditado", attributes: ["id", "displayName", "avatarColor"], required: false },
        { model: TeamMember, as: "auditor", attributes: ["id", "displayName"], required: false },
      ],
      order: [["mes", "DESC"], ["created_at", "DESC"]],
      limit: 300,
    });

    return ok({
      auditorias: filas.map((f) => serializarAuditoria(f)),
      yoSoy,
      esDireccion: admin,
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * POST /api/equipo/auditorias — abre la auditoría de una persona y un mes.
 *
 * Nace EN BLANCO (ningún criterio valorado) y con lo que quedó pendiente del mes
 * anterior ya delante: es la pieza que convierte una pila de meses sueltos en un
 * seguimiento.
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const puerta = gateAuditorias(ctx);
    if (puerta) return forbidden(puerta);
    if (!esDireccion(ctx)) return forbidden("Solo dirección puede abrir una auditoría");

    const { AuditoriaDesempeno, TeamMember } = ctx.tenantModels;
    const body = await request.json().catch(() => ({}));

    const teamMemberId = String(body.teamMemberId ?? "");
    if (!UUID_RE.test(teamMemberId)) return error("Falta a quién se audita", 422);
    const mes = String(body.mes ?? "");
    if (!MES_RE.test(mes)) return error("El mes debe ser 'AAAA-MM'", 422);

    const persona = await TeamMember.findByPk(teamMemberId, { attributes: ["id"] });
    if (!persona) return error("Esa persona no está en la plantilla", 422);

    // Una persona, un mes, una auditoría. El índice único lo garantiza; esto es
    // para poder decirlo con palabras en vez de con un error de base de datos.
    const yaHay = await AuditoriaDesempeno.findOne({ where: { teamMemberId, mes }, attributes: ["id"] });
    if (yaHay) return error("Esa persona ya tiene una auditoría de ese mes", 409);

    const anterior = await AuditoriaDesempeno.findOne({
      where: { teamMemberId, mes: { [Op.lt]: mes } },
      order: [["mes", "DESC"]],
    });

    const fila = await AuditoriaDesempeno.create({
      teamMemberId,
      auditorId: await resolveCurrentTeamMemberId(request, ctx.tenantModels),
      mes,
      fecha: body.fecha ?? null,
      areas: areasEnBlanco(),
      estado: "borrador",
    });

    return ok({
      auditoria: serializarAuditoria(fila),
      // Lo de la anterior va en la respuesta y NO copiado dentro de la fila: es
      // contexto para quien escribe, no contenido de esta auditoría.
      anterior: loQuePendiaDeLaAnterior(anterior),
      mesAnterior: mesAnterior(mes),
    });
  } catch (err) {
    return serverError(err);
  }
});
