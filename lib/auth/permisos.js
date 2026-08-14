/**
 * lib/auth/permisos.js — quién puede QUÉ, por TIPO DE ACCIÓN (14/08/2026).
 *
 * (Fichero nuevo en /lib, regla #2: esta regla la necesitan endpoints de medio
 * CRM y hoy vive copiada como `const ADMIN_ROLES = new Set([...])` en una
 * veintena de ficheros. Copiada veinte veces, el día que cambie se queda vieja
 * en diecinueve — y la que se quede vieja es la que deja pasar de más.)
 *
 * ── LA REGLA (Rodrigo, 14/08/2026) ──────────────────────────────────────────
 * El CRM lo usa a diario gente que no dirige el centro pero hace el trabajo:
 * terapeutas, nutricionistas, recepción. El reparto es por TIPO DE ACCIÓN, no
 * por cargo:
 *
 *   · DECISIONES MATADORAS —destruir una ficha con su historia detrás, y en
 *     general lo que no se puede deshacer— → SOLO ADMIN.
 *
 *   · DINERO —facturar, cobrar, tarifas, costes— → admin, y TAMBIÉN quien
 *     tenga el módulo de facturación aunque su rol sea `user`. En Aumenta,
 *     Olga y Rosa no son terapeutas: llevan la contabilidad y su rol es
 *     `user` con `billing` en su acceso. Por eso el dinero se gatea con
 *     `hasModule("billing")` y NUNCA con el rol.
 *
 *   · TODO LO DEMÁS → cualquiera del equipo que tenga el módulo, hasta que se
 *     diga lo contrario. Editar una ficha, apuntar en la historia clínica,
 *     subir un documento, confirmar una sesión: eso es el trabajo, no un
 *     privilegio.
 *
 * Lo que NO es matador no se cierra por si acaso. Una puerta de más obliga a
 * interrumpir a la jefa para cada gesto, y eso acaba en que el equipo comparte
 * la cuenta de admin — que es bastante peor que no haber cerrado nada. El caso
 * que lo destapó: la ficha de paciente de nutri_laura llevaba meses cerrada a
 * todo el equipo por una lista de roles con una errata.
 *
 * Ojo con la excepción que ya existía y NO es esto: en `consultaExterna.js`,
 * quién ve a un paciente externo. Ahí ser admin no va de destruir nada, va de
 * quién puede mirar; se queda donde está y con sus motivos.
 */

const ROLES_ADMIN = new Set(["admin", "superadmin"]);

/**
 * ¿Manda esta persona? Es lo que se comprueba ANTES de una decisión matadora.
 *
 * Para el dinero NO se usa esto: se usa `hasModule("billing")` (ver arriba).
 */
export function esAdmin(role) {
  return ROLES_ADMIN.has(role);
}

/**
 * El rol de quien hace la petición.
 *
 * `withTenant` reescribe `x-user-role` con el rol REAL de la base de datos
 * antes de llamar al handler —el del JWT tiene 15 minutos de vida—, así que
 * aquí ya es de fiar y degradar a alguien surte efecto al instante.
 * Sin cabecera se asume `user`, que es el mínimo: fallar en cerrado.
 */
export function rolDe(request) {
  return request.headers.get("x-user-role") ?? "user";
}
