/**
 * redactarInforme — compone el borrador de un informe A PARTIR de los registros
 * de sesión elegidos (sprint Aumenta 2026-07, punto 3.1).
 *
 * (Fichero nuevo en /lib, regla #2: es lógica de redacción, no de transporte, y
 * la van a compartir el endpoint de hoy y la redacción asistida por IA de
 * mañana — que se apoyará EN ESTO, no lo sustituirá: primero se junta lo que
 * dicen las sesiones y luego, si acaso, se le pide a la IA que lo pula.)
 *
 * DOS REGLAS QUE NO SE TOCAN:
 *
 * 1. NO PISA LO ESCRITO. Lo que la terapeuta ya haya redactado se queda tal
 *    cual; esto solo rellena lo vacío y AÑADE a las listas lo que falta. Un
 *    botón que borra el trabajo de alguien no se vuelve a pulsar nunca.
 * 2. NO INVENTA. Cada línea sale literal de un registro de sesión, con su
 *    fecha delante. Un informe clínico es un documento que acaba en manos de
 *    una familia —y a veces de un juzgado—: si una frase no la escribió la
 *    profesional, no puede aparecer.
 */

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function fechaCorta(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}

const texto = (v) => (v == null ? "" : String(v).trim());
const norm = (v) => texto(v).toLowerCase().replace(/\s+/g, " ");

/** Añade a una lista lo que no esté ya (comparando sin mayúsculas ni espacios). */
function anadirSinDuplicar(lista, nuevas) {
  const salida = Array.isArray(lista) ? [...lista] : [];
  const vistas = new Set(salida.map(norm));
  for (const n of nuevas) {
    const limpio = texto(n);
    if (!limpio || vistas.has(norm(limpio))) continue;
    vistas.add(norm(limpio));
    salida.push(limpio);
  }
  return salida;
}

function comoLista(v) {
  if (Array.isArray(v)) return v.map(texto).filter(Boolean);
  const t = texto(v);
  return t ? [t] : [];
}

/**
 * Devuelve las `contentSections` nuevas.
 *
 * ── LOS OBJETIVOS SALEN DEL PLAN (09/09/2026, AV-0099) ─────────────────────
 * Laura Garrido: «los objetivos, la idea no es que se haga un resumen de los
 * objetivos de cada una de las sesiones, sino que se vuelquen los objetivos que
 * están escritos en el PLAN del paciente, que son más generales y no son solo
 * los trabajados en las sesiones registradas». Y preguntada si valía para todos
 * los tipos de informe o solo para evolución y alta, contestó: para todos.
 *
 * Tiene razón y se ve en los números: los objetivos de una sesión son
 * etiquetas de dos a seis palabras («Soplo sostenido», «Praxias linguales»),
 * y de veinte sesiones salen cuarenta etiquetas repetidas que no dicen qué se
 * perseguía. Los del plan son los de verdad, sobre todo en psicología, donde
 * el mismo objetivo se trabaja de diez maneras.
 *
 * Si el paciente no tiene plan, o su plan no tiene objetivos, se cae a los de
 * las sesiones: es peor un informe con el apartado vacío que uno con etiquetas.
 *
 * @param actual   contentSections que ya tiene el informe
 * @param sesiones filas de ClinicSession (o su JSON), en cualquier orden
 * @param opciones.objetivosDelPlan  los del `InterventionPlan` del paciente
 */
export function redactarDesdeSesiones(actual, sesiones, { objetivosDelPlan = null } = {}) {
  const base = actual && typeof actual === "object" ? { ...actual } : {};
  const filas = (sesiones ?? [])
    .map((s) => (s.toJSON ? s.toJSON() : s))
    .sort((a, b) => new Date(a.sessionDate) - new Date(b.sessionDate));

  const objetivos = [];
  const evolucion = [];
  const dificultades = [];
  const recomendaciones = [];
  const logros = [];

  for (const s of filas) {
    const cuando = fechaCorta(s.sessionDate);
    const obs = s.observations && typeof s.observations === "object" ? s.observations : {};

    for (const o of comoLista(s.objectives)) objetivos.push(o);

    // El cuerpo de la evolución: qué se hizo y cómo respondió, con su fecha.
    const desempeno = texto(s.performance);
    const actividades = texto(s.activities);
    if (desempeno || actividades) {
      const cuerpo = desempeno && actividades ? `${actividades} ${desempeno}` : desempeno || actividades;
      evolucion.push(`${cuando}: ${cuerpo}`);
    }

    // Lo que cuenta la familia va identificado como tal: no es observación
    // clínica y mezclarlo sería atribuirle a la profesional algo que no dijo.
    const familia = texto(s.parentFeedback) || texto(obs.familyComments);
    if (familia) evolucion.push(`${cuando}, la familia refiere: ${familia}`);

    const incidencias = texto(obs.incidents);
    if (incidencias) dificultades.push(`${cuando}: ${incidencias}`);

    for (const r of [texto(obs.nextSessionNotes), texto(obs.homeworkTasks)]) {
      if (r) recomendaciones.push(r);
    }
  }

  // Los del PLAN mandan; los de las sesiones son el plan B (ver arriba).
  const delPlan = (Array.isArray(objetivosDelPlan) ? objetivosDelPlan : [])
    .map((o) => (typeof o === "string" ? o : o?.texto ?? o?.text ?? ""))
    .map((t) => texto(t))
    .filter(Boolean);

  return {
    ...base,
    objectives: anadirSinDuplicar(base.objectives, delPlan.length ? delPlan : objetivos),
    evolution: anadirSinDuplicar(base.evolution, evolucion),
    achievements: anadirSinDuplicar(base.achievements, logros),
    persistentDifficulties: anadirSinDuplicar(base.persistentDifficulties, dificultades),
    recommendations: anadirSinDuplicar(base.recommendations, recomendaciones),
    // Texto libre: el motivo de intervención y la propuesta de continuidad los
    // escribe la profesional. No hay nada en una sesión suelta que los diga.
    motiveOfIntervention: base.motiveOfIntervention ?? "",
    continuityProposal: base.continuityProposal ?? "",
    sourceSessionIds: filas.map((s) => s.id),
  };
}

/** Cuántas líneas aportaría cada sección (para avisar antes de escribir). */
export function resumenRedaccion(antes, despues) {
  const cuenta = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    objetivos: cuenta(despues.objectives) - cuenta(antes?.objectives),
    evolucion: cuenta(despues.evolution) - cuenta(antes?.evolution),
    dificultades: cuenta(despues.persistentDifficulties) - cuenta(antes?.persistentDifficulties),
    recomendaciones: cuenta(despues.recommendations) - cuenta(antes?.recommendations),
  };
}
