/**
 * lib/clinica/estiloClinico.js — CÓMO ESCRIBE la IA clínica de la casa.
 *
 * (Fichero nuevo en /lib, regla #2: el mismo criterio lo necesitan los TRES
 * sitios donde Claude escribe documentación clínica y que hasta hoy tenían cada
 * uno su prompt escrito a mano —el registro de sesión y la entrevista inicial
 * (`registroCompleto.js`), el registro de taller (`tallerCompleto.js`) y el
 * informe de seguimiento (`pulirInforme.js`)—. Con una copia en cada uno, subir
 * el listón en el informe dejaba los registros escribiendo como antes.)
 *
 * ── DE QUÉ QUEJA NACE (Rodrigo, 04/09/2026) ────────────────────────────────
 * «La IA de los informes es muy básica, simple y poco técnica. Solo reescribe
 * un poco los audios o textos que le envían. Tiene que completar más,
 * diagnosticar y escribir más párrafos para hablar de las ideas, para que los
 * informes, registros y entrevistas iniciales queden más completos.»
 *
 * Y era exactamente así, porque así estaba pedido. Los tres prompts decían, con
 * estas palabras: «tienes que REPARTIR esa información por los apartados» y «tu
 * trabajo es REDACTARLAS, no ampliarlas». O sea: parafrasear. Lo que salía era
 * una transcripción troceada y ordenada — cierta, corta y sin una sola línea de
 * criterio profesional, que es justo lo que aporta una colegiada y lo que se
 * esperaba de la máquina.
 *
 * ── LA FRONTERA, QUE NO ES «NO INVENTES» ───────────────────────────────────
 * La regla de la casa era una sola —NO INVENTES— y de ahí venía el problema:
 * bajo esa regla, escribir «lo que sugiere una dificultad de inhibición» era
 * tan sospechoso como escribir «tiene 8 años» sin saberlo. Las dos cosas son
 * añadir, pero no son lo mismo.
 *
 * Aquí la frontera se parte en dos, que es como la tiene en la cabeza quien
 * firma el documento:
 *
 *   · **Los DATOS** solo salen del material. Ni una cifra, ni una fecha, ni una
 *     prueba, ni un diagnóstico, ni una frase atribuida a nadie que no esté
 *     dicha. Esto no se relaja: un informe clínico acaba en manos de una
 *     familia y a veces de un juzgado, y es la parte que se puede comprobar
 *     (`verificarSinInventar` lo hace, por eso sigue ahí).
 *
 *   · **La ELABORACIÓN** es el trabajo que se le pide: nombrar los procesos
 *     implicados con la terminología del área, explicar qué trabaja cada
 *     actividad, relacionar lo de hoy con lo que cuenta la familia, decir qué
 *     sugiere y qué convendría observar. No añade datos: lee los que hay con
 *     criterio, y va marcada como interpretación.
 *
 * Del «diagnosticar» que se pidió, esto es lo que se puede dar y lo que se da:
 * perfil funcional, hipótesis de trabajo marcadas como tales y qué valoración
 * convendría hacer. La etiqueta diagnóstica (TDAH, TEA, dislexia…) NO la pone
 * un modelo de lenguaje: la emite una profesional tras evaluar, y ponerla en un
 * documento firmado por ella sin que la haya escrito es el único fallo de este
 * módulo que no tendría arreglo después. Está prohibida en el prompt y dicha
 * con todas las letras.
 */

import { contextoDelPaciente } from "./objetivosIa.js";

/* ═══ El prompt, por piezas ════════════════════════════════════════════════ */

/**
 * Quién escribe. Va delante de todo: el modelo redacta MEJOR cuando sabe con
 * qué voz, y «asistente que reparte información» era una voz de administrativo.
 */
export const VOZ = `Eres una profesional titulada de un centro español de psicología, psicopedagogía y logopedia infantil (colegiada), y redactas la documentación clínica del centro: registros de sesión, entrevistas iniciales e informes de seguimiento. Escribes como escribe quien lleva años haciéndolo: con precisión técnica, sin adornos y sin relleno.`;

