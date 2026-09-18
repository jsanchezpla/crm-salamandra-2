/**
 * lib/clinica/coordinadoras.js — quién, sin ser dirección, ve el trabajo de
 * TODO el equipo (02/09/2026, AV-0022 de Aumenta; decidido por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: la misma lista la leen la portada —la
 * tarjeta de informes vencidos—, la bandeja de trabajo y Configuración, y
 * copiada en tres sitios se separaría a la primera.)
 *
 * ── DE QUÉ QUEJA NACE ──────────────────────────────────────────────────────
 * Aumenta pidió que en Inicio cada terapeuta viera solo lo suyo, que las dos
 * coordinadoras pudieran elegir de qué terapeuta ven la bandeja, y que
 * dirección lo viera todo. Lo primero y lo último ya eran así casi del todo;
 * lo que no existía era un sitio donde decir QUIÉN coordina: la bandeja solo
 * dejaba cambiar de persona a quien no tenía ficha de equipo, y en Aumenta 18
 * de 19 la tienen.
 *
 * ── LA REGLA ───────────────────────────────────────────────────────────────
 * Una lista de miembros del equipo en `settings.clinica.coordinadoras`, elegida
 * en Configuración → Módulos (mismo patrón que `citas.incidenciaPorFalta`).
 * Quien está en ella ve el centro entero donde toque —informes vencidos de
 * todos, la bandeja de cualquiera—; dirección (admin) lo ve siempre, esté o no
 * en la lista. Vacía = nadie coordina, que es como nace cualquier centro.
 */

import { limpiarResponsables } from "../citas/incidenciaPorFalta.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** Las coordinadoras del centro: ids de `team_members`, limpios y sin repetir. */
export function coordinadorasDe(tenant) {
  return limpiarResponsables(tenant?.settings?.clinica?.coordinadoras);
}

/** ¿Esta ficha de equipo coordina? Sin ficha, no. */
export function esCoordinadora(tenant, teamMemberId) {
  const id = typeof teamMemberId === "string" ? teamMemberId.trim() : "";
  if (!id) return false;
  return coordinadorasDe(tenant).includes(id);
}

/**
 * ¿Ve el trabajo de todo el equipo? Dirección siempre; el resto, si coordina.
 * Es la pregunta que hace la BANDEJA: de quién puedo mirar el trabajo.
 */
export function veTodoElEquipo({ tenant, role, teamMemberId }) {
  return ADMIN_ROLES.has(role) || esCoordinadora(tenant, teamMemberId);
}

/**
 * ¿Le AVISA Inicio del pendiente de todo el equipo? Solo dirección
 * (18/09/2026, AV-0191 de Aumenta: «¿posibilidad de que no nos salgan informes
 * vencidos de otras terapeutas?», escrito por una de las dos coordinadoras).
 *
 * Es una pregunta distinta de `veTodoElEquipo`, y por eso es otra función:
 *
 *   · La BANDEJA es donde se VA A MIRAR. Coordinar es justamente poder abrir
 *     el trabajo de otra persona, así que ahí sigue mandando `veTodoElEquipo`.
 *   · INICIO → «Pendiente» es donde te AVISAN, y un aviso solo es un aviso si
 *     es para ti. Coordinar no convierte el informe atrasado de una compañera
 *     en trabajo propio: lo único que hacía era teñir de rojo la portada de
 *     las coordinadoras con dos informes que no podían ni tocar (los borra
 *     quien los firma o dirección, `alcanceInformes.js`).
 *
 * Así queda igual que las incidencias de la misma lista, que desde el
 * 01/09/2026 ya eran «el total para quien dirige, las mías para el resto»: dos
 * tarjetas vecinas de la MISMA caja contaban a quien coordina cosas distintas.
 * Quien coordina sigue viendo el centro entero donde toca: la Bandeja con el
 * desplegable y `?vista=equipo`, y el listado de /clinica/informes.
 */
export function avisaDelPendienteDeTodos({ role }) {
  return ADMIN_ROLES.has(role);
}
