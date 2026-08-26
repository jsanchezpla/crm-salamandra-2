/**
 * lib/auth/correoCuentaDb.js — las CONSULTAS del correo de una cuenta.
 *
 * La regla vive al lado, en `correoCuenta.js`, y ese fichero no importa nada a
 * propósito: lo usa también el navegador. Aquí está lo que necesita Sequelize,
 * que solo corre en el servidor.
 *
 * Las dos funciones de este fichero existen por la misma razón: desde el
 * 26/08/2026 una cuenta tiene DOS identificadores válidos —su usuario y su
 * correo—, así que buscar por uno tiene que mirar las dos columnas, y dar de
 * alta un correo tiene que comprobar que no lo tenga ya nadie por ninguno de los
 * dos lados. Si esa comprobación se hiciera sobre una sola columna, teclear ese
 * correo señalaría a dos cuentas.
 */

import { Op } from "sequelize";
import { esCorreo, normalizarCorreo } from "./correoCuenta.js";

/**
 * Dónde buscar a quien acaba de teclear algo en la pantalla de entrar.
 *
 * Si lo tecleado NO tiene forma de correo, es un nombre de usuario y solo puede
 * estar en `email`: buscar además por `emailContacto` sería recorrer la columna
 * para nada y, peor, aceptaría como login algo que nunca se guardó ahí.
 */
export function whereDelLogin(identificador) {
  const id = normalizarCorreo(identificador);
  if (!esCorreo(id)) return { email: id };
  return { [Op.or]: [{ email: id }, { emailContacto: id }] };
}

/**
 * ¿Está libre este correo? Mira las DOS columnas.
 *
 * `exceptoId` es para poder editar una cuenta sin que choque consigo misma.
 *
 * Es una comprobación de carrera, no una garantía: quien manda de verdad es el
 * índice único `users_email_contacto_uniq`. Esto está para poder contestar con
 * una frase en castellano en vez de con un 500.
 *
 * @param {object} User modelo `master.User`
 * @returns {Promise<string|null>} la frase del problema, o `null` si está libre
 */
export async function correoLibre(User, correo, { exceptoId = null } = {}) {
  const id = normalizarCorreo(correo);
  if (!id) return null;
  const donde = { [Op.or]: [{ email: id }, { emailContacto: id }] };
  if (exceptoId) donde.id = { [Op.ne]: exceptoId };
  const choque = await User.findOne({ where: donde, attributes: ["id"] });
  return choque ? "Ese correo ya está en uso por otra cuenta." : null;
}
