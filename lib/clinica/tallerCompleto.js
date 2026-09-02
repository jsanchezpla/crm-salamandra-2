/**
 * lib/clinica/tallerCompleto.js — QUÉ es «el registro entero» de una sesión de
 * TALLER, y cómo se le pide a Claude que lo rellene desde el audio o las notas
 * (03/09/2026, Rodrigo: «añade audio e IA a la sesión de taller»).
 *
 * (Fichero nuevo en /lib, regla #2: la misma lista de bloques la necesitan el
 * endpoint que llama a Claude y la pantalla que enseña la propuesta; y el
 * reparto de la propuesta —qué es del grupo y qué es de cada niño— es la regla
 * más delicada del módulo y tiene que estar escrita UNA vez y probada sin base
 * de datos.)
 *
 * ── EN QUÉ SE PARECE AL REGISTRO NORMAL Y EN QUÉ NO ────────────────────────
 * Se parece en todo lo que importa: el material es el mismo (un audio, unas
 * notas, o los dos), el prompt se CONSTRUYE desde los apartados que de verdad
 * tiene ese registro, no se inventa nada, y quien decide apartado por apartado
 * es la profesional. Por eso reutiliza las piezas de `registroCompleto.js`
 * (fichas de bloque, molde, reglas, parseo defensivo, normalización).
 *
 * Lo distinto es la FORMA del registro de un taller (`tallerSesion.js`):
 *
 *   · El cuerpo COMÚN — los apartados de la plantilla — es igual para los ocho.
 *   · Una NOTA INDIVIDUAL por asistente, que solo ve su familia.
 *   · Las notas internas del grupo, que no salen del CRM.
 *
 * Y no hay preparación ni devolución de la familia: el taller no tiene esos
 * envoltorios.
 *
 * ── LA REGLA QUE NO SE NEGOCIA ─────────────────────────────────────────────
 * Lo que se dice de UN niño con nombre va a SU nota y a ningún otro sitio.
 * Si Claude pusiera «Leo se levantó dos veces» en «Cómo ha ido el grupo», la
 * propagación lo copiaría al registro de los otros siete, y siete familias
 * leerían lo de Leo. El prompt lo dice con todas las letras y el reparto de
 * abajo (`repartirPropuestaDeTaller`) solo escribe la nota de un asistente en
 * la clave de ESE asistente: una clave que no case con un asistente de la
 * lista se tira.
 */

import { normalizarApartados, PLANTILLA_BASE } from "./plantillas.js";
import { apartadosComunes, ETIQUETA_NOTA_POR_DEFECTO } from "./tallerSesion.js";
import { lineaDeBloque, moldeDeBloques, normalizarPropuesta, REGLAS } from "./registroCompleto.js";

const texto = (v) => (v == null ? "" : String(v).trim());

/** Prefijo de la clave del bloque de cada asistente: `nota:<patientId>`. */
export const PREFIJO_NOTA = "nota:";

/** La clave del bloque de un asistente, a partir de su id de paciente. */
export function claveDeNota(patientId) {
  return `${PREFIJO_NOTA}${texto(patientId)}`;
}

/** ¿Esta clave es la nota individual de un asistente? Devuelve su id o null. */
export function pacienteDeClave(clave) {
  const k = texto(clave);
  return k.startsWith(PREFIJO_NOTA) && k.length > PREFIJO_NOTA.length ? k.slice(PREFIJO_NOTA.length) : null;
}

/** El bloque de las notas internas del grupo: interno, y por eso marcado. */
export const BLOQUE_INTERNAS = Object.freeze({
  key: "internalNotes",
  label: "Notas internas del grupo",
  tipo: "texto",
  interno: true,
  pista:
    "SOLO material interno del equipo que ninguna familia debe leer: cómo están los padres, avisos para compañeros, incidencias del centro. No repitas aquí nada de lo que ya va en el registro del grupo ni en la nota de un niño. Si en el audio no hay nada de esto, déjalo vacío — es lo más normal.",
});

/**
 * Los asistentes tal como los manda la pantalla, limpios: solo los que tienen
 * id y nombre, sin repetidos. Sin nombre no hay forma de que Claude sepa de
 * quién se habla, así que ese asistente no tiene bloque (y no se inventa).
 */
export function asistentesLimpios(bruto) {
  const vistos = new Set();
  const salida = [];
  for (const a of Array.isArray(bruto) ? bruto : []) {
    const patientId = texto(a?.patientId);
    const nombre = texto(a?.nombre).slice(0, 120);
    if (!patientId || !nombre || vistos.has(patientId)) continue;
    vistos.add(patientId);
    salida.push({ patientId, nombre });
  }
  return salida;
}

/**
 * EL registro entero de una sesión de taller, en orden de pantalla: los
 * apartados comunes de la plantilla · la nota de cada asistente · las notas
 * internas del grupo.
 *
 * Sin apartados (o corruptos) se cae a los de fábrica del registro, como hace
 * `bloquesDelRegistro`: un taller sin cuerpo común no es un registro.
 */
