/**
 * lib/clinica/registroCompleto.js — QUÉ es «el registro entero» de una sesión,
 * y cómo se le pide a Claude que lo rellene desde la transcripción.
 *
 * (Fichero nuevo en /lib, regla #2: la MISMA lista de bloques la necesitan
 * CUATRO sitios —los dos endpoints que llaman a Claude (`sessions/transcribe`
 * y `sessions/[id]/completar`) y las dos pantallas que enseñan la propuesta
 * (el formulario de «Nuevo registro» y el cajón de la ficha)—. Con una copia en
 * cada uno, añadir un bloque se comportaría distinto según por dónde entres, y
 * el prompt y el parseo dejarían de casar a la primera.)
 *
 * ── DE QUÉ QUEJA NACE (Rodrigo, 01/09/2026) ────────────────────────────────
 * «No tengo ningún botón para, una vez transcrito un audio, hacer todo el
 * registro completo con esa información: desde preparación a las notas
 * internas.» Y tenía razón: el botón existía y se quedaba a medias.
 *
 * `structureSession.js` llevaba el prompt escrito a mano con SIETE campos
 * —objetivos, actividades, desempeño y las cuatro observaciones—, que son
 * exactamente el bloque «2 · Informe de la sesión» y solo los de fábrica. Por
 * fuera se quedaban siempre en blanco:
 *
 *   · 1 · Preparación (`prepText`),
 *   · 3 · Devolución de la familia (`parentFeedback`),
 *   · 4 · Notas internas del equipo (`internalNotes`),
 *   · y los apartados PROPIOS de la plantilla del centro, que existen desde el
 *     29/08 (`plantillas.js`) y de los que el prompt no sabía nada: un centro
 *     que se monta su plantilla dictaba el audio entero y luego copiaba a mano
 *     lo que la IA no tenía dónde poner.
 *
 * Aquí el prompt SE CONSTRUYE a partir de los bloques que de verdad tiene ese
 * registro. Añadir un apartado a la plantilla del centro basta para que Claude
 * lo rellene: no hay una segunda lista que actualizar.
 *
 * ── LAS DOS REGLAS QUE NO SE NEGOCIAN ──────────────────────────────────────
 *
 *  1. **No inventar.** Es la regla de la casa en todo lo clínico (la misma que
 *     `verificarSinInventar` en el informe). Un bloque que la terapeuta no
 *     menciona sale VACÍO. Un registro clínico con relleno plausible es peor
 *     que uno corto: lo firma una colegiada y puede acabar en un informe de
 *     beca o en el juzgado.
 *
 *  2. **Las notas internas no son un apartado más.** Van marcadas `interno` y
 *     el prompt lo dice con todas las letras, porque el resto del registro sí
 *     puede acabar delante de la familia (el PDF, el anexo del informe, el área
 *     privada) y esto NO — misma frontera que ya defiende el modelo
 *     (`ClinicSession.model.js`) y `redactarDesdeSesiones`. Que Claude escriba
 *     ahí es seguro; que Claude confunda ahí con lo demás, no.
 */

import { normalizarApartados, PLANTILLA_BASE } from "./plantillas.js";

/**
 * Los tres bloques que NO son apartados de plantilla: el envoltorio del
 * registro. Tienen columna propia en `clinic_sessions` y por eso no pasan por
 * `repartirValoresDeSesion` — se guardan y se parchean por su nombre.
 *
 * La `pista` es lo que ve Claude, y está escrita para una terapeuta que dicta
 * un audio del tirón: no describe la columna, describe qué frases del audio van
 * ahí. Es la parte del prompt que más se va a retocar con el uso.
 */
