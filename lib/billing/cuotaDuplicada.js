/**
 * lib/billing/cuotaDuplicada.js — CUÁNDO una cuota nueva es un duplicado
 * (18/09/2026, AV-0195 de Isabel y la tarea «Mensaje cuota activa» del
 * Registro).
 *
 * (Fichero nuevo en /lib, regla #2: es la parte decidible SIN base de datos
 * del alta de cuotas —mirar lo que ya tiene y decir si lo que llega repite—,
 * y la fija `scripts/_smoke-cuota-duplicada.mjs`.)
 *
 * ── EL PROBLEMA, MEDIDO ─────────────────────────────────────────────────────
 * El alta en grupo se saltaba a quien ya tuviera CUALQUIER cuota viva, mirando
 * solo cliente + paciente:
 *
 *     Cuota.findOne({ where: { clientId, patientId, active: true } })
 *
 * El freno se puso contra el doble clic («40 familias no pueden convertirse en
 * 40 cuotas repetidas»), pero un niño que va a logopedia Y a terapia
 * ocupacional son dos cuotas distintas, no un doble clic. Así que quien ya
 * pagaba algo no podía entrar en ninguna otra cuota: el centro lo contó dos
 * veces —«aunque el paciente no tenga esa cuota nos dice que ya tiene una
 * cuota activa» y «hemos añadido a Aumentín a T.O. 60x1 y no aparece»—.
 *
 * En producción, el 18/09/2026: **284 de 284** parejas cliente+paciente con
 * cuota viva chocaban con el freno (277 con una cuota, 7 con varias), y de las
 * 7 que sí tienen varias **ninguna** comparte concepto: son dos terapias, o
 * sea justo lo legítimo. Es decir, el freno no llegó a parar un duplicado de
 * verdad nunca; solo impedía altas buenas.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 * Repetir es volver a cobrar LO MISMO, no cobrar otra cosa:
 *
 *   · la cuota nueva trae conceptos → repite si ya hay una viva que lleve
 *     alguno de ellos (misma terapia, mismo mes: eso sí es el doble clic);
 *   · la cuota nueva no trae ninguno (importe suelto pactado) → repite si ya
 *     hay otra viva también sin conceptos, que es la única forma de saber que
 *     se está pidiendo dos veces lo mismo.
 *
 * Y el motivo se dice con el nombre de la cuota que choca, porque «ya tiene
 * una cuota activa» a secas es lo que hizo que el centro creyera que el CRM
 * se había perdido el alta.
 */

/** Los ids de concepto de una cuota, como texto y sin repetir. */
function idsDe(cuota) {
  const ids = Array.isArray(cuota?.conceptIds) ? cuota.conceptIds : [];
  return new Set(ids.map(String).filter(Boolean));
}

/**
 * La cuota viva que repite lo que se está dando de alta, o `null`.
 *
 * @param {Array} vivas   Las cuotas activas de ESA pareja cliente+paciente.
 * @param {Array} conceptIds Los conceptos de la que se quiere crear.
 */
export function cuotaQueRepite(vivas = [], conceptIds = []) {
  const nuevos = new Set((Array.isArray(conceptIds) ? conceptIds : []).map(String).filter(Boolean));
  for (const cuota of Array.isArray(vivas) ? vivas : []) {
    const suyos = idsDe(cuota);
    if (!nuevos.size) {
      // Importe suelto contra importe suelto: no hay concepto por el que
      // distinguirlas, así que dos seguidas son la misma.
      if (!suyos.size) return cuota;
      continue;
    }
    for (const id of nuevos) if (suyos.has(id)) return cuota;
  }
  return null;
}

/**
 * El motivo que se le enseña a quien da el alta, con el nombre de la cuota que
 * choca: «ya tiene esta cuota activa (Cuota T.O. 60x1)».
 *
 * @param {object} cuota          La que choca (de `cuotaQueRepite`).
 * @param {Map}    conceptosPorId Catálogo por id, para poder nombrarla.
 */
export function motivoDeRepetida(cuota, conceptosPorId = new Map()) {
  const ids = [...idsDe(cuota)];
  if (!ids.length) return "ya tiene una cuota activa con importe suelto";
  const nombres = ids.map((id) => conceptosPorId.get(String(id))?.name).filter(Boolean);
  if (!nombres.length) return "ya tiene esta cuota activa";
  return `ya tiene esta cuota activa (${nombres.join(" + ")})`;
}