export function bloquesDelTaller({ apartados, asistentes, etiquetaNota } = {}) {
  const pedidos = apartadosComunes(apartados);
  const base = pedidos.length ? pedidos : apartadosComunes(PLANTILLA_BASE.registro.apartados);
  const etiqueta = texto(etiquetaNota) || ETIQUETA_NOTA_POR_DEFECTO;
  const comunes = [];
  const vistas = new Set([BLOQUE_INTERNAS.key]);
  for (const a of base) {
    // Un apartado que robe la clave de las notas internas o de una nota no es
    // un apartado común: gana el bloque con sitio propio.
    if (vistas.has(a.key) || pacienteDeClave(a.key)) continue;
    vistas.add(a.key);
    comunes.push({
      key: a.key,
      label: a.label,
      tipo: a.tipo,
      grupo: "comun",
      ...(a.pista ? { pista: a.pista } : {}),
    });
  }
  const notas = asistentesLimpios(asistentes).map((a) => ({
    key: claveDeNota(a.patientId),
    label: `${etiqueta} · ${a.nombre}`,
    tipo: "texto",
    grupo: "nota",
    patientId: a.patientId,
    nombre: a.nombre,
    pista: `SOLO lo que se diga de ${a.nombre} por su nombre. Lo lee su familia y nadie más. Si no se le nombra, vacío.`,
  }));
  return [...comunes, ...notas, { ...BLOQUE_INTERNAS, grupo: "interno" }];
}

/* ═══ El prompt ════════════════════════════════════════════════════════════ */

const CABECERA = `Eres el asistente de registro clínico de un centro de psicopedagogía infantil. Recibes la transcripción de una nota de voz que una profesional ha grabado sobre una SESIÓN DE TALLER EN GRUPO (varios pacientes a la vez), y tienes que repartir esa información por los apartados del registro del centro.

El registro de un taller tiene tres partes y NO se mezclan:
  · El REGISTRO DEL GRUPO: lo que se trabajó, las actividades, cómo ha ido el grupo en conjunto. Se copia IGUAL a la ficha de todos los asistentes y lo leen todas sus familias. Aquí NO puede aparecer el nombre de ningún niño ni nada que se diga de uno en concreto.
  · La NOTA INDIVIDUAL de cada asistente: solo lo que se dice de ESE niño, nombrándolo. La lee únicamente su familia.
  · Las NOTAS INTERNAS del grupo: material del equipo que no sale del CRM.

Devuelve SOLO un JSON válido (sin texto alrededor, sin markdown, sin explicaciones), con EXACTAMENTE una clave por apartado de la lista de abajo y ninguna más.`;

const REGLAS_TALLER = `REGLAS PROPIAS DEL TALLER (mandan sobre las de arriba si chocan):

7. Lo que se dice de un niño con nombre va SOLO a su nota individual. Nunca en el registro del grupo, nunca en la nota de otro niño. Si un nombre no está en la lista de asistentes, no le inventes una nota: si lo que se dice de él es relevante para el equipo, va a las notas internas.
8. En el registro del grupo escribe en plural y sin nombres («el grupo», «los participantes», «dos de ellos»).
9. Un asistente del que no se dice nada tiene su nota VACÍA. No repartas el texto del grupo entre las notas.`;

/**
 * El SYSTEM que se le manda a Claude, construido desde los bloques REALES de
 * este taller: los apartados de su plantilla y sus asistentes con nombre.
 */
export function promptDeTaller(bloques) {
  const lista = Array.isArray(bloques) ? bloques : [];
  const comunes = lista.filter((b) => b.grupo === "comun");
  const notas = lista.filter((b) => b.grupo === "nota");
  const internos = lista.filter((b) => b.grupo === "interno");
  const seccion = (titulo, bs) => (bs.length ? `${titulo}\n${bs.map(lineaDeBloque).join("\n")}` : "");
  return [
    CABECERA,
    [
      seccion("REGISTRO DEL GRUPO (usa estas claves exactas):", comunes),
      seccion(
        `NOTA INDIVIDUAL DE CADA ASISTENTE (${notas.length ? notas.map((b) => b.nombre).join(", ") : "sin lista de asistentes"}):`,
        notas
      ),
      seccion("NOTAS INTERNAS:", internos),
    ]
      .filter(Boolean)
      .join("\n\n"),
    `FORMA EXACTA DE LA RESPUESTA:\n${moldeDeBloques(lista)}`,
    REGLAS,
    REGLAS_TALLER,
  ].join("\n\n");
}

/**
 * El mensaje de usuario: la transcripción y, si el registro ya lleva algo
 * escrito a mano, lo que hay — como contexto, no para que lo copie.
 */
