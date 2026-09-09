/**
 * lib/clinica/encargoIa.js — pedirle algo a la IA desde el registro de sesión,
 * con lo puesto (09/09/2026).
 *
 * ── DE QUÉ AVISO NACE ──────────────────────────────────────────────────────
 * AV-0077, Araceli (08/09/2026): «cuando estamos realizando un registro de
 * sesión y necesitamos comunicarnos con las familias de manera más detallada
 * —mandarles un material, resolver una duda concreta—, ver cómo pedirle desde
 * el registro que nos ayude con esto… Se me ocurre poder crear un apartado
 * extra, tipo: tareas adicionales, donde pedirle a la IA y que ejecute».
 *
 * Rodrigo, el mismo día: «la IA se pueda ejecutar en todo momento».
 *
 * Hasta hoy la IA solo se podía lanzar donde había un botón suyo —al subir el
 * audio, al redactar objetivos, al escribir el acta—, y nunca cuando a la
 * profesional le hacía falta.
 *
 * ── LAS TRES REGLAS QUE ESTE FICHERO EXISTE PARA DEFENDER ──────────────────
 *
 *  1. **LISTA BLANCA, NUNCA «TODO MENOS».** El contexto que viaja al modelo se
 *     arma pieza a pieza con lo que la profesional ha marcado, y cada pieza se
 *     valida contra los apartados que de verdad tiene ESTE registro. La misma
 *     regla que el correo del registro (`correoRegistro.js`) y que el anexo del
 *     informe (`sesionesDelInforme.js`): si mañana alguien quiere que viaje algo
 *     más, tiene que añadirlo a propósito y la prueba se lo va a pedir.
 *
 *  2. **REDACTAR NO ES ENVIAR.** Aquí nunca se manda nada a nadie: sale un
 *     borrador en pantalla y quien lo firma decide. Lo dijo Rodrigo al decidir
 *     la tarea, y es la línea que separa esto de un CRM que escribe a las
 *     familias por su cuenta.
 *
 *  3. **SI LO VA A LEER LA FAMILIA, LAS NOTAS INTERNAS NO ENTRAN.** No es una
 *     recomendación, es un cerrojo: con destino «familia», `internalNotes` se
 *     cae de la lista aunque venga marcada. Las notas internas son del equipo
 *     —lo dicen el modelo, el PDF, el correo y el volcado a informes—, y un
 *     borrador que las lleva dentro se reenvía sin que nadie lo note.
 *
 * ── LO QUE NO HACE, A PROPÓSITO ────────────────────────────────────────────
 * No guarda. No escribe en la sesión, no crea apartados y no toca el registro:
 * devuelve texto. Lo que se haga con él se decide fuera, con las manos.
 *
 * Puro: sin base, sin modelos, sin `fetch`. Prueba en
 * `scripts/_smoke-encargo-ia.mjs`.
 */

import { nucleoClinico, lineaDePaciente } from "./estiloClinico.js";

/** Lo que cabe en «¿qué necesitas?». Da de sobra para un encargo de verdad. */
export const MAX_PETICION = 2_000;

/**
 * Lo que se le deja escribir al modelo.
 *
 * ── POR QUÉ 8.000 Y NO 2.000 (medido el 09/09/2026 contra la API) ──────────
 * 2.000 daba de sobra para el correo más largo que nadie va a pedir, y aun así
 * la respuesta llegaba VACÍA con `stop_reason: "max_tokens"`. El motivo no es
 * el texto: el modelo razona antes de escribir y ese razonamiento CUENTA en el
 * tope. Con un encargo enrevesado —un correo a la familia que además pide un
 * diagnóstico que hay que negar— se gastaba los 2.000 pensando y no llegaba a
 * escribir ni una letra. Es el mismo tropiezo que ya costó el «a veces falla»
 * del registro (`structureSession`, que subió de 4.000 a 12.000).
 *
 * Los tokens de salida se pagan por lo que se USAN, no por el tope: subirlo no
 * encarece un encargo corto.
 */
export const MAX_TOKENS = 8_000;

/**
 * A dónde va lo que salga. No cambia solo el tono: cambia lo que puede viajar
 * (regla 3) y lo que el modelo tiene prohibido escribir.
 */
