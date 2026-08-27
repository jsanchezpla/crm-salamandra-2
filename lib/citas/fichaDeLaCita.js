/**
 * lib/citas/fichaDeLaCita.js — desde una cita, ¿a qué ficha se puede saltar?
 *
 * (Fichero nuevo en /lib, regla #2. El motivo: es un «si tiene X enseña Y» con
 * dos condiciones —que la cita esté enlazada a una ficha y que el centro tenga
 * el módulo— y un rótulo que cambia por cliente. Suelto por el JSX serían tres
 * `if` anidados sin nombre y sin prueba; aquí es una función que devuelve lo
 * que hay que pintar, o `null` si no hay nada.)
 *
 * ── DE DÓNDE SALE (27/08/2026, Jorge) ───────────────────────────────────────
 * La pregunta abierta era si el modal de una cita tenía que enseñar un resumen
 * de la ÚLTIMA SESIÓN del paciente. La respuesta fue que no: basta un botón que
 * lleve a la ficha. Y es la barata — leer la última sesión sería una consulta
 * clínica nueva en cada clic de la agenda; esto es pintar un dato que la cita
 * ya trae (`clientId` viaja en el GET desde siempre).
 *
 * ── POR QUÉ NO BASTABA CON LO QUE YA HABÍA ──────────────────────────────────
 * El modal tenía «Ver ficha» desde el 26/08, pero colgando del PACIENTE: solo
 * aparece si la cita tiene `patientId` y si el centro tiene el módulo. Medido en
 * producción el 27/08:
 *
 *   · aumenta      12.030 citas, las 12.030 con paciente Y con cliente
 *   · nutri_laura      18 citas, las 18 con cliente y NINGUNA con paciente
 *                      (no tiene `pacientes`: sus pacientes SON fichas de
 *                      `Client`), así que en su agenda no había ni un botón
 *   · las 4 demos      26 citas cada una, ninguna enlazada a nada
 *
 * O sea que la mitad del CRM que más usa la agenda tenía el salto y la otra
 * mitad no, por una razón que no era de producto sino de qué tabla guardaba a la
 * persona. El botón del cliente lo arregla para las dos: en Aumenta lleva a la
 * FAMILIA (bonos, facturas, documentos) y en la consulta de Laura, a la ficha de
 * la paciente, que es la misma persona.
 *
 * ── EL RÓTULO NO SE ESCRIBE AQUÍ ────────────────────────────────────────────
 * Sale de `vocabularioCliente()`, que ya decide por MÓDULOS si el cliente se
 * llama cliente, paciente o contratante. Escribir «Cliente» a fuego dejaría la
 * agenda de Laura hablando de clientes mientras su menú dice «Pacientes».
 */

import { VOCABULARIO_CLIENTE } from "../clients/vocabulario.js";

/** «cliente» → «Cliente». Los demás rótulos del modal van así. */
function conMayuscula(palabra) {
  const s = String(palabra ?? "").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/**
 * Qué botón de ficha lleva esta cita, o `null` si ninguno.
 *
 * @param booking      la cita tal y como la devuelve el GET (lleva `clientId`)
 * @param conClientes  ¿el centro tiene el módulo `clients`? Lo resuelve el
 *                     servidor y baja por props: el modal es "use client" y no
 *                     puede preguntarlo. Ante la duda, `false`: un botón que
 *                     lleva a una pantalla que no existe es peor que no tenerlo.
 * @param vocabulario  el de `vocabularioCliente()`. Por defecto, «Cliente».
 * @returns `{ href, rotulo }` o `null`
 */
export function fichaDeLaCita(booking, { conClientes = false, vocabulario = VOCABULARIO_CLIENTE } = {}) {
  if (!conClientes) return null;
  const id = booking?.clientId;
  // La cita puede no estar enlazada a ninguna ficha: se apuntó a mano con el
  // nombre escrito y nada más. Entonces no hay ficha a la que ir — y una URL
  // con «undefined` dentro daría un 404 con pinta de fallo del CRM.
  if (!id || typeof id !== "string" || !id.trim()) return null;
  return {
    href: `/clientes/${id.trim()}`,
    rotulo: conMayuscula(vocabulario?.singular) || "Cliente",
  };
}
