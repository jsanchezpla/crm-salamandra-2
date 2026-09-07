/**
 * lib/citas/bonoDelPaciente.js — de quién es el bono dentro de la familia
 * (08/09/2026, AV-0055 de Aumenta).
 *
 * Olga: «los bonos tendrían que reflejarse por paciente no cliente o estar
 * enlazados». El bono colgaba de la FAMILIA —por correo o por ficha—, así que
 * en una familia con dos hermanos el bono de uno se le gastaba al otro: las
 * citas del hermano equivocado descontaban del mismo montón y nadie lo veía.
 *
 * ── POR QUÉ ESTÁ AQUÍ Y NO EN `packs.js` ───────────────────────────────────
 * Porque esto lo necesita el NAVEGADOR: el desplegable de «Bono de sesiones»
 * del alta de citas tiene que ofrecer solo los que se le pueden gastar a ese
 * niño. `packs.js` importa Sequelize, y meterlo en un componente de cliente se
 * lleva el ORM entero al bundle. Aquí no hay dependencias: son dos funciones
 * sobre un array.
 *
 * `patientId` a null en un bono = de la familia entera, que es lo que hay en
 * todos los que ya estaban dados y lo que se sigue ofreciendo a cualquiera de
 * sus pacientes. La compatibilidad es el caso por defecto, no un apaño.
 */

/**
 * ¿Este bono se le puede gastar a este paciente?
 *
 * Sin paciente en el bono, sí: es de la familia. Sin paciente en la CITA
 * tampoco se niega —el área privada reserva a nombre de la familia y ahí no
 * hay con qué decidir—: negarlo dejaría a una familia sin poder usar un bono
 * que ha pagado.
 */
export function packValeParaPaciente(pack, patientId) {
  const suyo = pack?.patientId ?? null;
  if (!suyo) return true;
  if (!patientId) return true;
  return String(suyo) === String(patientId);
}

/**
 * Los bonos de la familia ordenados para ESTE paciente: primero los suyos,
 * después los de la familia, y fuera los de un hermano.
 *
 * Ordena en vez de solo filtrar porque la regla de siempre —se gasta el más
 * antiguo primero— tiene que seguir valiendo DENTRO de cada grupo, y un bono
 * comprado para el niño se gasta antes que uno genérico de la familia.
 */
export function packsParaPaciente(packs, patientId) {
  const lista = Array.isArray(packs) ? packs : [];
  if (!patientId) return [...lista];
  const suyos = [];
  const deLaFamilia = [];
  for (const p of lista) {
    const suyo = p?.patientId ?? null;
    if (!suyo) deLaFamilia.push(p);
    else if (String(suyo) === String(patientId)) suyos.push(p);
  }
  return [...suyos, ...deLaFamilia];
}