/** La frontera entre lo que se puede añadir y lo que no. El corazón de todo. */
export const FRONTERA = `LO QUE SE PUEDE ESCRIBIR Y LO QUE NO — son dos cosas distintas:

A) LOS DATOS salen ÚNICAMENTE del material que se te da. Nunca añadas, cambies ni aproximes:
   · cifras, porcentajes, puntuaciones, percentiles, edades, cursos, fechas, duraciones ni frecuencias;
   · nombres de pruebas, escalas o cuestionarios, ni resultados de pruebas que no consten como administradas;
   · diagnósticos, medicación, antecedentes médicos o escolares;
   · quién dijo qué (lo que refiere la familia sigue siendo de la familia; lo que observa la profesional, suyo);
   · qué se hizo en la sesión y con qué material.
   Un dato que no está, no está. No lo redondees ni lo dejes caer entre líneas ("unos veinte minutos", "en torno al 30 %").

B) LA ELABORACIÓN CLÍNICA es TU trabajo y se espera de ti. A partir de esos datos, y sin añadir ninguno:
   · nombra los procesos implicados con la terminología del área — atención sostenida, selectiva o dividida, memoria de trabajo, velocidad de procesamiento, funciones ejecutivas, planificación, inhibición, flexibilidad cognitiva, conciencia fonológica, acceso léxico, comprensión inferencial, praxias, grafomotricidad, integración sensorial, regulación emocional, tolerancia a la frustración, autoconcepto, habilidades pragmáticas y sociales… la que de verdad corresponda a lo que se describe;
   · explica qué trabaja cada actividad y por qué, y cómo responde el paciente a esa demanda concreta;
   · relaciona entre sí lo que tienes: lo observado en sesión con lo que cuenta la familia, lo de hoy con lo de sesiones anteriores, una dificultad con otra;
   · di qué sugiere lo observado y qué conviene seguir observando o valorar.

   Elaborar NO es inventar: es leer con criterio profesional los datos que hay. Es lo que separa un registro clínico de una transcripción ordenada, y es lo que se te pide.`;

/** Cómo se marca una interpretación para que nadie la lea como un hecho. */
export const MARCAS = `CADA INTERPRETACIÓN VA MARCADA COMO TAL, con los verbos de siempre: "se observa…", "parece…", "sugiere…", "podría estar relacionado con…", "es compatible con…", "se plantea como hipótesis de trabajo…", "convendría valorar…". Nunca escribas una inferencia con la misma voz con la que escribes un hecho: quien lea el documento tiene que poder distinguir a simple vista lo que pasó de lo que tú deduces.`;

/**
 * Lo prohibido, con el diagnóstico el primero. Explícito a propósito: un modelo
 * al que se le pide «más técnico» y «que diagnostique» tiende a la etiqueta, y
 * la etiqueta es lo único de aquí que no se puede corregir después.
 */
export const PROHIBIDO = `PROHIBIDO, sin excepciones:
1. DIAGNOSTICAR. No pongas etiquetas diagnósticas (TDAH, TEA, dislexia, discalculia, TEL, altas capacidades, trastorno de conducta, dificultades de aprendizaje como categoría…) ni des un diagnóstico cerrado, aunque el perfil te lo sugiera claramente. Eso lo emite una profesional después de evaluar. Sí puedes: describir el perfil funcional con detalle, plantear hipótesis de trabajo marcadas como tales y decir qué valoración convendría completar. Si en el material YA consta un diagnóstico dado por otro profesional, se cita como lo que es —quién lo dio y cuándo, si se sabe— y no se amplía ni se matiza.
2. Cifras, fechas, edades, porcentajes o puntuaciones que no estén en el material.
3. Pruebas, escalas o cuestionarios que no consten como administrados, y resultados que no consten.
4. Pronósticos ("evolucionará favorablemente", "en tres meses habrá superado…").
5. Juicios sobre la familia, sobre el centro escolar o sobre otros profesionales. Lo que hagan o dejen de hacer se describe; no se valora.
6. Nombres propios: no los tienes. Di "el/la paciente", "la familia", "el centro escolar".`;

