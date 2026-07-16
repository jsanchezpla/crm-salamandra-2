/**
 * Normaliza los items de un checklist de Task.
 *
 * El checklist es un array JSONB PLANO de { id, text, done } (no hay jerarquía
 * principal/hijas). El bug histórico "marcar uno marca todos" viene de items
 * SIN `id` (o con id duplicado): el toggle compara `it.id === id` y
 * `undefined === undefined` (o dos ids iguales) matchea varios a la vez.
 *
 * Esta función garantiza que cada item tenga un `id` único y un shape limpio
 * ({ id, text, done }). Se usa al cargar en el drawer (arregla datos antiguos
 * al mostrarlos) y al persistir en POST/PATCH (limpia lo que se guarda).
 *
 * `crypto.randomUUID()` está disponible en navegador y en Node ≥ 18.
 */
export function normalizeChecklistItems(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.map((raw) => {
    // Un item puede llegar como string suelto ("comprar leche") en datos
    // legacy/seed; tratarlo como { text } para NO perder el texto al normalizar.
    const it = typeof raw === "string" ? { text: raw } : raw;
    let id = typeof it?.id === "string" && it.id && !seen.has(it.id) ? it.id : crypto.randomUUID();
    seen.add(id);
    return { id, text: String(it?.text ?? ""), done: !!it?.done };
  });
}