export const BLOQUES_ENVOLTORIO = Object.freeze({
  prepText: Object.freeze({
    key: "prepText",
    label: "Preparación",
    tipo: "texto",
    donde: "antes",
    pista:
      "Lo que la profesional preparó ANTES de la sesión: material previsto, hipótesis de trabajo, qué se proponía observar. Solo si lo cuenta; si el audio empieza directamente por lo que se hizo, déjalo vacío.",
  }),
  parentFeedback: Object.freeze({
    key: "parentFeedback",
    label: "Devolución de la familia",
    tipo: "texto",
    donde: "despues",
    pista:
      "Lo que los padres o tutores le han contado A ELLA (normalmente al recoger): cómo ha ido la semana, qué notan en casa, qué preguntan. Es lo que dice la familia, no lo que la profesional opina de la familia.",
  }),
  internalNotes: Object.freeze({
    key: "internalNotes",
    label: "Notas internas del equipo",
    tipo: "texto",
    donde: "despues",
    interno: true,
    pista:
      "SOLO material interno del equipo que la familia no debe leer nunca: falta de implicación de los padres, cómo están ellos, actitudes, avisos para compañeros. No repitas aquí nada clínico del paciente: eso va en sus apartados. Si en el audio no hay nada de esto, déjalo vacío — es lo más normal.",
  }),
});

/** Las claves del envoltorio, para distinguirlas de un apartado de plantilla. */
export const CLAVES_ENVOLTORIO = Object.freeze(Object.keys(BLOQUES_ENVOLTORIO));

/** ¿Esta clave es uno de los tres bloques con columna propia? */
export function esEnvoltorio(clave) {
  return Object.prototype.hasOwnProperty.call(BLOQUES_ENVOLTORIO, clave);
}

/**
 * EL registro entero, en orden de pantalla: preparación · los apartados del
 * informe · devolución de la familia · notas internas.
 *
 * Se deduplica por clave a propósito. Un apartado de plantilla puede pedir la
 * clave `prepText` —`CLAVE_RE` la admite y no está en las reservadas de
 * `plantillas.js`— y entonces habría DOS bloques escribiendo en el mismo sitio:
 * el segundo pisaría al primero en silencio y la propuesta enseñaría el mismo
 * texto dos veces. Gana el envoltorio, que es una columna de verdad.
 *
 * Sin apartados —nadie los manda, llegan corruptos, o la petición viene de una
 * pantalla vieja— se cae a los SIETE DE FÁBRICA y no a una lista vacía. Un
 * registro sin el bloque 2 no es un registro: la propuesta se quedaría en la
 * preparación y las notas internas, que es peor que lo que había antes de
 * todo esto.
 */
export function bloquesDelRegistro(apartados) {
  const pedidos = normalizarApartados(apartados);
  const base = pedidos.length ? pedidos : PLANTILLA_BASE.registro.apartados;
  const vistas = new Set();
  const delInforme = [];
  for (const a of base) {
    // Un apartado que pide la clave de un envoltorio ya está representado por
    // ese envoltorio, que es una columna de verdad: se descarta el apartado.
    // `normalizarApartados` ya ha desduplicado los apartados entre sí.
    if (esEnvoltorio(a.key) || vistas.has(a.key)) continue;
    vistas.add(a.key);
    delInforme.push({ key: a.key, label: a.label, tipo: a.tipo });
  }
  return [
    BLOQUES_ENVOLTORIO.prepText,
    ...delInforme,
    BLOQUES_ENVOLTORIO.parentFeedback,
    BLOQUES_ENVOLTORIO.internalNotes,
  ];
}

/* ═══ El prompt ════════════════════════════════════════════════════════════ */

const CABECERA = `Eres el asistente de registro clínico de un centro de psicopedagogía infantil. Recibes la transcripción de una nota de voz que una profesional ha grabado sobre una sesión con un paciente, y tienes que repartir esa información por los apartados del registro del centro.

Devuelve SOLO un JSON válido (sin texto alrededor, sin markdown, sin explicaciones), con EXACTAMENTE una clave por apartado de la lista de abajo y ninguna más.`;

