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
import { CLAVE_NUEVOS, INSTRUCCION_NUEVOS, LINEA_MOLDE_NUEVOS } from "./apartadosPropuestos.js";
import { esApartadoDeSintesis, estiloClinico, haySintesis, lineaDePaciente } from "./estiloClinico.js";

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
    delInforme.push({ key: a.key, label: a.label, tipo: a.tipo, ...(a.pista ? { pista: a.pista } : {}) });
  }
  return [
    BLOQUES_ENVOLTORIO.prepText,
    ...delInforme,
    BLOQUES_ENVOLTORIO.parentFeedback,
    BLOQUES_ENVOLTORIO.internalNotes,
  ];
}

/* ═══ El prompt ════════════════════════════════════════════════════════════ */

const CABECERA = `Recibes el material de una sesión con un paciente —la transcripción de la nota de voz que ha grabado la profesional, las notas que ha escrito, o las dos cosas— y escribes con él el registro clínico del centro, apartado por apartado.

Devuelve SOLO un JSON válido (sin texto alrededor, sin markdown, sin explicaciones), con una clave por apartado de la lista de abajo —todas, y ninguna que no esté— más, si hace falta, la clave "${CLAVE_NUEVOS}" que se explica al final.`;

/**
 * Las reglas del REPARTO: lo que es propio de escribir un documento por
 * apartados a partir de un dictado. Lo demás —quién escribe, qué se puede
 * añadir y qué no, cómo se marca una hipótesis, cuánto se desarrolla— vive en
 * `estiloClinico.js` y lo comparten los cuatro documentos que pasan por aquí.
 */
const REGLAS_REPARTO = `REGLAS DEL REPARTO:
1. Un apartado del que no se habla en el material —y que no sea de síntesis— se devuelve VACÍO ("" o [] si es lista). Es normal y correcto que varios salgan vacíos.
2. Cada hecho va en UN solo apartado, en el que mejor le corresponda; no repitas el mismo contenido en dos. Sí puedes retomarlo desde otro punto de vista cuando el apartado lo pida (lo que se observó en «Desempeño» sostiene la hipótesis de la impresión clínica), pero sin copiar la frase.
3. Respeta el tipo de cada apartado: "párrafo" es texto corrido —desarrollado, no una línea suelta—; "lista" es un array de entradas, cada una una idea completa. La excepción son los OBJETIVOS trabajados: ahí sí van etiquetas de 2 a 6 palabras.
4. Si el material trae los subpuntos de un apartado (la pista que va detrás del título), recórrelos: son las preguntas que se hicieron.`;

/**
 * Lo que ve el modelo antes de ponerse a escribir. Se exporta como CADENA
 * —además de la función de abajo— porque la comparten el registro de taller
 * (`tallerCompleto.js`) y el informe desde material (`informeMaterial.js`),
 * que la usan tal cual: mejorar esto los mejora a los tres.
 */
export const REGLAS = reglasDelReparto();

/**
 * Las mismas reglas, con lo que solo sabe quien construye ESTE prompt: si el
 * documento tiene apartados de síntesis y qué se sabe del paciente (edad y
 * áreas, nunca el nombre).
 */
export function reglasDelReparto({ sintesis = false, contexto = "" } = {}) {
  return [estiloClinico({ sintesis, contexto }), REGLAS_REPARTO].join("\n\n");
}

const TIPO_HUMANO = { lista: "lista", texto: "párrafo" };

/**
 * La ficha de un bloque tal como la lee Claude. Exportada desde el 03/09/2026
 * porque el prompt de la sesión de TALLER (`tallerCompleto.js`) se construye
 * con las mismas fichas: un bloque se describe igual sea de quien sea.
 *
 * `sintesis` marca los apartados que se elaboran a partir del conjunto —la
 * impresión clínica, la propuesta de actuación, lo que toca la próxima sesión—
 * y va APAGADO por defecto: la marca solo se entiende si el prompt lleva
 * también la instrucción que la explica (`reglasDelReparto({ sintesis: true })`),
 * y el taller no la lleva.
 */
export function lineaDeBloque(b, { sintesis = false } = {}) {
  const tipo = TIPO_HUMANO[b.tipo] ?? TIPO_HUMANO.texto;
  const marca = b.interno ? " [INTERNO — la familia no lo lee NUNCA]" : "";
  const deSintesis = sintesis && esApartadoDeSintesis(b) ? " [SÍNTESIS]" : "";
  const pista = b.pista ? ` — ${b.pista}` : "";
  return `- "${b.key}" · ${b.label} (${tipo})${marca}${deSintesis}${pista}`;
}

/**
 * El molde de respuesta, para que no haya que adivinar la forma del JSON.
 *
 * `conNuevos` añade la clave de los apartados que el modelo puede proponerse él
 * (`apartadosPropuestos.js`). No se pone siempre: el registro de TALLER no la
 * admite —su reparto solo escribe en claves que existen, y una nota individual
 * inventada iría a la familia equivocada—, así que ahí el molde se queda como
 * estaba.
 */
