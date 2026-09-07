/**
 * lib/clinica/objetivosDelPlan.js — los objetivos del Plan de intervención,
 * cada uno con su terapeuta (07/09/2026, AV-0061 de Aumenta).
 *
 * Estefanía: «hay pacientes compartidos y los objetivos cambian según la
 * especialidad; una pestaña dentro de Plan donde añadir nuestro nombre». El
 * Plan es uno por paciente (`intervention_plans.patient_id` único) y sus
 * objetivos eran una lista de textos planos: dos terapeutas escribían en la
 * misma lista sin saber cuál era de quién.
 *
 * ── LA FORMA ────────────────────────────────────────────────────────────────
 * `objectives` sigue siendo un JSONB; cada elemento pasa a ser
 * `{ texto, terapeutaId }` (id de `team_members`, o null = sin atribuir). Los
 * planes viejos —textos sueltos— se leen igual: un texto es un objetivo sin
 * terapeuta, y se convierte al guardar. Nada se migra: `normalizarObjetivos`
 * acepta las dos formas y devuelve siempre la nueva.
 *
 * Quien necesite SOLO los textos (la IA que propone objetivos, un informe) usa
 * `textosDeObjetivos`. Y la pantalla agrupa con `agruparPorTerapeuta`.
 *
 * Puro: sin base ni modelos. Prueba en `scripts/_smoke-objetivos-del-plan.mjs`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_OBJETIVOS = 40;
export const MAX_TEXTO_OBJETIVO = 300;

const limpio = (v) => (typeof v === "string" ? v.trim().slice(0, MAX_TEXTO_OBJETIVO) : "");

/** Un objetivo de cualquiera de las dos formas → `{ texto, terapeutaId }` o null. */
export function normalizarObjetivo(o) {
  if (typeof o === "string") {
    const texto = limpio(o);
    return texto ? { texto, terapeutaId: null } : null;
  }
  if (!o || typeof o !== "object") return null;
  const texto = limpio(o.texto ?? o.text ?? "");
  if (!texto) return null;
  const id = typeof o.terapeutaId === "string" && UUID_RE.test(o.terapeutaId) ? o.terapeutaId : null;
  return { texto, terapeutaId: id };
}

/**
 * La lista entera: textos y objetos mezclados → objetos, sin vacíos, sin
 * repetidos (mismo texto Y mismo terapeuta: la logopeda y la psicóloga sí
 * pueden tener el mismo objetivo cada una), y como mucho `MAX_OBJETIVOS`.
 */
export function normalizarObjetivos(lista, max = MAX_OBJETIVOS) {
  const salida = [];
  const vistos = new Set();
  for (const o of Array.isArray(lista) ? lista : []) {
    const n = normalizarObjetivo(o);
    if (!n) continue;
    const clave = `${n.terapeutaId ?? ""}|${n.texto.toLowerCase()}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(n);
    if (salida.length >= max) break;
  }
  return salida;
}

/** Solo los textos, en orden (para la IA, los informes, lo que no sabe de terapeutas). */
export function textosDeObjetivos(lista) {
  return normalizarObjetivos(lista).map((o) => o.texto);
}

/**
 * Los objetivos agrupados para pintar: un grupo por terapeuta (con su nombre
 * y su especialidad si el paciente la tiene apuntada) y, al final, los que
 * no tienen a nadie. `terapeutas` = [{ id, nombre, especialidad? }] —los del
 * paciente primero— y `equipo` = [{ id, displayName }] para poner nombre a
 * un id que ya no esté en la lista del paciente. `yo` va primero.
 */
export function agruparPorTerapeuta(lista, { terapeutas = [], equipo = [], yo = null } = {}) {
  const objetivos = normalizarObjetivos(lista);
  const nombreDe = (id) =>
    terapeutas.find((t) => t.id === id)?.nombre
    ?? equipo.find((m) => m.id === id)?.displayName
    ?? "Terapeuta que ya no está";
  const especialidadDe = (id) => terapeutas.find((t) => t.id === id)?.especialidad ?? null;

  const porId = new Map();
  for (const o of objetivos) {
    const k = o.terapeutaId ?? "";
    if (!porId.has(k)) porId.set(k, []);
    porId.get(k).push(o);
  }
  // Los terapeutas del paciente salen aunque aún no tengan objetivos: es
  // donde cada una añade los suyos.
  for (const t of terapeutas) if (!porId.has(t.id)) porId.set(t.id, []);

  const grupos = [...porId.entries()]
    .filter(([k]) => k !== "")
    .map(([id, objetivos]) => ({ terapeutaId: id, nombre: nombreDe(id), especialidad: especialidadDe(id), objetivos, esYo: id === yo }));
  grupos.sort((a, b) => (a.esYo === b.esYo ? a.nombre.localeCompare(b.nombre, "es") : a.esYo ? -1 : 1));
  const sinTerapeuta = porId.get("") ?? [];
  if (sinTerapeuta.length) grupos.push({ terapeutaId: null, nombre: "Sin terapeuta", especialidad: null, objetivos: sinTerapeuta, esYo: false });
  return grupos;
}
