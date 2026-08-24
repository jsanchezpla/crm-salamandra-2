/**
 * lib/clients/vocabulario.js — cómo se llama el cliente en cada centro.
 *
 * (Fichero nuevo en /lib, regla #2: el rótulo lo tienen que decir IGUAL el
 * sidebar, la pantalla de Clientes, la tarjeta de Inicio y el <title> de la
 * pestaña del navegador. Escrito a mano en cada JSX, basta con que alguien
 * toque uno de los cuatro para que el menú y la pantalla dejen de coincidir.)
 *
 * ── POR QUÉ NO ES UNA LISTA DE SLUGS ────────────────────────────────────────
 * Se decide por MÓDULOS, igual que `formularioAlta.js`: un centro de nutrición
 * que se dé de alta mañana tiene que salir hablando de pacientes de fábrica,
 * sin que nadie se acuerde de añadirlo a una lista.
 *
 * ── POR QUÉ NO BASTA CON «TIENE NUTRICIÓN» ──────────────────────────────────
 * En una consulta de nutrición el cliente y el paciente son la MISMA persona
 * (nutri_laura: cada paciente es una ficha de `Client` con su menú asignado).
 * En un centro clínico NO: el cliente es la familia que paga y los pacientes
 * son los hijos, que viven en su propia tabla `patients` y ya tienen su propia
 * entrada de menú. Llamar «Pacientes» a Clientes en Aumenta dejaría DOS
 * «Pacientes» en el mismo sidebar que además no son lo mismo. Por eso
 * `pacientes` y `clinica` mandan sobre `nutricion`.
 */

/** El cliente es una cuenta: alguien a quien se le factura. */
export const VOCABULARIO_CLIENTE = {
  plural: "Clientes",
  singular: "cliente",
  unidad: "cuenta",
  unidades: "cuentas",
  area: "Cuentas",
  pistaHome: "Gestionar tu cartera",
};

/** El cliente ES el paciente: la consulta atiende a la misma persona que paga. */
export const VOCABULARIO_PACIENTE = {
  plural: "Pacientes",
  singular: "paciente",
  unidad: "ficha",
  unidades: "fichas",
  area: "Consulta",
  pistaHome: "Fichas y seguimiento",
};

/**
 * El cliente es quien te CONTRATA para actuar: un ayuntamiento, una sala, un
 * festival, una promotora. No es una cuenta a la que facturas cada mes — es
 * quien te programa una fecha concreta, y a veces una sola vez en la vida.
 */
export const VOCABULARIO_CONTRATANTE = {
  plural: "Contratantes",
  singular: "contratante",
  unidad: "contratante",
  unidades: "contratantes",
  area: "Contratación",
  pistaHome: "Salas, festivales y ayuntamientos",
};

/** `tieneModulo` es `hasModule` del contexto (servidor) o un `Set.has` (cliente). */
export function clienteEsPaciente(tieneModulo) {
  const tiene = (k) => !!tieneModulo(k);
  return tiene("nutricion") && !tiene("pacientes") && !tiene("clinica");
}

/**
 * ¿El cliente es un contratante? (módulo `booking`, 24/08/2026)
 *
 * Va por módulo como el resto de este fichero, no por slug. Y se comprueba
 * ANTES que `clienteEsPaciente` en `vocabularioCliente`, aunque hoy no puedan
 * darse a la vez: si alguna vez una agencia vendiera además planes de nutrición
 * —que es raro pero no imposible—, «Contratantes» sigue siendo lo correcto,
 * porque quien paga el bolo no es a quien se le pauta un menú.
 */
export function clienteEsContratante(tieneModulo) {
  return !!tieneModulo("booking");
}

/**
 * Ante la duda —módulos aún sin resolver, error de BD— devuelve el vocabulario
 * de siempre: «Clientes» es correcto en todas partes menos en la consulta de
 * nutrición, y «Pacientes» de más sería un error en 6 de los 7 clientes.
 */
export function vocabularioCliente(tieneModulo) {
  if (clienteEsContratante(tieneModulo)) return VOCABULARIO_CONTRATANTE;
  return clienteEsPaciente(tieneModulo) ? VOCABULARIO_PACIENTE : VOCABULARIO_CLIENTE;
}