const REGLAS = `REGLAS (por este orden):

1. NO INVENTES. Escribe únicamente lo que se dice en la transcripción. Un apartado del que no se habla se devuelve VACÍO ("" o [] si es lista). Es normal y correcto que varios salgan vacíos: quien lo lea prefiere un registro corto y cierto a uno completo y adornado.
2. No pongas cifras, fechas, diagnósticos ni nombres de pruebas que no estén en la transcripción.
3. Cada frase va en UN solo apartado, en el que mejor le corresponda. No repitas el mismo contenido en dos.
4. Escribe en español, en tercera persona y en el registro sobrio de una nota clínica ("Se trabaja…", "Muestra…"). Nada de dirigirte a nadie ni de valorar el trabajo de la profesional.
5. Respeta el tipo de cada apartado: "párrafo" es texto corrido; "lista" es un array de líneas cortas (2-6 palabras), sin numerar.
6. Corrige lo que sea claramente un error de transcripción o de dictado, pero no cambies el contenido.`;

const TIPO_HUMANO = { lista: "lista", texto: "párrafo" };

/** La ficha de un bloque tal como la lee Claude. */
function lineaDeBloque(b) {
  const tipo = TIPO_HUMANO[b.tipo] ?? TIPO_HUMANO.texto;
  const marca = b.interno ? " [INTERNO — la familia no lo lee NUNCA]" : "";
  const pista = b.pista ? ` — ${b.pista}` : "";
  return `- "${b.key}" · ${b.label} (${tipo})${marca}${pista}`;
}

/** El molde de respuesta, para que no haya que adivinar la forma del JSON. */
function moldeDeBloques(bloques) {
  const filas = bloques.map((b) => `  "${b.key}": ${b.tipo === "lista" ? '["…", "…"]' : '"…"'}`);
  return `{\n${filas.join(",\n")}\n}`;
}

/**
 * El SYSTEM que se le manda a Claude, construido a partir de los bloques REALES
 * de este registro. Aquí está la diferencia con lo de antes: si el centro añade
 * «Entorno familiar» a su plantilla, aparece en esta lista y Claude lo rellena
 * sin que nadie toque una línea de código.
 */
export function promptDeRegistro(bloques) {
  const lista = Array.isArray(bloques) ? bloques : [];
  return [
    CABECERA,
    `APARTADOS DE ESTE REGISTRO (usa estas claves exactas):\n${lista.map(lineaDeBloque).join("\n")}`,
    `FORMA EXACTA DE LA RESPUESTA:\n${moldeDeBloques(lista)}`,
    REGLAS,
  ].join("\n\n");
}

/**
 * El mensaje de usuario: la transcripción y, si el registro ya lleva algo
 * escrito a mano, lo que hay.
 *
 * Lo ya escrito se manda para que Claude no CONTRADIGA ni repita a la
 * profesional, no para que lo copie: la propuesta sale de la transcripción, y
 * quien decide si se queda lo suyo o entra lo propuesto es ella, en la pantalla.
 * Por eso se manda como contexto y con la orden explícita de no devolverlo tal
 * cual.
 */
export function mensajeDeRegistro({ transcription, escrito = null, bloques = [] }) {
  const partes = [`TRANSCRIPCIÓN DE LA NOTA DE VOZ:\n\n${String(transcription ?? "").trim()}`];
  const yaEscrito = [];
  for (const b of Array.isArray(bloques) ? bloques : []) {
    const v = String(escrito?.[b.key] ?? "").trim();
    if (v) yaEscrito.push(`- ${b.label}: ${v}`);
  }
  if (yaEscrito.length) {
    partes.push(
      `LO QUE LA PROFESIONAL YA HABÍA ESCRITO A MANO (contexto, NO lo copies ni lo devuelvas):\n${yaEscrito.join(
        "\n"
      )}\n\nTu propuesta sale de la transcripción. Úsalo solo para no contradecirla ni repetir lo que ya dijo con otras palabras.`
    );
  }
  return partes.join("\n\n");
}