export function mensajeDeTaller({ transcription, escrito = null, bloques = [] }) {
  const partes = [`TRANSCRIPCIÓN DE LA NOTA DE VOZ DEL TALLER:\n\n${texto(transcription)}`];
  const yaEscrito = [];
  for (const b of Array.isArray(bloques) ? bloques : []) {
    const v = texto(escrito?.[b.key]);
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

/**
 * Lo que devuelve Claude → la bolsa plana por clave de bloque (una cadena por
 * bloque; en los de lista, una línea por viñeta). El parseo defensivo es el de
 * `registroCompleto.js`.
 */
export function normalizarPropuestaDeTaller(bruto, bloques) {
  return normalizarPropuesta(bruto, bloques);
}

/**
 * La propuesta plana → las tres partes del registro del taller, YA separadas:
 *
 *   { comunes: { clave: texto }, notas: { patientId: texto }, internalNotes }
 *
 * Solo pasan las claves que existen en `bloques`: una nota para un id que no
 * está entre los asistentes se tira, y un apartado común que no esté en la
 * plantilla, también. Es el cerrojo de la regla de la cabecera.
 */
export function repartirPropuestaDeTaller(propuesta, bloques) {
  const p = propuesta && typeof propuesta === "object" ? propuesta : {};
  const salida = { comunes: {}, notas: {}, internalNotes: "" };
  for (const b of Array.isArray(bloques) ? bloques : []) {
    const v = texto(p[b.key]);
    if (b.grupo === "nota") {
      if (v) salida.notas[b.patientId] = v;
    } else if (b.grupo === "interno") {
      salida.internalNotes = v;
    } else if (v) {
      salida.comunes[b.key] = v;
    }
  }
  return salida;
}

/**
 * Lo ya escrito en el formulario del taller, en la forma plana de los bloques:
 * los valores comunes por su clave, la nota de cada asistente por la suya y las
 * internas. Viaja a Claude como contexto y vuelve a la pantalla como «lo tuyo».
 */
export function escritoDelTaller({ valores, asistentes, internalNotes } = {}) {
  const escrito = {};
  for (const [k, v] of Object.entries(valores && typeof valores === "object" ? valores : {})) {
    const t = texto(v);
    if (t) escrito[k] = t;
  }
  for (const a of Array.isArray(asistentes) ? asistentes : []) {
    const t = texto(a?.nota);
    if (texto(a?.patientId) && t) escrito[claveDeNota(a.patientId)] = t;
  }
  const internas = texto(internalNotes);
  if (internas) escrito[BLOQUE_INTERNAS.key] = internas;
  return escrito;
}

/* ═══ Datos de demostración (solo desarrollo) ══════════════════════════════ */

export const TRANSCRIPCION_DEMO_TALLER =
  "Hoy en el taller hemos trabajado esperar el turno y pedir ayuda a un compañero. Hemos hecho un juego cooperativo de construcción por equipos y al final una asamblea para contar cómo se han sentido. El grupo ha estado bien, aunque en el juego de construcción dos de ellos han necesitado que les recordáramos el turno. Leo ha esperado su turno en todas las rondas y ha pedido ayuda a un compañero sin que se lo dijéramos. Marta ha estado más dispersa que otros días y se ha levantado un par de veces. Para el equipo: la madre de Marta me ha dicho al recoger que están en plena mudanza.";

const DEMO_COMUN = {
  objectives: "Esperar el turno\nPedir ayuda a un compañero",
  activities: "Juego cooperativo de construcción por equipos y asamblea final para contar cómo se han sentido.",
  performance: "El grupo ha trabajado bien; en el juego de construcción dos participantes han necesitado que se les recordara el turno.",
  nextSessionNotes: "Seguir con el turno en juegos de mesa.",
};

/**
 * La propuesta de demostración, con la forma de los bloques que se piden: los
 * comunes por clave, la nota del primer asistente con el ejemplo de Leo y la
 * del segundo con el de Marta, y las internas. Un apartado propio del centro
 * sale vacío, como haría el modelo si no se hablara de él.
 */
export function propuestaDemoTaller(bloques) {
  const lista = Array.isArray(bloques) ? bloques : [];
  const notas = lista.filter((b) => b.grupo === "nota");
  const bruto = {};
  for (const b of lista) {
    if (b.grupo === "comun") {
      const v = DEMO_COMUN[b.key] ?? "";
      bruto[b.key] = b.tipo === "lista" && v ? v.split("\n") : v;
    } else if (b.grupo === "interno") {
      bruto[b.key] = notas.length > 1 ? `La madre de ${notas[1].nombre} comenta que están en plena mudanza.` : "";
    }
  }
  if (notas[0]) bruto[notas[0].key] = `${notas[0].nombre} ha esperado su turno en todas las rondas y ha pedido ayuda a un compañero sin que se lo recordáramos.`;
  if (notas[1]) bruto[notas[1].key] = `${notas[1].nombre} ha estado más dispersa que otros días y se ha levantado un par de veces.`;
  return normalizarPropuestaDeTaller(bruto, lista);
}
