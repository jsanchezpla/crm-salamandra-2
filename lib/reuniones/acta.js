/**
 * lib/reuniones/acta.js — el acta de una REUNIÓN DE EQUIPO: la escribe el CRM
 * a partir de un audio o de unas notas, igual que un registro de sesión
 * (01/09/2026, Aumenta por Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Implantar una plantilla para actas de reunión para que las haga directamente
 * el CRM a través de un audio o unas notas que le suba, como los registros de
 * sesión. Esas actas de reunión son para la categoría de Reunión de equipo.»
 *
 * ── POR QUÉ NO HAY TABLA NUEVA ──────────────────────────────────────────────
 * Un acta es de UNA reunión, y una reunión ya es una fila: el bloqueo de la
 * agenda con `category_key = 'reunion_equipo'` (`lib/citas/categoriasBloqueo.js`).
 * Uno a uno, sin excepción posible — no existe la segunda acta de la misma
 * reunión. Así que el acta son tres columnas de `team_blocks` y no una tabla
 * con su FK, su borrado en cascada y su ciclo de vida propio:
 *
 *   · `acta_sections`   (JSONB) el acta escrita, con la MISMA forma que el
 *                       `content_sections` de una sesión clínica: la foto de
 *                       apartados con los que se escribió, más un valor por
 *                       clave. Se reutiliza entera `lib/clinica/plantillas.js`.
 *   · `acta_transcript` (TEXT)  de qué texto salió: la transcripción del audio
 *                       y/o las notas pegadas. Se guarda porque el acta es un
 *                       resumen y, cuando alguien discute un acuerdo tres
 *                       semanas después, la pregunta es «¿eso se dijo?».
 *   · `acta_updated_at` cuándo se escribió por última vez.
 *
 * `TallerSesion` sí necesitó tabla, y la diferencia dice por qué: aquella se
 * COPIA a la ficha de cada asistente. Un acta no baja a ninguna ficha — es del
 * equipo y se queda en la reunión.
 *
 * ── LO INTERNO ES INTERNO ───────────────────────────────────────────────────
 * El acta lleva un bloque de notas internas que NO es un apartado de plantilla,
 * igual que en el registro de sesión (`BLOQUES_ENVOLTORIO.internalNotes`). Una
 * reunión de equipo habla de personas —de familias, y también de compañeros—, y
 * hace falta un sitio para lo que se dijo que no va en el acta que luego se
 * reparte. Va marcado `interno: true` y quien imprima o comparta el acta tiene
 * que mirarlo.
 *
 * ── QUÉ NO DECIDE ESTE FICHERO ──────────────────────────────────────────────
 * Quién puede leer el acta. Eso lo decide la agenda: un bloqueo del centro
 * (`teamMemberId` a NULL) lo ve todo el equipo, y el reparto de un acta como
 * documento va por Documentos (`documents.team_block_id`), no por aquí.
 */

import {
  CLAVE_APARTADOS,
  CLAVE_PLANTILLA,
  PLANTILLA_BASE,
  normalizarApartados,
} from "../clinica/plantillas.js";

/**
 * La categoría de bloqueo que tiene acta. Es la clave de fábrica de «Reunión de
 * equipo» (`CATEGORIAS_CLINICA_BASE`), la misma que ya lee Productividad en
 * `lib/clinica/trabajoInterno.js`.
 *
 * Es UNA clave y no una lista a propósito: lo que se pidió es el acta de la
 * reunión de equipo. Si mañana el centro quiere actas de otra categoría, esto
 * se convierte en un ajuste del tenant y no en un `if` más por el JSX.
 */
export const CATEGORIA_ACTA = "reunion_equipo";

/** El documento de `DOCUMENTOS` (plantillas.js) del que salen sus apartados. */
export const DOC_ACTA = "acta";

/**
 * ¿Este tramo de agenda puede tener acta? Solo los de la categoría Reunión de
 * equipo — y solo si el centro tiene esa categoría dada de alta, cosa que se
 * comprueba fuera: aquí solo se mira lo que el bloqueo dice ser.
 */
export function puedeTenerActa(bloqueo) {
  return String(bloqueo?.categoryKey ?? "") === CATEGORIA_ACTA;
}

/**
 * El bloque de notas internas del acta. Mismo papel que el del registro de
 * sesión: una columna de verdad dentro del JSONB, no un apartado que el centro
 * pueda renombrar o quitar sin querer.
 */
