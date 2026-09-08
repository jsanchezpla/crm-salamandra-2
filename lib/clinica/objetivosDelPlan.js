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
 * ── Y DESDE EL 09/09/2026 SE CORRIGEN EN SITIO (AV-0080 de Aumenta) ────────
 * Blanca: «esos mismos objetivos que te genera la IA, pueda modificarse, ya
 * que ahora tan solo deja eliminarlos o añadir algún otro nuevo». Es el uso
 * normal de una redacción con IA: sale casi bien y se retoca una palabra. Hoy
 * la única salida era borrarla y escribirla entera, que es justo lo que la IA
 * venía a ahorrar.
 *
 * Eso trae dos piezas nuevas —`editarObjetivo` y `puedeEditarObjetivo`— y un
 * campo más en lo que devuelve `agruparPorTerapeuta`: el ÍNDICE del objetivo
 * en la lista normalizada. Sin él no se puede señalar «este» sin depender del
 * texto o de la identidad del objeto, y depender de la identidad es lo que
 * tenía roto el botón «mío» desde el 07/09: `agruparPorTerapeuta` devuelve
 * objetos NUEVOS, así que el `x === o` de la pantalla no acertaba nunca.
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
  // Con su POSICIÓN en la lista normalizada: es lo que la pantalla usa para
  // decir «este objetivo» al editarlo o al hacerlo suyo, sin fiarse del texto
  // (dos pueden ser iguales entre terapeutas) ni de la identidad del objeto
  // (aquí son copias nuevas).
  objetivos.forEach((o, indice) => {
    const k = o.terapeutaId ?? "";
    if (!porId.has(k)) porId.set(k, []);
    porId.get(k).push({ ...o, indice });
  });
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

/**
 * ¿Puede esta persona corregir este objetivo?
 *
 * Suyo, o de nadie (así se limpian los que vienen de planes viejos), o eres
 * dirección. Lo de otra profesional NO: es su plan de intervención y su
 * criterio clínico.
 *
 * ⚠️ Esto gatea CORREGIR, no borrar. La × sigue abierta para todo el equipo,
 * como estaba: cerrarla es una puerta que nadie ha pedido, y la doctrina de
 * `lib/auth/permisos.js` dice que lo que no es matador no se cierra por si
 * acaso. Si algún día el centro lo pide, es una línea.
 */
export function puedeEditarObjetivo(objetivo, { yo = null, esAdmin = false } = {}) {
  if (esAdmin) return true;
  const suyo = objetivo?.terapeutaId ?? null;
  if (suyo === null) return true;
  return Boolean(yo) && suyo === yo;
}

/**
 * Corregir el texto de UN objetivo, por su posición.
 *
 * Devuelve SIEMPRE la misma forma, y con la lista ya normalizada:
 *   `{ ok, motivo, objetivos }`
 *
 * Cuando `ok` es false la lista vuelve entera y sin tocar, para que la pantalla
 * pueda enseñar el aviso sin haber perdido nada por el camino.
 *
 * Motivos:
 *   · `no-esta`   la posición no existe.
 *   · `vacio`     el texto se queda en nada. Borrar es la ×, no vaciar la caja:
 *                 dejar que un textarea vacío borre una nota clínica al pulsar
 *                 Enter sin querer es un accidente esperando.
 *   · `repetido`  otra vez el MISMO texto de la MISMA profesional. Sin este
 *                 freno `normalizarObjetivos` se queda con el primero y el
 *                 objetivo que se acaba de corregir desaparece sin decir nada.
 *                 El mismo texto en dos terapeutas distintas sí vale: la
 *                 logopeda y la psicóloga pueden compartir objetivo.
 */
export function editarObjetivo(lista, indice, textoNuevo) {
  const objetivos = normalizarObjetivos(lista);
  // Un NÚMERO entero, no «lo que Number() consiga»: `Number(null)` es 0, y con
  // eso un índice perdido corregiría en silencio el PRIMER objetivo del plan.
  const i = indice;
  if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= objetivos.length) {
    return { ok: false, motivo: "no-esta", objetivos };
  }
  const texto = limpio(textoNuevo);
  if (!texto) return { ok: false, motivo: "vacio", objetivos };

  const suyo = objetivos[i].terapeutaId ?? null;
  const repetido = objetivos.some(
    (o, j) => j !== i && (o.terapeutaId ?? null) === suyo && o.texto.toLowerCase() === texto.toLowerCase(),
  );
  if (repetido) return { ok: false, motivo: "repetido", objetivos };

  const salida = objetivos.map((o, j) => (j === i ? { ...o, texto } : o));
  return { ok: true, motivo: null, objetivos: salida };
}
