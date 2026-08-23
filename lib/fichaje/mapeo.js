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
 * Devuelve `{ exactos: Map, ambiguos: Set, personas: [] }`.
 *
 * ── UN NOMBRE REPETIDO NO CASA CON NADIE (19/08/2026) ───────────────────────
 * Hasta hoy, dos personas con el mismo `displayName` casaban EXACTO con la
 * primera del array, y el mismo alias guardado en dos personas casaba con la
 * última: las dos cosas en silencio, sin sugerencia ni aviso. Es justo el fallo
 * que este fichero existe para impedir —las horas de una en la nómina de otra—,
 * y además el único que no se ve en el preview (una fila «resuelta» no se
 * enseña). Lo sacó `_smoke-fichaje-mapeo.mjs` el día que se escribió.
 *
 * Ahora un nombre que apunta a DOS personas es ambiguo: no entra en `exactos`,
 * se apunta en `ambiguos`, y `resolverNombres` lo deja PENDIENTE y sin
 * sugerencia, para que una persona elija con un clic (y, al confirmarlo, el
 * alias se guarde en la elegida y el mes que viene ya case solo). Misma regla
 * que «dos Lauras no se sugieren»: donde hay duda, se pregunta.
 *
 * Se mantiene la prioridad de siempre: un alias explícito manda sobre el
 * displayName de otra persona (si alguien mapeó «LAURA» a Laura Arroyo, otra
 * Laura no se lo pisa por llamarse así). Solo son ambiguos alias contra alias y
 * displayName contra displayName.
 */
export function indiceDeNombres(personas) {
  const porAlias = new Map(); // nombre normalizado → Set de ids que lo tienen como alias
  const porNombre = new Map(); // nombre normalizado → Set de ids con ese displayName
  for (const p of personas) {
    for (const a of aliasDe(p)) {
      const k = normalizar(a);
      if (!porAlias.has(k)) porAlias.set(k, new Set());
      porAlias.get(k).add(p.id);
    }
    const n = normalizar(p.displayName);
    if (n) {
      if (!porNombre.has(n)) porNombre.set(n, new Set());
      porNombre.get(n).add(p.id);
    }
  }

  const exactos = new Map();
  const ambiguos = new Set();
  for (const [k, ids] of porAlias) {
    if (ids.size === 1) exactos.set(k, [...ids][0]);
    else ambiguos.add(k);
  }
  for (const [n, ids] of porNombre) {
    // Un alias (único o ambiguo) ya ha decidido ese nombre: no se pisa.
    if (exactos.has(n) || ambiguos.has(n)) continue;
    if (ids.size === 1) exactos.set(n, [...ids][0]);
    else ambiguos.add(n);
  }
  return { exactos, ambiguos, personas };
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
        debiles.push({
          id: p.id,
          nombre: p.displayName,
          motivo: `«${primeroExcel}» se parece a «${primeroCrm}»`,
        });
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
 *   `resueltos` nombreExcel → teamMemberId (los que casan EXACTO con UNA persona)
 *   `pendientes` los que no, cada uno con su sugerencia si la hay; los que
 *   casan con DOS personas van aquí SIN sugerencia y con `motivo`, para que
 *   el preview no premarque a nadie y lo elija una persona.
 */
export function resolverNombres(nombresExcel, personas) {
  const { exactos, ambiguos } = indiceDeNombres(personas);
  const resueltos = new Map();
  const pendientes = [];

  for (const nombre of nombresExcel) {
    const n = normalizar(nombre);
    if (ambiguos.has(n)) {
      pendientes.push({
        nombre,
        sugerencia: null,
        motivo: "dos personas del equipo se llaman así (o comparten el alias): elige cuál es",
      });
      continue;
    }
    const id = exactos.get(n);
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
