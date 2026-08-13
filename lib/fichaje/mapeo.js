/**
 * lib/fichaje/mapeo.js — «este nombre del Excel es esta persona del CRM».
 *
 * El Excel no trae el UUID de nadie: trae `ARACELI`, `ISA`, `DANIA`,
 * `LAURA ARROYO`. El CRM tiene `Isabel …`, `Daniela …`. Ninguno de esos tres
 * casa por igualdad, y ahí está todo el problema: si el módulo adivinara, un
 * día metería las horas de una persona en la nómina de otra.
 *
 * ── LA REGLA DURA ───────────────────────────────────────────────────────────
 * Solo se asigna sola una fila cuyo nombre case EXACTO (ignorando mayúsculas,
 * acentos y espacios de más) con:
 *   · uno de los alias guardados de esa persona, o
 *   · su nombre completo en el CRM.
 *
 * Todo lo demás —incluido «ISA» pareciéndose a «Isabel»— es una SUGERENCIA que
 * se enseña en el preview y que confirma una persona con un clic. Cuando la
 * confirma, el alias se guarda y el mes que viene ya casa solo.
 *
 * ── DÓNDE SE GUARDA ─────────────────────────────────────────────────────────
 * En `team_members.custom_fields.fichajeNombres`, un array de alias. Se eligió
 * ahí y no en una columna nueva porque no hace falta migrar `team_members`
 * —una tabla que tocan seis módulos— para guardar una lista de catorce alias.
 */

/** minúsculas, sin acentos, sin espacios de más. */
export function normalizar(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

/** Alias guardados de una persona. Tolera el customFields vacío o corrupto. */
export function aliasDe(persona) {
  const v = persona?.customFields?.fichajeNombres;
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim());
}

/**
 * Construye el índice nombre→persona a partir del equipo.
 * Devuelve `{ exactos: Map, personas: [] }`.
 */
export function indiceDeNombres(personas) {
  const exactos = new Map();
  for (const p of personas) {
    for (const a of aliasDe(p)) exactos.set(normalizar(a), p.id);
    const n = normalizar(p.displayName);
    // Un alias explícito manda sobre el nombre del CRM: si alguien mapeó
    // «LAURA» a Laura Arroyo, no puede pisárselo otra Laura por su displayName.
    if (n && !exactos.has(n)) exactos.set(n, p.id);
  }
  return { exactos, personas };
}

/**
 * ¿A quién se parece este nombre? Solo para SUGERIR, nunca para asignar.
 *
 * Dos señales, en este orden:
 *   1. El nombre del Excel es el principio del nombre del CRM, o al revés
 *      («LAURA ARROYO» ↔ «Laura Arroyo Pérez»).
 *   2. Comparten el primer nombre y uno de los dos es más corto («ISA» vs
 *      «Isabel»): prefijo de al menos 3 letras.
 *
 * Si hay más de una candidata NO se sugiere ninguna: dos Lauras es
 * exactamente el caso en el que una sugerencia hace daño.
 */
export function sugerirPersona(nombreExcel, personas) {
  const n = normalizar(nombreExcel);
  if (n.length < 3) return null;

  const fuertes = []; // el nombre entero del Excel es prefijo del del CRM
  const debiles = []; // solo se parece el nombre de pila

  for (const p of personas) {
    const c = normalizar(p.displayName);
    if (!c) continue;
    if (c.startsWith(n) || n.startsWith(c)) {
      fuertes.push({ id: p.id, nombre: p.displayName, motivo: "el nombre empieza igual" });
      continue;
    }
    const primeroExcel = n.split(" ")[0];
    const primeroCrm = c.split(" ")[0];
    if (primeroExcel.length >= 3 && primeroCrm.length >= 3) {
      if (primeroCrm.startsWith(primeroExcel) || primeroExcel.startsWith(primeroCrm)) {
        debiles.push({ id: p.id, nombre: p.displayName, motivo: `«${primeroExcel}» se parece a «${primeroCrm}»` });
      }
    }
  }

  // Una coincidencia FUERTE gana aunque haya varias débiles. «Laura Garrido»
  // es Laura Garrido Rascón aunque en el equipo haya otra Laura: compartir el
  // nombre de pila no compite con coincidir entero.
  if (fuertes.length === 1) return fuertes[0];
  if (fuertes.length > 1) return null;
  // Sin ninguna fuerte, una débil sola vale como sugerencia; dos, no. Es el
  // caso de `ISA` con dos Isabeles en plantilla y el de `RAQUEL` con dos
  // Raqueles: ahí sugerir es peor que callarse, porque una sugerencia se
  // acepta a ciegas y son las horas de otra persona.
  if (debiles.length === 1) return debiles[0];
  return null;
}

/**
 * Resuelve la lista de nombres de un Excel contra el equipo.
 *
 * @returns {{resueltos: Map<string,string>, pendientes: Array}}
 *   `resueltos` nombreExcel → teamMemberId (los que casan EXACTO)
 *   `pendientes` los que no, cada uno con su sugerencia si la hay
 */
export function resolverNombres(nombresExcel, personas) {
  const { exactos } = indiceDeNombres(personas);
  const resueltos = new Map();
  const pendientes = [];

  for (const nombre of nombresExcel) {
    const id = exactos.get(normalizar(nombre));
    if (id) {
      resueltos.set(nombre, id);
      continue;
    }
    pendientes.push({ nombre, sugerencia: sugerirPersona(nombre, personas) });
  }
  return { resueltos, pendientes };
}

/**
 * Añade un alias a una persona sin pisar los que ya tenía.
 * Devuelve el customFields nuevo, o null si el alias ya estaba.
 */
export function customFieldsConAlias(persona, alias) {
  const limpio = String(alias ?? "").trim();
  if (!limpio) return null;
  const actuales = aliasDe(persona);
  if (actuales.some((a) => normalizar(a) === normalizar(limpio))) return null;
  return { ...(persona.customFields || {}), fichajeNombres: [...actuales, limpio] };
}
