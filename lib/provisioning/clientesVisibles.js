/**
 * Qué clientes se ven en el back-office — un solo sitio para decidirlo.
 *
 * QUÉ RESUELVE (10/08/2026, pedido de Jorge)
 * Había dos clientes suspendidos a propósito —`healim` y `quality_energy`— y
 * salían en TODAS las pantallas internas como si fueran clientes en marcha:
 * contaban en los totales de Custodia, en la matriz de módulos y en los
 * recuentos de integraciones. Un cliente suspendido no es un cliente ahora
 * mismo, y colarlo en los números hace que las cuatro pantallas mientan a la vez
 * — «6 clientes» cuando hay 4, «esta integración la usan 3» cuando la usan 2.
 *
 * POR ESTADO, NUNCA POR SLUG (regla 12)
 * La tentación era filtrar `healim` y `quality_energy` a mano. Sería mentira a
 * los quince días: el tercero que se suspenda volvería a ensuciar los números y
 * nadie se acordaría de este fichero. Se filtra por `status`, que es el dato que
 * ya existe y el que cambia solo cuando alguien suspende o reactiva desde
 * `lib/provisioning/cicloVida.js`.
 *
 * ⚠️ LA PUERTA DE VUELTA — por qué no se esconden en TODAS partes
 * Si un suspendido desaparece del back-office entero, no queda ninguna manera de
 * reactivarlo salvo entrar a la base de datos a mano. Por eso `/admin/clientes`
 * —la única pantalla que sabe suspender y reactivar— puede pedirlos con
 * `?incluirSuspendidos=1`, detrás de un interruptor que viene APAGADO. Las
 * pantallas que solo miran y cuentan (Custodia, Módulos, Integraciones) no los
 * piden nunca.
 *
 * NO BORRA NADA. Un tenant suspendido conserva su schema, sus datos y sus
 * módulos; esto solo decide a quién se le enseña.
 *
 * ── UNA DEMO NO ES UN CLIENTE (13/08/2026) ──────────────────────────────────
 * El mismo problema, por otra puerta. Al partir la demo en una por oficio pasan
 * a existir cuatro tenants de escaparate, y sin esto las pantallas que cuentan
 * dirían «11 clientes» donde hay siete. Peor que el número: Custodia los pintaría
 * en rojo con «Sin ninguna clave configurada» y «Le faltan: …» — reclamando
 * credenciales a unas cuentas que NO PUEDEN tener ninguna, porque son públicas y
 * dan sesión de admin a cualquiera (lib/demo/isDemo.js). Una lista de tareas
 * pendientes que nunca se pueden hacer es peor que no tenerla.
 *
 * Se excluyen de las pantallas que MIRAN Y CUENTAN (Custodia, Módulos,
 * Integraciones) y se mantienen en `/admin/clientes`, que es la que las
 * administra — mismo reparto que con los suspendidos, y por el mismo motivo: si
 * desaparecieran de todas partes no habría forma de tocarlas sin entrar a la
 * base de datos.
 */

import { Op } from "sequelize";
import { DEMO_SLUGS } from "../demo/demos.js";

/** El único estado que cuenta como cliente en marcha. */
export const ESTADO_EN_MARCHA = "active";

/**
 * `where` para un `Tenant.findAll` del back-office.
 *
 * @param {boolean} [incluirSuspendidos=false]
 * @param {object}  [opciones]
 * @param {boolean} [opciones.incluirDemos=false] las cuatro cuentas de escaparate
 * @returns {object} `where` de Sequelize
 */
export function whereClientesVisibles(incluirSuspendidos = false, { incluirDemos = false } = {}) {
  const where = incluirSuspendidos ? {} : { status: ESTADO_EN_MARCHA };
  if (!incluirDemos) where.slug = { [Op.notIn]: DEMO_SLUGS };
  return where;
}

/**
 * Lee el parámetro de la URL. Solo `1` o `true` abren la mano: cualquier otra
 * cosa —y que no venga— deja fuera a los suspendidos, que es el defecto seguro.
 */
export function pideSuspendidos(request) {
  try {
    const v = new URL(request.url).searchParams.get("incluirSuspendidos");
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}
