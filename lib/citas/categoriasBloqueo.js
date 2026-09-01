/**
 * lib/citas/categoriasBloqueo.js — de QUÉ es un bloqueo de agenda, y de qué
 * color se pinta esa clase de bloqueo en todo el centro (01/09/2026, Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Dentro de bloqueos, poder hacer categorías. Las categorías de Aumenta son:
 * reunión de equipo, trabajo interno, gestión documental, valoraciones, libre
 * de pacientes, descanso. Tiene que tener color personalizable desde Admin para
 * que a todo el equipo le salga igual.»
 *
 * ── POR QUÉ NO BASTABA CON LA ETIQUETA ──────────────────────────────────────
 * Un bloqueo ya tenía `label`, pero es TEXTO LIBRE, y texto libre escrito por
 * quince personas no es una categoría: en producción «Reservado T.I.» convive
 * con «Reservado T.I» y «Reservado t.i.», y `lib/clinica/trabajoInterno.js`
 * tiene que normalizar minúsculas, tildes y puntos para que el sumatorio de
 * Productividad no se parta en tres. Eso es adivinar. Con una categoría de
 * verdad el centro deja de adivinar: se elige de una lista, se cuenta por su
 * clave y se pinta igual para todos.
 *
 * Y ese «igual para todos» es la mitad del encargo. Hasta hoy el color de un
 * bloqueo salía de la PERSONA (su `blockColor`) o, si no tenía, del centro
 * (`settings.citas.colorBloqueos`). Sirve para saber DE QUIÉN es una ausencia,
 * pero no para saber QUÉ es: la reunión de equipo del martes se pintaba de un
 * color en la fila de cada compañera. Por eso el color de la categoría manda
 * sobre el de la persona (ver `coloresBloqueo.js`): una categoría existe
 * justamente para leerse igual en toda la agenda.
 *
 * ── DÓNDE VIVE ──────────────────────────────────────────────────────────────
 * En `master.tenants.settings.citas.categoriasBloqueo`, el mismo mecanismo que
 * `settings.clinica.plantillas`, `referralSpecialties` o `performanceRoles`:
 * JSONB en master, sin tabla nueva. **La escribe el admin** (lo pidió así:
 * «personalizable desde Admin»), desde Configuración → Agenda.
 *
 * ── NACE VACÍA, A PROPÓSITO ─────────────────────────────────────────────────
 * Sin categorías guardadas la lista es `[]` y un bloqueo se comporta EXACTAMENTE
 * como ayer: su etiqueta libre, su color de persona o de centro. Las NUEVE de
 * abajo son las de un centro clínico y se cargan con un botón («las de fábrica»)
 * o con `scripts/seed-categorias-bloqueo.js`; no se le meten a todo el mundo,
 * porque «Valoraciones» o «Libre de pacientes» no significan nada en una agencia
 * de management. El campo es opcional en todos los tenants y no estorba a quien
 * no lo use.
 *
 * ── LA CLAVE NO SE RENOMBRA NUNCA ───────────────────────────────────────────
 * Misma regla que los apartados de `lib/clinica/plantillas.js`: los bloqueos ya
 * guardados apuntan a la clave. Cambiar el título de una categoría cambia el
 * rótulo de la agenda, no a qué pertenecen los 300 bloqueos que ya la usaban.
 * Y borrar una categoría no rompe nada: sus bloqueos se quedan sin categoría
 * conocida y vuelven a pintarse con el color de siempre.
 */

import { COLOR_BLOQUEO_POR_DEFECTO } from "./coloresBloqueo.js";

/**
 * Las de un centro clínico, con un color de arranque cada una (01/09/2026).
 *
 * Nacieron seis —las que dictó Rodrigo— y son tres más desde que se etiquetó la
 * agenda de verdad: ver el comentario de las tres últimas.
 *
 * Los colores son oscuros a propósito: `colorTextoSobre` les pone letra blanca
 * y la agenda se lee de un vistazo. Son un punto de partida —el centro los
 * cambia desde Configuración— pero tienen que salir distinguibles entre sí ya
 * de fábrica, o el primer día la agenda es un bloque del mismo tono.
 */
