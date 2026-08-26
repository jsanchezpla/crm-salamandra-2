/**
 * /api/team/[id]/borrar — borrar de VERDAD la ficha de una persona
 * (26/08/2026, pedido por Jorge: «que se puedan borrar desde equipo los
 * usuarios y terapeutas, con un modal de confirmación, pero antes tengas que
 * poner al empleado como inactivo»).
 *
 * Va aparte del `DELETE /api/team/[id]` de siempre, que NO borra: da de baja
 * (`status = 'inactive'`) y revoca el login. Ese sigue siendo el camino normal
 * y no se toca; este es el último paso, para la ficha creada por error y para
 * quien estuvo dos días.
 *
 *   GET    → la radiografía: qué queda de esa persona y si se puede borrar.
 *            Es lo que llena el modal ANTES de preguntar nada.
 *   DELETE → la borra, volviendo a medir. Nunca se fía de lo que vio el
 *            navegador: entre que se pintó el modal y que alguien pulsa pueden
 *            pasar horas, y en ese rato le han podido asignar una cita.
 *
 * ── POR QUÉ BLOQUEA EN VEZ DE AVISAR ───────────────────────────────────────
 *
 * Porque lo que hay detrás es historia clínica y facturas. Un «¿seguro?» con
 * una casilla de «sé lo que hago» delante de 22.000 sesiones no protege nada:
 * se marca sin leer. Si queda una sola fila suya, aquí no hay botón — el modal
 * enseña qué hay y la ficha se queda inactiva, que es un final perfectamente
 * digno. La regla y la medición viven en `lib/team/rastro.js`.
 */

import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import { radiografiaDeLaFicha, puedeBorrarseLaFicha } from "../../../../../lib/team/rastro.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({ tenantId, userId, action, entity: "TeamMember", entityId, before, after, ip });
  } catch {}
}

/** Las guardas comunes a las dos puertas. Devuelve { member } o { respuesta }. */
async function abrirLaPuerta(request, params, ctx) {
  const { tenantModels, hasModule } = ctx;
  if (!hasModule("team")) return { respuesta: forbidden("Módulo team no activo") };
  const userRole = request.headers.get("x-user-role") ?? "user";
  if (!ADMIN_ROLES.has(userRole)) return { respuesta: forbidden("Solo un administrador puede borrar fichas") };

  const { id } = await params;
  const member = await tenantModels.TeamMember.findByPk(id);
  if (!member) return { respuesta: notFound("Esa ficha ya no existe") };
  return { member };
}

/** La foto completa: qué queda y qué impide borrar. La comparten GET y DELETE. */
async function mirar(ctx, member) {
  const rastro = await radiografiaDeLaFicha(ctx.tenantSequelize, {
    schema: `crm_${ctx.slug}`,
    memberId: member.id,
  });
  const veredicto = puedeBorrarseLaFicha({
    status: member.status,
    userId: member.userId,
    total: rastro.total,
  });
  return { rastro, veredicto };
}

// ───────────────────────────────────────────────────────────────────────────
// GET — la radiografía (solo lecturas)
// ───────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (request, { params }, ctx) => {
  try {
    const { member, respuesta } = await abrirLaPuerta(request, params, ctx);
    if (respuesta) return respuesta;

    const { rastro, veredicto } = await mirar(ctx, member);
    return ok({
      displayName: member.displayName,
      status: member.status,
      tieneLogin: !!member.userId,
      puede: veredicto.puede,
      impedimentos: veredicto.impedimentos,
      total: rastro.total,
      // Solo cuentas y nombres de cosa: ni un dato de nadie.
      filas: rastro.filas.map((f) => ({ tabla: f.tabla, n: f.n, texto: f.texto })),
      columnasMiradas: rastro.columnas,
    });
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE — borrarla de verdad
// ───────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, ctx) => {
  const { tenant, tenantSequelize } = ctx;
  try {
    const { member, respuesta } = await abrirLaPuerta(request, params, ctx);
    if (respuesta) return respuesta;

    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    // Se vuelve a medir AQUÍ, en el servidor, aunque el navegador ya lo hiciera.
    const { rastro, veredicto } = await mirar(ctx, member);
    if (!veredicto.puede) {
      return error(veredicto.impedimentos.map((i) => i.texto).join(" "), 409);
    }

    // Lo que se guarda en el log: quién era y qué puesto tenía, nada más. La
    // ficha entera no se copia a master (regla de auditoría: un RESUMEN, y los
    // datos personales no se duplican fuera del schema del cliente).
    const resumen = {
      displayName: member.displayName,
      role: member.position ?? null,
      status: member.status,
    };

    try {
      await tenantSequelize.transaction(async (t) => {
        await member.destroy({ transaction: t });
      });
    } catch (err) {
      // 23503 = alguien le colgó algo entre la medición y el borrado. Es la red
      // de debajo de la red: la mide PostgreSQL, no nosotros.
      const codigo = err?.parent?.code || err?.original?.code;
      if (codigo === "23503") {
        return error(
          "Justo ahora le han colgado un registro nuevo, así que la ficha no se ha borrado. Vuelve a abrir el aviso para ver qué es.",
          409
        );
      }
      throw err;
    }

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "team.deleted",
      entityId: member.id,
      before: resumen,
      after: { columnasComprobadas: rastro.columnas },
      ip,
    });

    return ok({ borrada: true, displayName: resumen.displayName });
  } catch (err) {
    return serverError(err);
  }
});