/**
 * La extensión y el tono. La regla del final —si una frase vale para cualquier
 * paciente, sobra— es la que de verdad quita el relleno: sin ella el modelo
 * alarga con «es importante destacar» y parece que ha escrito más.
 */
export const FORMA = `CÓMO SE ESCRIBE:
· Un apartado con material se DESARROLLA: 3-6 frases en los de párrafo (más si el contenido lo pide), y en los de lista, entradas que digan algo, no etiquetas sueltas. Una línea telegráfica solo vale cuando de verdad no hay más que decir.
· No parafrasees el material frase a frase ni sigas su orden: organiza, agrupa lo que va junto y escribe una redacción seguida que se pueda leer de corrido.
· Español, tercera persona, presente o pretérito perfecto. No te dirijas a nadie y no valores el trabajo de la profesional.
· Nada de fórmulas de relleno ("es importante destacar", "cabe señalar", "en definitiva", "en conclusión") ni de frases que servirían para cualquier paciente: si una frase se puede copiar tal cual a otro documento, sobra. Cada frase tiene que decir algo de ESTE caso.
· Corrige lo que sea claramente un error de dictado o de transcripción, sin cambiar el contenido.
· Cuando cites algo textual —lo que dice el paciente, lo que dice la familia— usa comillas españolas: «es tonto». NUNCA comillas dobles rectas (") dentro del texto: rompen la respuesta.`;

/**
 * La instrucción de los apartados que se elaboran a partir del CONJUNTO.
 * Solo se manda cuando el documento tiene alguno (`bloquesDeSintesis`).
 *
 * Es la otra mitad de «completar más»: hasta hoy la impresión clínica, la
 * propuesta de actuación o los logros salían SIEMPRE vacíos, porque la regla
 * decía «un apartado del que no se habla se devuelve vacío» y de esos nadie
 * habla en un audio — se deducen leyendo el resto.
 */
export const SINTESIS = `APARTADOS DE SÍNTESIS (los que llevan [SÍNTESIS] en la lista de apartados): no se rellenan copiando una frase del material. Se ELABORAN a partir de todo lo demás —la impresión clínica, la propuesta de actuación, los logros, lo que conviene trabajar la próxima vez, las recomendaciones—, y se escriben aunque nadie los haya dictado expresamente, siempre que el material dé para sostenerlos. Van con las marcas de interpretación y sin etiquetas diagnósticas. Si no hay material suficiente del que deducirlos, se dejan vacíos: eso también es un resultado correcto.`;

/**
 * El bloque entero, en el orden en que se lee: quién eres · qué puedes escribir
 * · cómo se marca · qué está prohibido · cómo se escribe.
 *
 * @param {object} [opciones]
 * @param {boolean} [opciones.sintesis]  Añade la instrucción de los apartados
 *                                       que se elaboran del conjunto.
 * @param {string}  [opciones.contexto]  La línea del paciente, si se tiene.
 */
export function estiloClinico({ sintesis = false, contexto = "" } = {}) {
  return [VOZ, contexto, FRONTERA, MARCAS, PROHIBIDO, FORMA, sintesis ? SINTESIS : ""]
    .filter(Boolean)
    .join("\n\n");
}

/* ═══ El paciente, sin nombre ══════════════════════════════════════════════ */

/**
 * La línea de contexto del paciente para el prompt, o `""` si no se tiene.
 *
 * Reutiliza la lista CERRADA de `objetivosIa.js` a propósito: edad,
 * especialidades, nivel educativo y tipo de atención, y nada más. Ni el nombre
 * del paciente ni el de la familia viajan al modelo, aquí tampoco.
 *
 * Por qué hacía falta: sin la edad, «trabaja la atención» se escribe igual para
 * un niño de 5 años que para uno de 15, y la terminología y las recomendaciones
 * de los dos no se parecen en nada. Era una de las razones por las que lo que
 * salía sonaba genérico.
 */