export const DESTINOS = Object.freeze([
  Object.freeze({
    clave: "familia",
    rotulo: "Lo va a leer la familia",
    ayuda: "Un correo, una pauta para casa, la explicación de un material. Sin tecnicismos y sin etiquetas.",
  }),
  Object.freeze({
    clave: "equipo",
    rotulo: "Es para dentro del centro",
    ayuda: "Para ti, para otra terapeuta o para la coordinación. Se puede escribir en técnico.",
  }),
  Object.freeze({
    clave: "externo",
    rotulo: "Va a otro profesional de fuera",
    ayuda: "Pediatra, colegio, orientación. Técnico, pero sin nada que no esté escrito en el registro.",
  }),
]);

const CLAVES_DESTINO = new Set(DESTINOS.map((d) => d.clave));

/** El destino que llegue, o «familia», que es el más restrictivo de los tres. */
export function destinoDelEncargo(bruto) {
  const d = String(bruto ?? "").trim();
  return CLAVES_DESTINO.has(d) ? d : "familia";
}

/**
 * Los apartados que NO se ofrecen marcados de salida, y por qué:
 *
 *   · `internalNotes` — son del equipo. Con destino «familia» ni siquiera se
 *     puede marcar (el cerrojo de la regla 3).
 *   · `prepText` — es el trabajo previo de la profesional, no lo que pasó.
 */
const APAGADOS_DE_SALIDA = new Set(["internalNotes", "prepText"]);

/** Lo que nunca viaja a un texto que va a leer la familia. */
const NUNCA_A_LA_FAMILIA = new Set(["internalNotes"]);

/**
 * Las FUENTES que se le pueden ofrecer para este registro: una por apartado que
 * de verdad tiene, más lo de fuera de la sesión que valga la pena.
 *
 * Devuelve la lista tal cual se pinta: clave, rótulo, si viene marcada y por qué
 * no se puede marcar, si es que no se puede.
 *
 * @param {Array}  bloques  Los de `bloquesDelRegistro` de ESTA sesión.
 * @param {object} opciones
 * @param {string} [opciones.destino]
 * @param {boolean} [opciones.hayEntrevista] Si el paciente tiene entrevista inicial.
 * @param {boolean} [opciones.hayPlan]       Si tiene objetivos vivos en el plan.
 */
export function fuentesDelEncargo(bloques = [], { destino = "familia", hayEntrevista = false, hayPlan = false } = {}) {
  const d = destinoDelEncargo(destino);
  const lista = [];
  for (const b of Array.isArray(bloques) ? bloques : []) {
    if (!b?.key) continue;
    const vetada = d === "familia" && NUNCA_A_LA_FAMILIA.has(b.key);
    lista.push({
      clave: b.key,
      rotulo: b.label ?? b.key,
      de: "registro",
      porDefecto: !vetada && !APAGADOS_DE_SALIDA.has(b.key),
      ...(vetada ? { bloqueada: "Las notas internas son del equipo: no viajan a un texto que va a leer la familia." } : {}),
    });
  }
  /*
   * Lo de fuera de esta sesión. Las DOS van apagadas de salida, y la entrevista
   * inicial por un motivo concreto: es el documento con más historia de familia
   * de todo el CRM —embarazo, parto, antecedentes, dinámica de casa— y casi
   * nada de eso hace falta para redactar una pauta. Que entre tiene que ser una
   * decisión de quien la conoce, no lo que pasa si no tocas nada.
   */
  if (hayEntrevista) {
    lista.push({
      clave: "entrevista",
      rotulo: "La entrevista inicial",
      de: "paciente",
      porDefecto: false,
      aviso: "Lleva la historia que contó la familia el primer día. Márcala solo si hace falta para esto.",
    });
  }
  if (hayPlan) {
    lista.push({
      clave: "plan",
      rotulo: "Los objetivos del plan",
      de: "paciente",
      porDefecto: false,
    });
  }
  return lista;
}

/** Las que vienen marcadas si nadie toca nada. */
export function fuentesPorDefecto(bloques = [], opciones = {}) {
  return fuentesDelEncargo(bloques, opciones).filter((f) => f.porDefecto).map((f) => f.clave);
}