export const CATEGORIAS_CLINICA_BASE = Object.freeze([
  { key: "reunion_equipo", label: "Reunión de equipo", color: "#2563EB" },
  { key: "trabajo_interno", label: "Trabajo interno", color: "#7C3AED" },
  { key: "gestion_documental", label: "Gestión documental", color: "#B45309" },
  { key: "valoraciones", label: "Valoraciones", color: "#0F766E" },
  { key: "libre_pacientes", label: "Libre de pacientes", color: "#64748B" },
  { key: "descanso", label: "Descanso", color: "#DB2777" },
  // ── Y TRES MÁS, QUE LAS TRAJO LA AGENDA DE VERDAD (01/09/2026, Rodrigo) ──
  // Al ir a etiquetar los 10.468 bloqueos de Aumenta salió que ~1.500 no son
  // ninguna de las seis de arriba: `BONOS Carla Borrallo`, `TALLER H.H.S.S`,
  // `OTROS MENTE ACTIVA`, `APOYO ESO`, `RECUPERACIÓN`, y `Reservado <niño>,
  // comienza el día 15/09`. Todas son HORAS CON PACIENTES apuntadas como
  // bloqueo porque no pasan por la agenda de citas.
  //
  // No se metieron en «trabajo interno» a propósito: esa clave y
  // `reunion_equipo` son las dos que suma Productividad
  // (`lib/clinica/trabajoInterno.js`), y colar ahí 1.500 horas de atención
  // directa movería las cifras que el centro lleva meses mirando. Estas tres
  // nacen sin contar como nada, igual que descanso o libre de pacientes:
  // agrupan y pintan, no suman.
  { key: "taller_grupo", label: "Taller o grupo", color: "#15803D" },
  { key: "sesion_paciente", label: "Sesión de bono, apoyo o recuperación", color: "#B91C1C" },
  { key: "reservado_paciente", label: "Hora reservada a un paciente", color: "#4338CA" },
]);

/** Tope de sentido común: una lista más larga no se elige, se busca. */
export const MAX_CATEGORIAS = 24;
const MAX_LABEL = 60;

/** Las claves de fábrica son `snake_case`; las nuevas salen del slug del título. */
const CLAVE_RE = /^[a-z][a-z0-9_]{0,47}$/;
const HEX_RE = /^#[0-9A-F]{6}$/;

/**
 * «Gestión documental» → `gestion_documental`. Sin tildes, sin eñes y sin
 * signos: la clave viaja en la URL de un filtro y se compara con `===`.
 */
