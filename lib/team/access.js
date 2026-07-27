/**
 * lib/team/access.js — alta y gestión de USUARIOS DE LOGIN desde el módulo
 * Equipo. (Fichero nuevo en /lib, regla #2: esta lógica la comparten las rutas
 * /api/team/modules, /api/team/[id]/access y /api/team/[id]/access/password.)
 *
 * Hasta ahora los logins del equipo solo se creaban por script
 * (scripts/seed-aumenta-equipo-real.js, las terapeutas de Aumenta). Esto lleva
 * ese patrón exacto a la UI: username sin @ guardado en master.users.email,
 * rol `user`, y moduleAccess con las claves de módulo que el empleador marque.
 * El enforcement NO se toca: hasModule() ya cruza módulo del tenant ∩
 * moduleAccess del usuario en cada request.
 */

import crypto from "node:crypto";
import { getMasterModels } from "../db/masterDb.js";

/** Roles que puede gestionar este flujo. Los admin se gestionan por script. */
export const MANAGEABLE_ROLES = new Set(["user", "manager"]);

/**
 * Normaliza el login que escribió el admin.
 *
 * El login del CRM busca el campo email EN MINÚSCULAS y tal cual
 * (app/api/auth/login: trim + lowerCase), así que guardar "María" crearía una
 * cuenta imposible de usar. Además `users.email` es único GLOBAL (entre todos
 * los tenants): a los usernames sin @ se les añade el sufijo `_{slug}` para que
 * la "maria" de un tenant no bloquee a la "maria" de otro — es el patrón de
 * Aumenta (maria_aumenta).
 *
 * Devuelve { username } o { error } con el motivo en cristiano.
 */
export function normalizeUsername(raw, slug) {
  let u = String(raw ?? "").trim().toLowerCase();
  // Tildes y diacríticos fuera: "maría" → "maria".
  u = u.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!u) return { error: "Escribe el nombre de usuario" };

  if (u.includes("@")) {
    // Email real: se respeta tal cual (algunos tenants prefieren emails).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(u)) return { error: "El email no tiene un formato válido" };
    if (u.length > 190) return { error: "El email es demasiado largo" };
    return { username: u };
  }

  if (!/^[a-z0-9._-]+$/.test(u)) {
    return { error: "El usuario solo puede llevar letras sin tilde, números, punto, guión y guión bajo" };
  }
  if (!u.endsWith(`_${slug}`)) u = `${u}_${slug}`;
  if (u.length < 3 + slug.length) return { error: "El usuario es demasiado corto" };
  if (u.length > 190) return { error: "El usuario es demasiado largo" };
  return { username: u };
}

/**
 * Contraseña inicial/reseteada: aleatoria, 12 caracteres legibles.
 * Mismo patrón que scripts/reset-tenant-admin-password.js; base64url para no
 * generar `+` ni `/`, que se copian mal.
 */
export function generatePassword() {
  return crypto.randomBytes(9).toString("base64url").slice(0, 12);
}

/** Claves de módulo ACTIVAS del tenant (master.tenant_modules), ordenadas. */
export async function getTenantModuleKeys(tenantId) {
  const { TenantModule } = getMasterModels();
  const rows = await TenantModule.findAll({
    where: { tenantId, enabled: true },
    attributes: ["moduleKey"],
    order: [["moduleKey", "ASC"]],
  });
  return rows.map((r) => r.moduleKey);
}

/**
 * Filtra la lista que mandó el cliente contra los módulos reales del tenant.
 * Devuelve claves únicas y en orden estable.
 */
export function filterModules(requested, tenantKeys) {
  const valid = new Set(tenantKeys);
  const out = [];
  for (const k of Array.isArray(requested) ? requested : []) {
    const key = typeof k === "string" ? k.trim() : "";
    if (key && valid.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Mantiene la tabla informativa team_member_modules como ESPEJO del
 * moduleAccess real, para que la ficha del empleado no cuente una historia
 * distinta de la del login. Best-effort: si el tenant no tiene la tabla, no
 * pasa nada (el gate real vive en master).
 */
export async function syncMemberModules({ tenantModels, tenantSequelize, memberId, enabledKeys, allKeys }) {
  const { TeamMemberModule } = tenantModels;
  if (!TeamMemberModule) return;
  const enabled = new Set(enabledKeys);
  try {
    await tenantSequelize.transaction(async (t) => {
      for (const moduleKey of allKeys) {
        const [row, created] = await TeamMemberModule.findOrCreate({
          where: { teamMemberId: memberId, moduleKey },
          defaults: { enabled: enabled.has(moduleKey) },
          transaction: t,
        });
        if (!created && row.enabled !== enabled.has(moduleKey)) {
          await row.update({ enabled: enabled.has(moduleKey) }, { transaction: t });
        }
      }
    });
  } catch {
    /* espejo informativo: nunca tumba la operación real */
  }
}

/**
 * Carga el User de master enlazado a un miembro y comprueba que este flujo
 * puede gestionarlo. Devuelve { user } o { error, status }.
 *
 * Guardas deliberadas:
 *  - Solo usuarios del PROPIO tenant (un userId colgado de otro tenant sería
 *    un dato corrupto, pero nunca se debe poder editar desde aquí).
 *  - Solo roles user/manager: las cuentas admin/superadmin no se tocan desde
 *    Equipo (ni módulos, ni contraseña, ni borrado) — evita que un admin
 *    secuestre o rompa la cuenta de otro admin desde una pantalla de RRHH.
 *  - Nadie se gestiona a sí mismo desde aquí (requesterUserId).
 */
export async function loadManagedUser({ userId, tenantId, requesterUserId }) {
  const { User } = getMasterModels();
  const user = await User.findByPk(userId);
  if (!user || user.tenantId !== tenantId) {
    return { error: "El usuario enlazado ya no existe", status: 404 };
  }
  if (!MANAGEABLE_ROLES.has(user.role)) {
    return { error: "Es una cuenta de administrador: se gestiona aparte, no desde Equipo", status: 403 };
  }
  if (requesterUserId && user.id === requesterUserId) {
    return { error: "No puedes gestionar tu propio acceso desde aquí", status: 403 };
  }
  return { user };
}