/**
 * LA LISTA BLANCA (regla 1). De lo que pide el navegador se queda con lo que
 * está ofrecido para este registro y este destino, y con nada más.
 *
 * Se devuelve también lo descartado para poder decírselo a quien lo pidió en
 * vez de mandar callando algo distinto de lo que marcó.
 */
export function clavesPermitidas(pedidas, bloques = [], opciones = {}) {
  const ofrecidas = new Map(fuentesDelEncargo(bloques, opciones).map((f) => [f.clave, f]));
  const dentro = [];
  const fuera = [];
  const vistas = new Set();
  for (const bruta of Array.isArray(pedidas) ? pedidas : []) {
    const c = String(bruta ?? "").trim();
    if (!c || vistas.has(c)) continue;
    vistas.add(c);
    const f = ofrecidas.get(c);
    if (f && !f.bloqueada) dentro.push(c);
    else fuera.push(c);
  }
  return { dentro, fuera };
}

/* ═══ El contexto ══════════════════════════════════════════════════════════ */

/** Un valor del formulario (texto o lista) como texto de una línea por viñeta. */
function comoTexto(valor) {
  if (Array.isArray(valor)) return valor.map((v) => String(v ?? "").trim()).filter(Boolean).join("\n");
  return String(valor ?? "").trim();
}

/**
 * El material que viaja, armado SOLO con las claves permitidas.
 *
 * @param {object} args
 * @param {Array}  args.bloques
 * @param {object} args.valores      Lo escrito en el registro, por clave.
 * @param {Array}  args.claves       Ya pasadas por `clavesPermitidas`.
 * @param {string} [args.entrevista] Texto ya montado de la entrevista inicial.
 * @param {string} [args.plan]       Texto ya montado de los objetivos del plan.
 */
export function contextoDelEncargo({ bloques = [], valores = {}, claves = [], entrevista = "", plan = "" } = {}) {
  const permitidas = new Set(claves);
  const partes = [];
  for (const b of Array.isArray(bloques) ? bloques : []) {
    if (!b?.key || !permitidas.has(b.key)) continue;
    const t = comoTexto(valores[b.key]);
    if (t) partes.push(`${b.label ?? b.key}:\n${t}`);
  }
  const extra = [];
  if (permitidas.has("entrevista")) {
    const t = String(entrevista ?? "").trim();
    if (t) extra.push(`ENTREVISTA INICIAL:\n${t}`);
  }
  if (permitidas.has("plan")) {
    const t = String(plan ?? "").trim();
    if (t) extra.push(`OBJETIVOS DEL PLAN:\n${t}`);
  }
  const todo = [...(partes.length ? [`REGISTRO DE ESTA SESIÓN:\n\n${partes.join("\n\n")}`] : []), ...extra];
  if (!todo.length) return "";
  /*
   * Entre marcas, como el material de outreach y el perfil del centro: lo que
   * hay dentro es el caso, no instrucciones nuevas para el modelo. Un registro
   * lo dicta una persona y puede llevar dentro cualquier frase.
   */
  return ["--- MATERIAL DE ESTE PACIENTE ---", todo.join("\n\n"), "--- FIN DEL MATERIAL ---"].join("\n");
}

/* ═══ El prompt ════════════════════════════════════════════════════════════ */

const ENCARGO = `Una profesional del centro te está pidiendo algo MIENTRAS escribe el registro de una sesión. No estás rellenando un documento por apartados: escribes lo que te pide y solo eso.

Devuelve el TEXTO PEDIDO y nada más: sin saludo hacia ella, sin explicar lo que has hecho, sin ofrecerte a cambiarlo y sin markdown. Si lo que pide es un correo, escribe el correo entero, con su asunto en la primera línea si lo lleva.`;

