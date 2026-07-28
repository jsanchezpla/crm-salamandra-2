/**
 * lib/ai/aiAccess.js — candado de la IA de pago para empleados.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los 7 endpoints que disparan
 * IA de pago y el panel de permisos de Configuración → IA.)
 *
 * QUÉ RESUELVE: la IA cuesta dinero (Claude, Whisper, Google Places) y hasta
 * ahora cualquier usuario del tenant podía dispararla. Con
 * settings.aiAccess = "restringido", un empleado (rol no-admin) necesita
 * permiso del administrador: general (para siempre) o para una sola vez.
 * El admin decide en Configuración → IA. Por defecto el tenant está en
 * "libre" y nada cambia.
 *
 * CÓMO SE USA en un handler (estilo RETURN, no throw: varios endpoints de IA
 * tienen su propio try/catch que convertiría un throw en un 500 sin mensaje):
 *
 *   const veto = await vetoAi(ctx, request, "transcribir una sesión");
 *   if (veto) return veto;
 *
 * Qué hace por dentro cuando el tenant está restringido y llama un no-admin:
 *   1. Concesión general vigente → pasa.
 *   2. Concesión de una vez sin usar → pasa y la consume.
 *   3. Solicitud pendiente → 403 "sigue pendiente".
 *   4. Nada → crea la solicitud, avisa a los admins por la campana y 403.
 * Todo uso PERMITIDO deja además rastro en AuditLog (action "ai.uso") — de
 * paso cubre el hueco de que transcribe/tickets no auditaban su IA.
 *
 * Frescura: ctx.tenant.settings se cachea 60s pero el PATCH de settings
 * invalida la caché del proceso, y las filas de ai_permissions se leen de BD
 * en cada request: conceder/revocar aplica al momento.
 */

import { getMasterModels } from "../db/masterDb.js";
import { error } from "../utils/apiResponse.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** ¿El tenant exige permiso para la IA? (default: no) */
export function aiRestringido(ctx) {
  return ctx?.tenant?.settings?.aiAccess === "restringido";
}

async function notificarAdmins(ctx, texto) {
  try {
    const { User } = getMasterModels();
    const { Notification } = ctx.tenantModels;
    if (!Notification) return;
    const admins = await User.findAll({
      where: { tenantId: ctx.tenant.id, role: "admin" },
      attributes: ["id"],
    });
    for (const admin of admins) {
      await Notification.create({
        userId: admin.id,
        channel: "app",
        type: "ai_permiso_solicitado",
        title: "Permiso de IA solicitado",
        body: texto,
        entityType: "AiPermission",
        entityId: null,
      });
    }
  } catch {
    /* best-effort: sin campana no se bloquea nada */
  }
}

async function notificarSolicitante(ctx, userId, title, body) {
  try {
    const { Notification } = ctx.tenantModels;
    if (!Notification) return;
    await Notification.create({
      userId,
      channel: "app",
      type: "ai_permiso_resuelto",
      title,
      body,
      entityType: null,
      entityId: null,
    });
  } catch {
    /* best-effort */
  }
}

export { notificarSolicitante };

async function auditaUso(ctx, userId, accion) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId: ctx.tenant.id,
      userId: userId || null,
      action: "ai.uso",
      entity: "Ai",
      entityId: null,
      before: null,
      after: { accion },
      ip: null,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Devuelve null si se puede usar la IA, o una respuesta 403 lista para
 * devolver si no. `accion` es la etiqueta legible que verá el admin
 * ("transcribir una sesión", "análisis de lead"...).
 */
export async function vetoAi(ctx, request, accion) {
  try {
    const userId = ctx.user?.id || request.headers.get("x-user-id");

    // Admin: siempre puede. Y si el tenant no restringe, todos pueden.
    if (ADMIN_ROLES.has(ctx.user?.role)) {
      await auditaUso(ctx, userId, accion);
      return null;
    }
    if (!aiRestringido(ctx)) {
      await auditaUso(ctx, userId, accion);
      return null;
    }
    if (!userId) return error("No autorizado", 401);

    const { AiPermission } = ctx.tenantModels;
    if (!AiPermission) {
      // Tenant restringido pero sin la tabla migrada: se cierra, no se abre.
      return error("La IA requiere permiso del administrador y el sistema de permisos no está disponible. Avisa a soporte.", 403);
    }

    const concedidos = await AiPermission.findAll({
      where: { userId, status: "concedido" },
      order: [["decidedAt", "DESC"]],
    });

    if (concedidos.some((p) => p.scope === "general")) {
      await auditaUso(ctx, userId, accion);
      return null;
    }

    const unaVez = concedidos.find((p) => p.scope === "una-vez" && !p.usedAt);
    if (unaVez) {
      // Se consume con un UPDATE CONDICIONAL, no leyendo-y-escribiendo: dos
      // peticiones a la vez (un doble clic en "analizar con IA") leerían las
      // dos que está sin gastar y ambas pasarían, gastando dos llamadas de
      // pago con un permiso de una. Aquí solo gana la que cambia la fila.
      const [afectadas] = await AiPermission.update(
        { usedAt: new Date() },
        { where: { id: unaVez.id, usedAt: null } }
      );
      if (afectadas > 0) {
        await auditaUso(ctx, userId, `${accion} (permiso de un solo uso)`);
        return null;
      }
      // Otra petición se lo llevó: sigue el flujo normal (pendiente o nueva
      // solicitud) en vez de colarse.
    }

    const pendiente = await AiPermission.findOne({ where: { userId, status: "pendiente" } });
    if (pendiente) {
      return error(
        "Tu solicitud para usar la IA sigue pendiente: el administrador aún no la ha revisado.",
        403
      );
    }

    // Primera vez: se crea la solicitud y se avisa a los admins.
    await AiPermission.create({ userId, status: "pendiente", accion: String(accion || "").slice(0, 200) });
    const { User } = getMasterModels();
    let quien = "Un miembro del equipo";
    try {
      const u = await User.findByPk(userId, { attributes: ["email"] });
      if (u?.email) quien = u.email;
    } catch { /* con el genérico vale */ }
    await notificarAdmins(ctx, `${quien} pide usar la IA (${accion}). Concédelo o recházalo en Configuración → IA.`);

    return error(
      "Usar la IA requiere permiso del administrador. Le hemos enviado tu solicitud: en cuanto la apruebe podrás continuar.",
      403
    );
  } catch (err) {
    // Ante un fallo del sistema de permisos, se cierra (nunca IA gratis).
    if (aiRestringido(ctx) && !ADMIN_ROLES.has(ctx.user?.role)) {
      return error("No se pudo comprobar tu permiso para usar la IA. Inténtalo de nuevo.", 403);
    }
    void err;
    return null;
  }
}
