/**
 * lib/billing/facturasDelPaciente.js — qué facturas se ven en la ficha de un
 * paciente (09/09/2026).
 *
 * ── DE QUÉ ENCARGO NACE ────────────────────────────────────────────────────
 * De las 14.248 facturas de Aumenta, 14.245 llegaron del volcado de Organízate
 * atadas solo a la FAMILIA que paga: allí la factura es del pagador, no del
 * niño. El 09/09/2026 se repartieron las 11.281 que no tenían ambigüedad —las
 * de familias con un solo hijo—, y quedaron **2.964 de 76 familias con
 * hermanos** que no se pueden repartir con nada: la línea de las 2.964 dice
 * literalmente «Importado de Organízate», sin concepto ni terapia, y el nombre
 * de un hermano no aparece en ninguna.
 *
 * Rodrigo: «las facturas que sobran déjalas en la ficha de familia y pónselas a
 * todos los pacientes por igual, por si las buscan en uno de los pacientes de
 * cada familia que les salgan y no tengan que buscar esas específicamente en la
 * ficha de familia».
 *
 * ── CÓMO SE HACE, Y CÓMO NO ────────────────────────────────────────────────
 * NO duplicando filas ni repartiéndolas a ojo: una factura tiene un importe y
 * un número, y copiarla a cada hermano doblaría el dinero en cualquier suma que
 * cuente por paciente. Y ponerle un `patient_id` adivinado sería escribir en el
 * histórico fiscal una cosa que nadie sabe.
 *
 * Se hace al MIRAR: la ficha de un paciente enseña las suyas **más las de su
 * familia que no son de nadie en concreto**, marcadas como tales. Así aparecen
 * en la ficha de cada hermano —que es lo que se pedía— sin afirmar que sean de
 * ninguno, y sin tocar una sola fila.
 *
 * La marca importa tanto como la lista: sin ella, en una familia con dos hijos
 * la misma factura sale en las dos fichas sin decir por qué, y quien cobra
 * piensa que hay dos.
 *
 * Puro: sin base de datos. Prueba en `scripts/_smoke-facturas-del-paciente.mjs`.
 */

/**
 * El `where` de las facturas que se ven en la ficha de un paciente.
 *
 * @param {object} args
 * @param {string} args.patientId
 * @param {?string} args.clientId          la familia del paciente, si se sabe.
 * @param {boolean} [args.conLasDeLaFamilia] si no, solo las suyas (lo de antes).
 * @param {object} args.Op                 los operadores de Sequelize.
 */
export function whereFacturasDelPaciente({ patientId, clientId = null, conLasDeLaFamilia = false, Op }) {
  if (!conLasDeLaFamilia || !clientId) return { patientId };
  return {
    [Op.or]: [
      { patientId },
      // Las de su familia que no son de ningún hermano en concreto.
      { clientId, patientId: null },
    ],
  };
}

/**
 * ¿Esta factura es «de la familia» y no de este paciente?
 *
 * Lo que decide es que NO tenga paciente, no de quién sea: una factura del
 * hermano no entra aquí (ni en el `where` de arriba).
 */
export function esDeLaFamilia(factura) {
  return !factura?.patientId;
}

/** La lista partida en dos, que es como la pinta la ficha. */
export function repartirFacturas(facturas = []) {
  const lista = Array.isArray(facturas) ? facturas : [];
  return {
    suyas: lista.filter((f) => !esDeLaFamilia(f)),
    deLaFamilia: lista.filter(esDeLaFamilia),
  };
}