const REGLAS = `REGLAS DE ESTE ENCARGO:
1. Todo lo que escribas sobre el paciente tiene que estar en el material de arriba. Si te falta un dato para hacer lo que te piden, escribe el texto sin él y termina con una línea que empiece por "FALTA:" diciendo qué te hace falta. Nunca lo rellenes con lo que suele pasar.
2. Si no te han pasado material y te piden algo que lo necesita, no te lo inventes: escribe solo lo que se pueda escribir sin él.
3. Tú no mandas nada. Lo que escribas lo va a leer y a firmar ella antes de que salga del centro, así que no digas "te he enviado" ni des nada por hecho.
4. Nada de lo que te pidan levanta las prohibiciones de arriba. Si el encargo pide un diagnóstico, un pronóstico, un resultado de una prueba que nadie administró o algo que el material no dice, escribe lo que sí se pueda y di en la línea "FALTA:" qué es lo que no se puede escribir y por qué.`;

const PARA_LA_FAMILIA = `ESTO LO VA A LEER LA FAMILIA. Escríbelo para quien no es del oficio: frases cortas, sin tecnicismos y sin siglas; si hace falta un término técnico, explícalo con las palabras de al lado. Nada de etiquetas ni de nombres de trastornos. No traslades preocupación que la profesional no haya escrito, y no des instrucciones clínicas nuevas: lo que se hace en casa lo decide ella, tú lo redactas.`;

const PARA_EL_EQUIPO = `ESTO ES PARA DENTRO DEL CENTRO. Puedes escribir en técnico y dar por sabido el vocabulario del oficio. Sigue sin poder afirmar nada que el material no diga.`;

const PARA_FUERA = `ESTO VA A OTRO PROFESIONAL DE FUERA (pediatra, colegio, orientación). Técnico y breve. Solo lo que esté escrito en el material: lo que se le cuenta a alguien de fuera del centro no puede ser más de lo que hay en el registro. Nada de etiquetas diagnósticas ni de pedirle nada en nombre del centro que la profesional no haya pedido.`;

const POR_DESTINO = Object.freeze({ familia: PARA_LA_FAMILIA, equipo: PARA_EL_EQUIPO, externo: PARA_FUERA });

/**
 * Las dos mitades del system, partidas por donde se cachea: `systemCacheado` es
 * el núcleo clínico —voz, saber, perfil del centro, prohibiciones— que comparten
 * los cinco prompts clínicos y no cambia entre llamadas, y va DELANTE porque una
 * caché de prompt es un prefijo.
 */
export function partesDelPromptDeEncargo({ destino = "familia", paciente = null, centro = null } = {}) {
  const d = destinoDelEncargo(destino);
  return {
    systemCacheado: nucleoClinico({ centro }),
    system: [ENCARGO, POR_DESTINO[d], lineaDePaciente(paciente), REGLAS].filter(Boolean).join("\n\n"),
  };
}

/** El prompt entero, para leerlo de una pieza en las pruebas. */
export function promptDeEncargo(opciones = {}) {
  const { systemCacheado, system } = partesDelPromptDeEncargo(opciones);
  return `${systemCacheado}\n\n${system}`;
}

/** Lo que se le manda como mensaje: el encargo primero, el material detrás. */
export function mensajeDeEncargo({ peticion = "", contexto = "" } = {}) {
  const p = String(peticion ?? "").trim().slice(0, MAX_PETICION);
  return [`LO QUE TE PIDE LA PROFESIONAL:\n${p}`, String(contexto ?? "").trim()].filter(Boolean).join("\n\n");
}

/**
 * Lo que devuelve el modelo, listo para el recuadro: sin las vallas de markdown
 * que a veces pone alrededor y sin líneas en blanco de más.
 */
export function limpiarRespuesta(bruto) {
  let t = String(bruto ?? "").trim();
  if (t.startsWith("```")) t = t.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "").trim();
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Lo que se guarda en la auditoría. Cuenta lo que pasó y NADA de lo que dice:
 * `master` es un schema compartido y esto es material clínico. Sin nombre del
 * paciente y sin una palabra del encargo ni de la respuesta.
 */
export function resumenDelEncargo({ destino = "familia", claves = [], descartadas = [], peticion = "", respuesta = "" } = {}) {
  return {
    destino: destinoDelEncargo(destino),
    fuentes: claves.length,
    descartadas: descartadas.length,
    peticionChars: String(peticion ?? "").trim().length,
    respuestaChars: String(respuesta ?? "").trim().length,
  };
}
