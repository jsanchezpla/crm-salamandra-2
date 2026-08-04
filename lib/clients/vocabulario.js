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

/** `tieneModulo` es `hasModule` del contexto (servidor) o un `Set.has` (cliente). */
export function clienteEsPaciente(tieneModulo) {
  const tiene = (k) => !!tieneModulo(k);
  return tiene("nutricion") && !tiene("pacientes") && !tiene("clinica");
}

/**
 * Ante la duda —módulos aún sin resolver, error de BD— devuelve el vocabulario
 * de siempre: «Clientes» es correcto en todas partes menos en la consulta de
 * nutrición, y «Pacientes» de más sería un error en 6 de los 7 clientes.
 */
export function vocabularioCliente(tieneModulo) {
  return clienteEsPaciente(tieneModulo) ? VOCABULARIO_PACIENTE : VOCABULARIO_CLIENTE;
}
