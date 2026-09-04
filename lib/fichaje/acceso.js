/**
 * lib/fichaje/acceso.js — quién puede entrar en el control horario.
 *
 * Hasta el 04/09/2026 la respuesta era «solo dirección»: el menú llevaba
 * `adminOnly`, la página hacía `notFound()` con cualquier rol que no fuera
 * admin y los siete endpoints repetían `ADMIN.has(x-user-role)` encima de su
 * `hasModule("fichaje")`. El motivo escrito era «son datos laborales», y es
 * cierto: no es una pantalla para todo el equipo.
 *
 * Pero «no para todo el equipo» y «solo para administradores» no son lo mismo,
 * y confundirlos dejaba fuera a quien de verdad lleva el control horario. En
 * Aumenta lo lleva Olga, que es recepción y NO es administradora: darle
 * Fichajes obligaba a hacerla admin —y con ello Dirección, Desempeño,
 * Productividad y la facturación entera— por ver una tabla de horas
 * (Rodrigo, 04/09/2026: «a Olga le falta Fichajes también»).
 *
 * La llave pasa a ser la que el CRM ya usa para todo lo demás: **tener el
 * módulo concedido**. `master.users.module_access` se otorga uno a uno desde
 * Equipo → Usuarios, así que nadie lo hereda por descuido: hoy, con el módulo
 * encendido en un solo cliente, la lista de quien tiene `fichaje` escrito está
 * vacía y solo entran los tres admins por su comodín `all`. Sigue sin ser una
 * pantalla para todo el equipo; ahora, además, se puede dar sin regalar el CRM.
 *
 * Vive aquí y no suelto en el JSX porque la decisión la toman TRES sitios —el
 * menú, la página y los endpoints— y tienen que decir lo mismo: si divergen, o
 * se ve una entrada que luego da 403, o se esconde una pantalla que la API sí
 * abre. Los endpoints la aplican por `hasModule("fichaje")` de
 * `getTenantContext`, que ya cruza tenant ∩ usuario; el menú y la página, que
 * no tienen ese contexto a mano, llaman a esta función con lo que sí tienen.
 */

/** El comodín de los administradores en `module_access`. */
const COMODIN = "all";

/**
 * ¿Puede esta persona usar el control horario?
 *
 * Falla en CERRADO por lo mismo que `loadUserAccess` en
 * `lib/tenant/tenantResolver.js`: un `moduleAccess` que no es lista (nulo,
 * corrupto, a medio migrar) no concede nada. Un error no puede dar MÁS acceso.
 *
 * @param {object}   args
 * @param {string}   args.role            rol real del usuario, leído fresco de BD.
 * @param {string[]} args.moduleAccess    `master.users.module_access`.
 * @param {boolean}  args.tenantLoTiene   el módulo `fichaje`, encendido en el tenant.
 * @returns {boolean}
 */
export function puedeUsarFichaje({ role, moduleAccess, tenantLoTiene } = {}) {
  // Primera puerta, y no se salta ni con comodín: si el cliente no ha
  // contratado Fichaje, aquí no entra nadie. `superadmin` incluido — el
  // soporte de Salamandra tampoco inventa un módulo que no existe.
  if (!tenantLoTiene) return false;

  if (role === "superadmin") return true;

  if (!Array.isArray(moduleAccess)) return false;
  return moduleAccess.includes(COMODIN) || moduleAccess.includes("fichaje");
}