export function claveDesdeTitulo(titulo) {
  const base = String(titulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  // Una clave tiene que empezar por letra: «1 a 1» daría `1_a_1`, que no pasa
  // el patrón y dejaría la categoría sin sitio donde guardarse.
  return /^[a-z]/.test(base) ? base : `cat_${base}`.slice(0, 48).replace(/_+$/, "");
}

/**
 * Deja una lista de categorías como se guarda, o `[]` si no hay nada
 * aprovechable. Tolerante con lo escrito a mano y con lo que llegue roto: esto
 * acaba en un JSONB de master y lo lee la agenda de todo el mundo.
 *
 * @param lista    lo que manda el navegador
 * @param previas  las que ya estaban, para CONSERVAR la clave de las que solo
 *                 cambian de título (ver cabecera).
 */
export function normalizarCategorias(lista, { previas = [] } = {}) {
  if (!Array.isArray(lista)) return [];

  // Título de antes → su clave. Renombrar «Descanso» a «Pausa» tiene que dejar
  // los bloqueos donde estaban, así que primero se busca por la clave que venga
  // y, si no viene, por el título anterior.
  const porClave = new Map(previas.filter((c) => c?.key).map((c) => [c.key, c]));

  const salida = [];
  const usadas = new Set();

  for (const cruda of lista) {
    if (!cruda || typeof cruda !== "object") continue;

    const label = String(cruda.label ?? "").trim().slice(0, MAX_LABEL);
    if (!label) continue; // una categoría sin título no se puede elegir

    // La clave: la que venga si es válida y ya existía, o una nueva del título.
    let key = typeof cruda.key === "string" ? cruda.key.trim().toLowerCase() : "";
    if (!CLAVE_RE.test(key)) key = "";
    if (key && !porClave.has(key) && usadas.has(key)) key = "";
    if (!key) key = claveDesdeTitulo(label);
    if (!CLAVE_RE.test(key)) continue;

    // Dos categorías con la misma clave se comerían la una a la otra al pintar.
    if (usadas.has(key)) {
      let n = 2;
      while (usadas.has(`${key}_${n}`) && n < 50) n += 1;
      key = `${key}_${n}`;
      if (!CLAVE_RE.test(key)) continue;
    }

    const color = limpiaColorCategoria(cruda.color);
    salida.push({ key, label, color: color ?? COLOR_BLOQUEO_POR_DEFECTO });
    usadas.add(key);

    if (salida.length >= MAX_CATEGORIAS) break;
  }

  return salida;
}

/**
 * `#2563eb ` → `#2563EB`, y `null` a lo que no sea un hex de seis. Se guarda en
 * mayúsculas como el resto de colores del CRM (`limpiaColorBloqueo`).
 */
export function limpiaColorCategoria(valor) {
  if (typeof valor !== "string") return null;
  const v = valor.trim().toUpperCase();
  return HEX_RE.test(v) ? v : null;
}

/**
 * Las categorías EFECTIVAS de un centro: las suyas, o ninguna.
 *
 * Nunca cae a las de fábrica sola. Cargarlas es una decisión del centro (un
 * botón en Configuración), no algo que le pase por la espalda a un cliente que
 * no las ha pedido — ver cabecera.
 */
export function categoriasDe(tenant) {
  const guardadas = tenant?.settings?.citas?.categoriasBloqueo;
  if (!Array.isArray(guardadas)) return [];
  // Se normaliza también AL LEER: una config escrita a mano en la base, o de una
  // versión anterior, no puede tumbar la agenda.
  return normalizarCategorias(guardadas, { previas: guardadas });
}

/** La categoría de una clave, o `null` si ya no existe (se borró). */
export function categoriaDe(key, categorias) {
  if (!key || !Array.isArray(categorias)) return null;
  return categorias.find((c) => c.key === key) ?? null;
}

/**
 * La clave que se guarda en el bloqueo: la que venga si el centro la tiene dada
 * de alta, o `null`. Inventarse una categoría desde el navegador no vale — la
 * lista la decide dirección.
 */
export function claveValida(key, categorias) {
  const limpia = typeof key === "string" ? key.trim().toLowerCase() : "";
  if (!limpia) return null;
  return categoriaDe(limpia, categorias) ? limpia : null;
}

/* ═══ De una etiqueta escrita a mano a una categoría ═══════════════════════ */

/**
 * ── EL ENCARGO (01/09/2026, Rodrigo) ────────────────────────────────────────
 * «Analiza todos los bloqueos de cada persona y etiquétalos según su categoría.
 * Ahora mismo existen las categorías, pero los bloqueos que se trajeron de
 * Organízate no pertenecen a ninguna aunque ponga en el título T.I.»
 *
 * Y es literal: de los 10.468 bloqueos de Aumenta había TRES con categoría. Los
 * demás llevan la clase escrita dentro del `label`, porque así los exportó
 * Organízate: el tipo de bloqueo delante y la nota de esa hora detrás
 * («LIBRE PACIENTES Reunión coordinación con Laura B de 13:15 a 13:45»).
 *
 * ── LA REGLA: MANDA EL PRINCIPIO DE LA ETIQUETA ─────────────────────────────
 * Lo que va delante NO es texto que alguien escribió: es el nombre del tipo que
 * eligió de una lista. Por eso gana aunque después se hable de otra cosa — una
 * hora marcada «LIBRE PACIENTES» en la que además hubo una coordinación sigue
 * siendo la hora que el centro apartó como libre de pacientes, y así es como la
 * cuentan ellos.
 *
 * La ÚNICA excepción es «Reservado» a secas, que no es el nombre de ninguna
 * clase: es la palabra con la que Organízate marca «esta hora está cogida». Ahí
 * sí hay que leer lo que viene detrás, y son dos cosas muy distintas —«Reservado
 * Reunión con Arancha Coordinación» (44 bloqueos) frente a «Reservado Iván
 * Jiménez, comienza el 22/09»—.
 *
 * ── ANTE LA DUDA, NULL ──────────────────────────────────────────────────────
 * Una etiqueta que no cae en ninguna regla se queda SIN categoría, que es como
 * está hoy. Adivinar mal es peor que no adivinar: la categoría se ve en la
 * agenda de las quince personas del centro y una hora mal clasificada es una
 * hora que alguien va a leer como lo que no es.
 *
 * @param {string} label       la etiqueta del bloqueo, tal cual está en la base
 * @param {Array}  categorias  las que el centro tiene dadas de alta; solo se
 *                             devuelve una clave que exista de verdad ahí
 * @returns {string|null} la clave de la categoría, o `null` si no está claro
 */
export function categoriaPorEtiqueta(label, categorias = CATEGORIAS_CLINICA_BASE) {
  const s = normalizaEtiqueta(label);
  if (!s) return null;
  for (const { clave, prueba } of REGLAS_ETIQUETA) {
    if (prueba(s)) return claveValida(clave, categorias);
  }
  return null;
}

/**
 * «Reservado T.I.» → «reservado t i». Minúsculas, sin tildes y con los puntos
 * convertidos en espacio, que es lo que junta las TRES grafías que conviven en
 * producción («Reservado T.I.», «Reservado T.I», «Reservado t.i.»). Es la misma
 * normalización que `lib/clinica/trabajoInterno.js`, y por el mismo motivo.
 */
function normalizaEtiqueta(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:¡!¿?/'"´`()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿Habla de una reunión de coordinación? (lo que se lee DETRÁS de «Reservado») */
const HUELE_A_REUNION = (s) => /\breunion(es)?\b/.test(s) || /\bcoordinacion\b/.test(s);

/** ¿Lleva escrito «T.I.» —trabajo interno— en cualquiera de sus grafías? */
const HUELE_A_TI = (s) => /\bt i\b/.test(s) || s.includes("trabajo interno");

/**
 * Las reglas, EN ORDEN: gana la primera que dice que sí.
 *
 * El orden no es estético. «GESTION DOCUMENTAL T.I.» (43 bloqueos) lleva las
 * dos cosas escritas y tiene que caer en gestión documental, que es lo que dice
 * su principio; y «Reservado T.I.» tiene que resolverse antes de que lo pille
 * la regla del «Reservado» suelto, que es la última a propósito.
 */
const REGLAS_ETIQUETA = Object.freeze([
  // ── Los nombres de clase, tal como los exportó Organízate ────────────────
  { clave: "gestion_documental", prueba: (s) => s.startsWith("gestion documental") },
  { clave: "reunion_equipo", prueba: (s) => /^reunion (de )?equipo\b/.test(s) },
  { clave: "libre_pacientes", prueba: (s) => s.startsWith("libre pacientes") || s.startsWith("libre de pacientes") },
  { clave: "descanso", prueba: (s) => s.startsWith("descanso") },
  { clave: "valoraciones", prueba: (s) => s.startsWith("valoracion") },
  // Una entrevista inicial con la familia es el primer paso de la valoración:
  // el CRM ya llama «Entrevista inicial» al informe de tipo `admission`
  // (`lib/clinica/serialize.js`).
  { clave: "valoraciones", prueba: (s) => s.startsWith("entrevista inicial") },

  // ── Horas con pacientes que no pasan por la agenda de citas ──────────────
  // «OTROS MENTE ACTIVA» es un taller del centro: no lleva la palabra taller
  // delante, pero es lo que es. Habilidades Sociales ya está dado de alta como
  // taller de verdad en el CRM (`talleres`), y estos bloqueos son sus horas.
  { clave: "taller_grupo", prueba: (s) => /\btaller(es)?\b/.test(s) || s.includes("mente activa") },
  { clave: "sesion_paciente", prueba: (s) => /^bonos?\b/.test(s) || s.startsWith("apoyo") || s.startsWith("recuperacion") },

  // ── «T.I.» en cualquiera de sus grafías ──────────────────────────────────
  { clave: "trabajo_interno", prueba: HUELE_A_TI },

  // ── Y por último «Reservado», que no es una clase: hay que leer lo de atrás ─
  { clave: "reunion_equipo", prueba: (s) => s.startsWith("reservado") && HUELE_A_REUNION(s) },
  { clave: "reservado_paciente", prueba: (s) => s.startsWith("reservado") },
]);