export const BLOQUE_NOTAS_INTERNAS = Object.freeze({
  key: "internalNotes",
  label: "Notas internas del equipo",
  tipo: "texto",
  interno: true,
  pista:
    "SOLO lo que se dijo en la reunión y no debe salir del equipo: valoraciones sobre personas, asuntos de personal, temas delicados de una familia. Si en el audio no hay nada de esto, déjalo vacío — es lo más normal.",
});

/**
 * Pistas para Claude de los cinco apartados de fábrica. Son la parte que más se
 * va a retocar con el uso: describen QUÉ FRASES del audio van en cada sitio, no
 * qué significa el título. Un apartado que el centro añada por su cuenta no
 * tiene pista, y entonces manda su título — que para eso lo escribió.
 */
const PISTAS_BASE = Object.freeze({
  asistentes:
    "Quién estuvo en la reunión. Una línea por persona, con el nombre tal y como se dice en el audio. Si alguien se nombra como ausente («hoy no está Marta»), NO lo pongas como asistente.",
  temas:
    "De qué se habló, en orden y en prosa. Es el cuerpo del acta: cada asunto con lo que se dijo de él. No metas aquí las decisiones ni el reparto de tareas, que tienen su sitio.",
  acuerdos:
    "Lo que se DECIDIÓ, una línea por acuerdo. Solo decisiones cerradas («se cambia el horario de los martes»), no lo que se estuvo discutiendo. Si la reunión no cerró nada, déjalo vacío.",
  tareas:
    "Quién hace qué, y para cuándo si se dijo. Una línea por tarea, empezando por la persona: «Rosa — llamar a la familia X esta semana». Si no se asignó a nadie, ponlo igual sin nombre.",
  proximaReunion:
    "Cuándo es la próxima y qué queda pendiente para ella, si se dijo. Si no se habló de esto, déjalo vacío: no te lo inventes.",
});

/**
 * Los bloques del acta, en orden de pantalla: los apartados de la plantilla del
 * centro y, al final, las notas internas.
 *
 * Sin apartados —una pantalla vieja, un JSONB corrupto— se cae a los cinco de
 * fábrica y no a una lista vacía, por lo mismo que el registro: un acta sin
 * cuerpo no es un acta, y quedarse solo con las notas internas sería peor que
 * no proponer nada.
 */
export function bloquesDelActa(apartados) {
  const pedidos = normalizarApartados(apartados);
  const base = pedidos.length ? pedidos : PLANTILLA_BASE.acta.apartados;
  const vistas = new Set();
  const cuerpo = [];
  for (const a of base) {
    // Un apartado que pida la clave de las notas internas escribiría en el
    // mismo sitio, y encima colaría material interno en el acta repartible.
    if (a.key === BLOQUE_NOTAS_INTERNAS.key || vistas.has(a.key)) continue;
    vistas.add(a.key);
    cuerpo.push({ key: a.key, label: a.label, tipo: a.tipo, pista: PISTAS_BASE[a.key] ?? null });
  }
  return [...cuerpo, BLOQUE_NOTAS_INTERNAS];
}

/* ═══ El prompt ════════════════════════════════════════════════════════════ */

const CABECERA = [
  "Eres el secretario de actas de un centro de psicología y formación.",
  "Recibes la grabación (transcrita) o las notas de una reunión de equipo y escribes el ACTA.",
  "Escribes en español de España, en tercera persona y en pasado, con frases cortas.",
].join(" ");

const REGLAS = [
  "REGLAS:",
  "- Devuelve SOLO un objeto JSON. Sin explicaciones, sin markdown, sin vallas de código.",
  "- Usa EXACTAMENTE las claves indicadas. Ni una más.",
  "- Un apartado del que no se haya hablado va vacío (\"\" o []). Dejarlo vacío es correcto y es lo que se espera: NO inventes acuerdos, tareas, fechas ni asistentes.",
  "- No copies la transcripción: resume. Pero no interpretes ni opines: si algo quedó sin decidir, se dice que quedó sin decidir.",
  "- Los nombres propios, tal y como suenan en el audio. Si un nombre no se entiende, no lo escribas.",
  "- Nada de datos de salud de un paciente concreto en el cuerpo del acta: si en la reunión se habló de un caso, resume el asunto sin historia clínica.",
].join("\n");

function lineaDeBloque(b) {
  const tipo = b.tipo === "lista" ? "lista de líneas" : "texto";
  return `- ${b.key} (${tipo}) · ${b.label}${b.pista ? `: ${b.pista}` : ""}`;
}

function moldeDeBloques(bloques) {
  const campos = bloques.map((b) => `  "${b.key}": ${b.tipo === "lista" ? '["…", "…"]' : '"…"'}`);
  return `{\n${campos.join(",\n")}\n}`;
}