export function moldeDeBloques(bloques, { conNuevos = false } = {}) {
  const filas = bloques.map((b) => `  "${b.key}": ${b.tipo === "lista" ? '["…", "…"]' : '"…"'}`);
  if (conNuevos) filas.push(LINEA_MOLDE_NUEVOS);
  return `{\n${filas.join(",\n")}\n}`;
}

/**
 * El SYSTEM que se le manda a Claude, construido a partir de los bloques REALES
 * de este registro. Aquí está la diferencia con lo de antes: si el centro añade
 * «Entorno familiar» a su plantilla, aparece en esta lista y Claude lo rellena
 * sin que nadie toque una línea de código.
 *
 * `paciente` (04/09/2026) es opcional y solo aporta edad, áreas y nivel
 * educativo —nunca el nombre, ver `lineaDePaciente`—. Sin él el prompt es el de
 * siempre; con él, la terminología y lo que se propone se ajustan a la edad, que
 * es la diferencia entre un registro que vale para cualquiera y el de ESTE
 * paciente.
 */
export function promptDeRegistro(bloques, { paciente = null } = {}) {
  const lista = Array.isArray(bloques) ? bloques : [];
  const sintesis = haySintesis(lista);
  return [
    CABECERA,
    `APARTADOS DE ESTE REGISTRO (usa estas claves exactas):\n${lista
      .map((b) => lineaDeBloque(b, { sintesis }))
      .join("\n")}`,
    `FORMA EXACTA DE LA RESPUESTA:\n${moldeDeBloques(lista, { conNuevos: true })}`,
    reglasDelReparto({ sintesis, contexto: lineaDePaciente(paciente) }),
    // Lo que NO cabe en ningún apartado deja de tirarse (04/09/2026): el modelo
    // puede proponer apartados nuevos, y la profesional los acepta o no.
    INSTRUCCION_NUEVOS,
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

/** Un JSON que además es un objeto. Si no lo es, `null` y sin ruido. */
function intentarJson(s) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Cierra un JSON que se quedó a medias, quedándose con los pares COMPLETOS.
 *
 * Corta en la última coma del objeto raíz que esté FUERA de una cadena y cierra
 * la llave. Lo que hubiera después estaba a medio escribir y se tira: mejor
 * doce apartados ciertos que ninguno.
 */
function cerrarJsonCortado(s) {
  let dentro = false;
  let escape = false;
  const pila = [];
  let corte = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      if (dentro) escape = true;
      continue;
    }
    if (c === '"') {
      dentro = !dentro;
      continue;
    }
    if (dentro) continue;
    if (c === "{" || c === "[") pila.push(c);
    else if (c === "}" || c === "]") pila.pop();
    // Una coma a profundidad 1 separa dos apartados del objeto raíz: hasta ahí
    // todo lo anterior está entero.
    else if (c === "," && pila.length === 1) corte = i;
  }
  return corte === -1 ? "{}" : `${s.slice(0, corte)}}`;
}

/**
 * Escapa las comillas que están DENTRO del texto de un valor, y los saltos de
 * línea literales, para que un JSON así se pueda parsear.
 *
 * ── DE QUÉ FALLO REAL NACE (04/09/2026, probado contra la IA de Aumenta) ───
 * En cuanto se le pidió a Claude que redactara de verdad —y no que repartiera
 * frases— empezó a CITAR, que es lo que hace una profesional al escribir:
 *
 *   "funcionamientoActual": "…verbaliza autodescalificaciones ("es tonto"), lo
 *   que es compatible con un autoconcepto que empieza a resentirse."
 *
 * Esas dos comillas rectas rompen el JSON entero, y con él los 18 apartados de
 * la entrevista: `JSON.parse` falla, el recorte entre llaves falla igual
 * —porque el texto está roto por dentro, no por fuera— y la profesional ve una
 * propuesta VACÍA después de esperar cuarenta segundos. Salió en 3 de cada 4
 * pruebas, así que no es un caso raro: es el caso normal.
 *
 * Al prompt se le pide usar comillas españolas (« »), pero pedir no basta —la
 * misma lección que `verificarSinInventar`—, así que aquí se repara.
 *
 * ── CÓMO SE SABE SI UNA COMILLA CIERRA O ES DEL TEXTO ──────────────────────
 * Cierra solo si detrás viene lo que puede venir detrás de un valor: `:` (era
 * una clave), `}` o `]`, una coma SEGUIDA de otra comilla (el par siguiente) o
 * el final. Cualquier otra cosa —un paréntesis, una palabra, una coma con texto
 * detrás— es una comilla dentro de la frase y se escapa.
 *
 * No pretende arreglar todo JSON roto imaginable: `dijo "hola", "adiós"` dentro
 * de un mismo valor lo seguiría rompiendo. Arregla el caso que ocurre, y si no
 * puede, se devuelve lo de siempre («ilegible») y nadie está peor que antes.
 */