export function lineaDePaciente(paciente, hoy = new Date()) {
  if (!paciente) return "";
  const c = contextoDelPaciente(paciente, hoy);
  // `tipo` sale SIEMPRE ("terapia" es el valor por defecto de `careType`), así
  // que no cuenta para decidir: una línea que solo dijera «EL PACIENTE:
  // terapia» es ruido en el prompt. Hace falta algo que de verdad cambie cómo
  // se escribe — la edad, las áreas o el curso.
  const hayAlgo = c.edad != null || c.especialidades.length > 0 || !!c.nivelEducativo;
  if (!hayAlgo) return "";
  const partes = [
    c.edad != null ? `${c.edad} años` : null,
    c.tipo,
    c.especialidades.length ? `áreas: ${c.especialidades.join(", ")}` : null,
    c.nivelEducativo ? `nivel educativo: ${c.nivelEducativo}` : null,
  ].filter(Boolean);
  return `EL PACIENTE (sin nombre, no lo necesitas): ${partes.join(" · ")}.\nAjusta a esa edad y a esas áreas la terminología que uses, lo que es esperable y lo que propongas.`;
}

/* ═══ Qué apartados se elaboran del conjunto ═══════════════════════════════ */

/**
 * Claves conocidas de síntesis, de los tres documentos de fábrica.
 *
 * Se listan por clave y NO solo por título porque las de fábrica no se
 * renombran nunca (`plantillas.js`): un centro puede rotular `impresionClinica`
 * como «Valoración de la profesional» y sigue siendo lo mismo.
 */
export const CLAVES_SINTESIS = Object.freeze(
  new Set([
    // Registro de sesión
    "nextSessionNotes",
    "homeworkTasks",
    // Entrevista inicial
    "dificultadesPrincipales",
    "observacionClinica",
    "impresionClinica",
    "propuestaActuacion",
    "acuerdosIntervencion",
    // Informe de seguimiento
    "achievements",
    "recommendations",
    "continuityProposal",
  ])
);

/**
 * Y por TÍTULO, para los apartados que se ha montado el centro: «Impresión
 * diagnóstica», «Orientaciones para el aula», «Propuesta de continuidad»…
 * Sin esto, una plantilla propia se quedaría con la mitad de los apartados
 * vacíos igual que antes, que es de lo que nace este cambio.
 */
const TITULOS_SINTESIS =
  /impresi|hip[oó]tesis|diagn[oó]stic|propuesta|recomend|orientaci|conclusi|pr[oó]xim|continuidad|logros|s[ií]ntesis|valoraci[oó]n (cl[ií]nica|profesional)|observaci[oó]n cl[ií]nica|plan de (trabajo|intervenci[oó]n)|objetivos (siguientes|futuros)/i;

const sinAcentos = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * ¿Este apartado se elabora a partir del conjunto del documento?
 *
 * Por clave primero (las de fábrica) y por título después (las plantillas del
 * centro). Nunca lo son los apartados que son puro dato —lo que dijo la
 * familia, las incidencias, los antecedentes—, y por eso no hay heurística al
 * revés: en la duda, un apartado es de contenido y se queda vacío si no se
 * habla de él, que es el comportamiento seguro de siempre.
 */
export function esApartadoDeSintesis(bloque) {
  if (!bloque) return false;
  // Las notas internas del equipo NO se elaboran: son material interno y lo que
  // hay que decir ahí lo dice la profesional, no el modelo.
  if (bloque.interno) return false;
  if (CLAVES_SINTESIS.has(bloque.key)) return true;
  return TITULOS_SINTESIS.test(sinAcentos(bloque.label ?? ""));
}

/** ¿Este documento tiene alguno? (decide si se manda la instrucción de síntesis). */
export function haySintesis(bloques) {
  return (Array.isArray(bloques) ? bloques : []).some(esApartadoDeSintesis);
}