/** El SYSTEM, construido con los apartados REALES del acta de este centro. */
export function promptDelActa(bloques) {
  const lista = Array.isArray(bloques) ? bloques : [];
  return [
    CABECERA,
    `APARTADOS DE ESTA ACTA (usa estas claves exactas):\n${lista.map(lineaDeBloque).join("\n")}`,
    `FORMA EXACTA DE LA RESPUESTA:\n${moldeDeBloques(lista)}`,
    REGLAS,
  ].join("\n\n");
}

/**
 * El mensaje de usuario: el material de la reunión, más dos contextos que a un
 * acta le hacen mucha falta y a un registro de sesión no.
 *
 *  · **La plantilla del centro** ya va en el SYSTEM.
 *  · **Cuándo fue** — un acta lleva fecha, y «el martes que viene» solo se
 *    puede convertir en una fecha si se sabe qué día se dijo.
 *  · **Quiénes son del equipo** — para escribir «Rosa» y no «Rossa», y para no
 *    convertir en asistente a alguien que solo se nombró de pasada. Es una
 *    ayuda de ortografía, no una lista de asistencia: quién vino lo dice el
 *    audio.
 *
 * Lo ya escrito a mano viaja como contexto para no contradecirlo, igual que en
 * el registro de sesión, y con la misma orden explícita de no devolverlo.
 */
export function mensajeDelActa({ material, escrito = null, bloques = [], cuando = null, equipo = [] } = {}) {
  const partes = [];

  const cabecera = [];
  if (cuando) cabecera.push(`Fecha y hora de la reunión: ${cuando}.`);
  const nombres = (Array.isArray(equipo) ? equipo : [])
    .map((n) => String(n ?? "").trim())
    .filter(Boolean)
    .slice(0, 60);
  if (nombres.length) {
    cabecera.push(
      `Personas del centro (solo para escribir bien los nombres; NO son la lista de asistentes): ${nombres.join(", ")}.`
    );
  }
  if (cabecera.length) partes.push(cabecera.join("\n"));

  partes.push(`MATERIAL DE LA REUNIÓN:\n\n${String(material ?? "").trim()}`);

  const yaEscrito = [];
  for (const b of Array.isArray(bloques) ? bloques : []) {
    const v = String(escrito?.[b.key] ?? "").trim();
    if (v) yaEscrito.push(`- ${b.label}: ${v}`);
  }
  if (yaEscrito.length) {
    partes.push(
      `LO QUE YA ESTABA ESCRITO A MANO (contexto, NO lo copies ni lo devuelvas):\n${yaEscrito.join("\n")}\n\n` +
        "Tu propuesta sale del material de la reunión. Úsalo solo para no contradecirlo ni repetirlo con otras palabras."
    );
  }
  return partes.join("\n\n");
}

/* ═══ Lo que se guarda ═════════════════════════════════════════════════════ */

const MAX_VALOR = 20_000;

/**
 * El acta lista para guardar en `team_blocks.acta_sections`: la foto de los
 * apartados con los que se escribió y un valor por bloque, y nada más.
 *
 * Guardar la FOTO es lo que hace que un acta de hace un año se siga leyendo con
 * sus títulos aunque el centro haya cambiado la plantilla entera después — la
 * misma regla que el informe y el registro (`plantillas.js`). Y que solo se
 * guarden las claves de los bloques es lo que impide que el navegador meta en
 * el JSONB del acta cualquier otra cosa.
 */
export function limpiarActa(bruto, bloques) {
  const entrada = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {};
  const lista = Array.isArray(bloques) ? bloques : [];
  const salida = {
    [CLAVE_APARTADOS]: normalizarApartados(
      lista.filter((b) => !b.interno).map((b) => ({ key: b.key, label: b.label, tipo: b.tipo }))
    ),
    [CLAVE_PLANTILLA]: String(entrada[CLAVE_PLANTILLA] ?? "").trim().slice(0, 64),
  };
  for (const b of lista) {
    const v = entrada[b.key];
    const texto = Array.isArray(v)
      ? v.map((x) => String(x ?? "").trim()).filter(Boolean).join("\n")
      : String(v ?? "").trim();
    salida[b.key] = texto.slice(0, MAX_VALOR);
  }
  return salida;
}

/** ¿El acta está en blanco? (guardar un acta vacía es borrarla, ver el endpoint) */
export function actaVacia(acta) {
  if (!acta || typeof acta !== "object") return true;
  return !Object.entries(acta).some(
    ([k, v]) => k !== CLAVE_APARTADOS && k !== CLAVE_PLANTILLA && String(v ?? "").trim()
  );
}