export function escaparComillasDeDentro(s) {
  const texto = String(s ?? "");
  let salida = "";
  let dentro = false;
  let escape = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (escape) {
      salida += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      salida += c;
      escape = dentro; // fuera de una cadena, una barra suelta no escapa nada
      continue;
    }
    if (c === '"') {
      if (!dentro) {
        dentro = true;
        salida += c;
        continue;
      }
      // Detrás de un valor (o de una clave) solo puede venir esto:
      if (/^\s*(?:[:}\]]|,\s*["{[]|$)/.test(texto.slice(i + 1))) {
        dentro = false;
        salida += c;
      } else {
        salida += '\\"';
      }
      continue;
    }
    // Un salto de línea literal dentro de una cadena rompe el JSON igual que
    // una comilla, y se cuela por lo mismo: el modelo escribe párrafos.
    if (dentro && (c === "\n" || c === "\r")) {
      salida += c === "\n" ? "\\n" : "";
      continue;
    }
    salida += c;
  }
  return salida;
}

/**
 * Lee lo que ha contestado Claude → `{ objeto, incidencia }`.
 *
 * ── POR QUÉ ESTO NO ES UN `JSON.parse` Y YA (01/09/2026, Rodrigo) ──────────
 * «Cuando mando un audio usando la IA, a veces falla que lo mande al registro.»
 * El «a veces» era literal y tenía dos causas, las dos MUDAS:
 *
 *  1. **La respuesta se corta.** El registro entero de un centro con muchos
 *     apartados no cabía en el tope de tokens; el JSON llegaba partido a mitad
 *     de una frase, `JSON.parse` reventaba y la propuesta salía VACÍA. Depende
 *     del largo del audio: por eso unas veces sí y otras no.
 *  2. **La respuesta viene envuelta.** Un «Aquí tienes el JSON:» delante o una
 *     coletilla detrás y el parseo se caía igual — `sinVallas` solo quitaba la
 *     valla pegada al principio y al final del todo.
 *
 * En los dos casos la pantalla decía «la IA no ha sacado nada que repartir»,
 * que es lo contrario de lo que había pasado: sacó, y se tiró por el camino.
 * Ahora se rescata lo que llegó entero y se DICE qué ha pasado, que es lo que
 * permite a la profesional decidir si vuelve a intentarlo.
 */
export function leerRespuesta(bruto) {
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) return { objeto: bruto, incidencia: null };
  const s = sinVallas(bruto);
  if (!s) return { objeto: {}, incidencia: "vacia" };

  const directo = intentarJson(s);
  if (directo) return { objeto: directo, incidencia: null };

  const abre = s.indexOf("{");
  if (abre === -1) return { objeto: {}, incidencia: "ilegible" };

  // Envuelta: preámbulo, coletilla o vallas por el medio.
  const cierra = s.lastIndexOf("}");
  if (cierra > abre) {
    const recortado = intentarJson(s.slice(abre, cierra + 1));
    if (recortado) return { objeto: recortado, incidencia: "envuelta" };
  }

  // Con comillas sin escapar dentro del texto (04/09/2026, ver
  // `escaparComillasDeDentro`). Se prueba sobre el recorte y, si tampoco, sobre
  // lo que se pueda cerrar: los tres fallos pueden venir juntos.
  const conComillas = intentarJson(escaparComillasDeDentro(s.slice(abre, cierra > abre ? cierra + 1 : undefined)));
  if (conComillas) {
    console.warn("[clinica:leerRespuesta] JSON reparado: comillas sin escapar en el texto");
    return { objeto: conComillas, incidencia: null };
  }

  // Cortada: se rescata lo que llegó entero.
  const rescatado = intentarJson(cerrarJsonCortado(s.slice(abre)));
  if (rescatado) return { objeto: rescatado, incidencia: "cortada" };

  const cortadaConComillas = intentarJson(cerrarJsonCortado(escaparComillasDeDentro(s.slice(abre))));
  if (cortadaConComillas) return { objeto: cortadaConComillas, incidencia: "cortada" };

  return { objeto: {}, incidencia: "ilegible" };
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
  // El parseo defensivo —y el rescate de lo que venga cortado o envuelto— vive
  // en `leerRespuesta`. Aquí solo se reparte por bloques.
  const parsed = leerRespuesta(bruto).objeto;
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

/**
 * Tope de la transcripción que la pantalla devuelve para una segunda pasada.
 * Mucho más alto que `MAX_NOTAS` a propósito: nadie ESCRIBE 20.000 caracteres,
 * pero 25 MB de audio (el máximo de Whisper) los pasan de largo. No es un
 * criterio clínico, es acotar el cuerpo de la petición.
 */
export const MAX_TRANSCRIPCION = 200_000;

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