/* ═══ La respuesta ═════════════════════════════════════════════════════════ */

/** Quita las vallas de markdown que a veces envuelven el JSON. */
export function sinVallas(s) {
  return String(s ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

const texto = (v) => (v == null ? "" : typeof v === "string" ? v.trim() : String(v).trim());

/**
 * Lo que devuelve Claude → la bolsa plana que entiende el formulario: una clave
 * por bloque y SIEMPRE una cadena (en los de lista, una línea por viñeta, que es
 * la convención de `aFormulario` en `plantillas.js`).
 *
 * Defensivo por diseño, como el resto de la IA de la casa: un JSON roto, una
 * clave de más o un número donde iba texto no pueden romper la pantalla. Lo que
 * no encaja se descarta y el bloque sale vacío, que es un resultado legítimo.
 */
export function normalizarPropuesta(bruto, bloques) {
  let parsed = bruto;
  if (typeof bruto === "string") {
    try {
      parsed = JSON.parse(sinVallas(bruto));
    } catch {
      parsed = {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
  const salida = {};
  for (const b of Array.isArray(bloques) ? bloques : []) {
    const v = parsed[b.key];
    if (b.tipo === "lista") {
      const items = Array.isArray(v) ? v.map(texto).filter(Boolean) : texto(v) ? [texto(v)] : [];
      salida[b.key] = items.join("\n");
    } else {
      salida[b.key] = Array.isArray(v) ? v.map(texto).filter(Boolean).join("\n\n") : texto(v);
    }
  }
  return salida;
}

/** ¿La propuesta trae algo? (todo vacío = Claude no encontró nada que repartir) */
export function propuestaVacia(propuesta) {
  return !Object.values(propuesta ?? {}).some((v) => String(v ?? "").trim());
}

/* ═══ De dónde sale el registro ════════════════════════════════════════════ */

/**
 * Tope de lo que se puede pegar a mano. No es seguridad, es coste y sentido
 * común: son unas 5.000 palabras —muchísimo más de lo que nadie apunta de una
 * sesión— y a partir de ahí el prompt empieza a costar dinero de verdad.
 */
export const MAX_NOTAS = 20_000;

/** El rótulo que separa las dos fuentes cuando vienen las dos. */
export const SEPARADOR_NOTAS = "— Notas escritas —";

/**
 * EL MATERIAL: el texto del que Claude tiene que sacar el registro.
 *
 * ── POR QUÉ NO ES SOLO LA TRANSCRIPCIÓN (Rodrigo, 01/09/2026) ──────────────
 * «El botón de la IA también debe poder coger texto libre, no solo la
 * transcripción del audio. Por si apuntan todo en un bloc de notas y lo pasan
 * ahí.» Y es el caso normal en un centro: no todo el mundo graba. Además abre
 * la puerta a las sesiones que YA existen sin audio —22.045 solo en Aumenta—,
 * que hasta hoy no tenían forma de pasar por aquí.
 *
 * Para la IA las dos cosas son lo mismo —texto—, así que se juntan aquí y el
 * resto del fichero no se entera. Cuando vienen las dos se separan con un
 * rótulo en vez de pegarlas sin más: quien luego lea el material guardado tiene
 * que poder distinguir lo que dijo de lo que escribió, y Claude también (una
 * nota escrita suele ser telegráfica y la voz no).
 */
export function materialParaLaIA({ transcripcion, notas } = {}) {
  const t = String(transcripcion ?? "").trim();
  const n = String(notas ?? "").trim();
  if (t && n) return `${t}\n\n${SEPARADOR_NOTAS}\n${n}`;
  return t || n;
}

/* ═══ Datos de demostración (solo desarrollo) ══════════════════════════════ */

/**
 * La propuesta canned de local, POR CLAVE y no por posición.
 *
 * Vive aquí y no en un endpoint porque la usan los DOS —`sessions/transcribe` y
 * `sessions/[id]/completar`—, y porque tiene que estar al lado de la lista de
 * bloques: el día que se añada uno, el que lo añada ve aquí mismo si tiene que
 * darle un ejemplo. En producción no se llama nunca (`CLINICA_FAKE_AI` está
 * limitado a desarrollo y la demo pública se corta antes, en
 * `assertNotDemoPaidCall`).
 *
 * Un apartado propio del centro no está aquí y sale vacío: es exactamente lo
 * que haría el modelo si de él no se hablara en el audio.
 */
export const TRANSCRIPCION_DEMO =
  "Para hoy le tenía preparado el memory de atención y un par de escenarios escolares, a ver cómo decidía. Hemos trabajado atención con el memory, y también toma de decisiones, velocidad de procesamiento y flexibilidad cognitiva. Le he visto bastante concentrado, mejor que la semana pasada, y ha completado el memory con menos distracciones. La madre me ha comentado al recoger que ha mejorado con los deberes en casa. Para casa le he puesto ejercicios de atención cinco minutos antes del estudio. Apunta para el equipo que el padre no ha vuelto a venir a las tutorías y que la madre lo está llevando todo sola.";

const DEMO_POR_CLAVE = {
  prepText: "Memory de atención y escenarios escolares de toma de decisiones.",
  objectives: "Atención sostenida\nToma de decisiones\nVelocidad de procesamiento\nFlexibilidad cognitiva",
  activities: "Memory con piezas progresivas y ejercicios de toma de decisiones con escenarios escolares.",
  performance: "Mayor concentración respecto a sesiones anteriores; completó el memory con menos distracciones.",
  familyComments: "La madre refiere mejora notable en la realización de los deberes.",
  nextSessionNotes: "Continuar con flexibilidad cognitiva; introducir planificación.",
  homeworkTasks: "Ejercicios de atención 5 minutos antes del estudio.",
  incidents: "Ninguna.",
  parentFeedback: "La madre cuenta que en casa ha mejorado con los deberes esta semana.",
  internalNotes: "El padre no acude a las tutorías; la madre asume sola el seguimiento.",
};

/** La propuesta de demostración, ya con la forma de los bloques que se piden. */
export function propuestaDemo(bloques) {
  const bruto = Object.fromEntries(
    (Array.isArray(bloques) ? bloques : []).map((b) => {
      const v = DEMO_POR_CLAVE[b.key] ?? "";
      return [b.key, b.tipo === "lista" && v ? v.split("\n") : v];
    })
  );
  return normalizarPropuesta(bruto, bloques);
}

/**
 * La forma HISTÓRICA de `aiStructured` —objetivos, actividades, desempeño y las
 * cuatro observaciones—, extraída de la propuesta nueva.
 *
 * Se conserva porque esa columna es la foto de lo que dijo la IA y ya hay
 * sesiones guardadas con esta forma: cambiarla dejaría las viejas y las nuevas
 * con dos estructuras distintas en el mismo JSONB. Los bloques que no son de
 * fábrica viajan aparte, en `extra`, sin tocar lo de siempre.
 */
export function estructuraHistorica(propuesta) {
  const p = propuesta && typeof propuesta === "object" ? propuesta : {};
  const linea = (k) => texto(p[k]);
  const extra = {};
  for (const [k, v] of Object.entries(p)) {
    if (["objectives", "activities", "performance", "familyComments", "nextSessionNotes", "homeworkTasks", "incidents"].includes(k)) continue;
    if (texto(v)) extra[k] = texto(v);
  }
  return {
    objectives: linea("objectives") ? linea("objectives").split("\n").map((x) => x.trim()).filter(Boolean) : [],
    activities: linea("activities"),
    performance: linea("performance"),
    observations: {
      familyComments: linea("familyComments"),
      nextSessionNotes: linea("nextSessionNotes"),
      homeworkTasks: linea("homeworkTasks"),
      incidents: linea("incidents"),
    },
    ...(Object.keys(extra).length ? { extra } : {}),
  };
}
