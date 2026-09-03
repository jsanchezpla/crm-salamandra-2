/**
 * lib/team/vocabulario.js — cómo se llama a la gente del equipo en cada centro.
 *
 * Hermano de `lib/clients/vocabulario.js`, y por la misma razón: lo que se
 * hizo para Aumenta habla de «terapeutas» —«Por terapeuta», «pásasela a otra
 * terapeuta»— y eso, en una demo o en una cuenta general, suena a que el CRM
 * es de clínicas. Rodrigo, 03/09/2026: «todas estas cosas que implementamos
 * con nombre propio en Aumenta han de tener nombre neutro en las demos y las
 * cuentas generales (por miembro, por ejemplo)».
 *
 * ── POR QUÉ SE DECIDE POR MÓDULO ────────────────────────────────────────────
 * Igual que el vocabulario del cliente: un centro clínico que se dé de alta
 * mañana tiene que salir hablando de terapeutas de fábrica, sin que nadie
 * lo apunte en una lista. Quien tiene el módulo de Clínica tiene terapeutas;
 * el resto tiene miembros del equipo. (La página de Citas añade la excepción
 * de las cuentas generales, que tienen TODOS los módulos y no son una clínica.)
 *
 * ── POR QUÉ HAY TANTAS FORMAS ───────────────────────────────────────────────
 * «Terapeuta» va en femenino en el CRM desde el primer día (el equipo de
 * Aumenta lo es) y «miembro» es masculino: no basta con cambiar la palabra,
 * cambia el artículo en cada frase. Cada forma que usa la pantalla está aquí
 * para que ninguna se escriba a mano con el género equivocado.
 */

/** Alguien del equipo, sin decir a qué se dedica. */
export const VOCABULARIO_MIEMBRO = {
  singular: "miembro",
  plural: "miembros",
  un: "un miembro",
  otro: "otro miembro",
  ese: "ese miembro",
  ninguno: "ningún miembro",
  los: "los miembros",
  porRotulo: "Por miembro",
};

/** El equipo de un centro clínico. */
export const VOCABULARIO_TERAPEUTA = {
  singular: "terapeuta",
  plural: "terapeutas",
  un: "una terapeuta",
  otro: "otra terapeuta",
  ese: "esa terapeuta",
  ninguno: "ninguna terapeuta",
  los: "las terapeutas",
  porRotulo: "Por terapeuta",
};

/** `tieneModulo` es `hasModule` del contexto (servidor) o un `Set.has` (cliente). */
export function equipoSonTerapeutas(tieneModulo) {
  return !!tieneModulo("clinica");
}

/**
 * Ante la duda —módulos sin resolver, error de BD— el nombre neutro: «miembro»
 * no está mal en ningún centro; «terapeuta» de más sí lo estaría en la mayoría.
 */
export function vocabularioEquipo(tieneModulo) {
  return equipoSonTerapeutas(tieneModulo) ? VOCABULARIO_TERAPEUTA : VOCABULARIO_MIEMBRO;
}
