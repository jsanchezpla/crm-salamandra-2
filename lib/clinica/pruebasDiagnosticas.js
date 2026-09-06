/**
 * lib/clinica/pruebasDiagnosticas.js — el informe de VALORACIÓN DIAGNÓSTICA:
 * su plantilla de apartados y el catálogo de pruebas del centro (05/09/2026,
 * AV-0045 de Aumenta, Isabel Alberca; Rodrigo: «haz ambos»).
 *
 * (Fichero nuevo en /lib, regla #2: la plantilla la necesitan el cajón, el PDF
 * y el alta del informe; el catálogo lo necesitan la pantalla del informe, la
 * tarjeta de Configuración y el PDF. Una copia en cada sitio y se separan.)
 *
 * ── EL ENCARGO, ENTERO ──────────────────────────────────────────────────────
 * «Crear una plantilla de informe estructurada en los apartados que utilizamos
 * habitualmente»: datos, contexto, antecedentes, historia evolutiva,
 * observación clínica y pruebas administradas; un apartado «Resultados de la
 * evaluación» donde se ELIGEN las pruebas usadas —solo las administradas, no
 * todas— y cada una abre tres subapartados (qué evalúa, resultados con sus
 * puntuaciones e interpretación); integración clínica por áreas; conclusión
 * diagnóstica con DSM-5-TR y CIE-11, comórbidos, diferenciales y la sospecha
 * clínica; plan de intervención en tres campos; derivaciones; orientaciones.
 * Y «que el sistema quedara preparado para añadir nuevas pruebas en el futuro
 * sin tener que modificar toda la plantilla».
 *
 * ── LAS TRES PIEZAS ─────────────────────────────────────────────────────────
 *  1. **La plantilla** (`PLANTILLA_DIAGNOSTICO`): una plantilla de INFORME más,
 *     de fábrica, con clave fija —como la entrevista inicial lo es del
 *     registro—. Se ofrece en todos los centros con clínica detrás de las
 *     suyas, y si el centro guarda una con la misma clave, manda la suya. Son
 *     apartados de texto y de lista como los demás: `plantillas.js` no sabe
 *     nada especial de ella.
 *  2. **El catálogo** (`CATALOGO_PRUEBAS`): las 13 áreas y las pruebas de la
 *     lista que mandó el centro, con lo que evalúa cada una. El centro AÑADE
 *     las suyas en `settings.clinica.pruebasDiagnosticas` (JSONB en master,
 *     sin tabla nueva: el mismo sitio que las plantillas y las derivaciones);
 *     `pruebasDe(tenant)` devuelve las dos listas juntas.
 *  3. **Lo escrito** (`contentSections.pruebas`): las pruebas elegidas para ESTE
 *     informe, cada una con su descripción, su tabla de puntuaciones y su
 *     interpretación. Es una clave RESERVADA del JSONB (`plantillas.js`), y el
 *     PDF la imprime como el apartado «Resultados de la evaluación» detrás de
 *     «Pruebas administradas» (`apartadosInforme.js`).
 *
 * ── LA TABLA DE PUNTUACIONES ES GENÉRICA A PROPÓSITO ────────────────────────
 * Cada prueba tiene su baremo (directas, escalares, típicas, percentiles,
 * índices…), y escribir una tabla distinta por prueba —75 hoy, más mañana— es
 * lo que la petición quería evitar. Así que la fila es una sola y sirve para
 * todas: escala o índice · puntuación directa · típica o escalar · percentil ·
 * clasificación. Las columnas que no aplican se dejan en blanco y no se
 * imprimen vacías.
 */

const texto = (v) => (v == null ? "" : String(v).trim());

/** Dónde vive lo escrito dentro del JSONB del informe. */
export const CLAVE_PRUEBAS = "pruebas";
/** El tipo de informe (valor del enum de `clinical_reports`). */
export const TIPO_DIAGNOSTICO = "diagnostico";

/* ═══ La plantilla ═════════════════════════════════════════════════════════ */

/**
 * Los apartados del informe, en el orden en que los describió el centro. No
 * llevan los datos que ya imprime la portada (paciente, nacimiento y edad,
 * profesional, fecha): repetirlos en un apartado los pone dos veces.
 *
 * «Pruebas administradas» es la lista de nombres; los resultados de cada una
 * NO son un apartado: son `contentSections.pruebas`, que el PDF imprime justo
 * detrás como «Resultados de la evaluación» (ver cabecera).
 */
export const APARTADOS_DIAGNOSTICO_BASE = Object.freeze([
  { key: "datos_escolares", label: "Centro educativo y curso, o profesión", tipo: "texto" },
  { key: "profesionales_valoracion", label: "Profesionales responsables de la valoración", tipo: "texto" },
  { key: "periodo_evaluacion", label: "Fecha o periodo de evaluación", tipo: "texto" },
  { key: "motivo_consulta", label: "Motivo de consulta", tipo: "texto" },
  { key: "antecedentes", label: "Antecedentes personales y familiares", tipo: "texto" },
  { key: "historia_evolutiva", label: "Historia evolutiva y anamnesis", tipo: "texto" },
  { key: "contexto", label: "Contexto familiar, escolar, social y laboral", tipo: "texto" },
  { key: "area_emocional", label: "Área emocional", tipo: "texto" },
  { key: "intervenciones_previas", label: "Intervenciones o tratamientos previos", tipo: "texto" },
  { key: "medicacion", label: "Medicación", tipo: "texto" },
  { key: "observacion_clinica", label: "Observación clínica durante la evaluación", tipo: "texto" },
  { key: "pruebas_administradas", label: "Pruebas administradas", tipo: "lista" },
  { key: "integracion_clinica", label: "Integración clínica y psicopedagógica", tipo: "texto",
    pista: "Interpretación global por áreas, no prueba por prueba: funcionamiento cognitivo · atención y funciones ejecutivas · aprendizaje · lenguaje · área emocional · conducta · funcionamiento social · autonomía" },
  { key: "diagnostico_principal", label: "Diagnóstico principal", tipo: "texto" },
  { key: "dsm5", label: "Según DSM-5-TR: denominación y código", tipo: "texto" },
  { key: "cie11", label: "Según CIE-11: denominación y código", tipo: "texto" },
  { key: "diagnosticos_asociados", label: "Diagnósticos asociados o comórbidos", tipo: "lista" },
  { key: "diagnosticos_diferenciales", label: "Diagnósticos diferenciales considerados", tipo: "lista" },
  { key: "otras_consideraciones", label: "Otras consideraciones clínicas relevantes", tipo: "texto" },
  { key: "sospecha_clinica", label: "Sospecha clínica, perfil de riesgo o necesidad de seguimiento", tipo: "texto",
    pista: "Cuando la valoración no permite confirmar un diagnóstico" },
  { key: "plan_terapeutico", label: "Plan de intervención: intervención terapéutica", tipo: "texto",
    pista: "Áreas prioritarias y profesionales que podrían intervenir" },
  { key: "plan_escolar", label: "Plan de intervención: contexto escolar", tipo: "texto",
    pista: "Orientaciones, necesidades de apoyo, adaptaciones metodológicas, coordinación con el centro" },
  { key: "plan_familiar", label: "Plan de intervención: contexto familiar", tipo: "texto",
    pista: "Pautas para casa, acompañamiento, psicoeducación, coordinación con la familia" },
  { key: "derivaciones", label: "Derivaciones", tipo: "lista", pista: "ORL, EOEP, Neurología…" },
  { key: "orientaciones_seguimiento", label: "Orientaciones y seguimiento", tipo: "texto" },
]);

export const PLANTILLA_DIAGNOSTICO = Object.freeze({
  key: TIPO_DIAGNOSTICO,
  name: "Informe de valoración diagnóstica",
  apartados: APARTADOS_DIAGNOSTICO_BASE,
});

/** Tras qué apartado se imprimen los resultados de las pruebas. */
export const CLAVE_ANTES_DE_RESULTADOS = "pruebas_administradas";
export const TITULO_RESULTADOS = "Resultados de la evaluación";

/* ═══ El catálogo ══════════════════════════════════════════════════════════ */

/** Clave estable de una prueba a partir de su nombre («WISC-V» → `wisc_v`). */
export function clavePrueba(nombre) {
  return texto(nombre)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * Las áreas, en el orden del listado del centro. `pruebas` son [nombre, qué
 * evalúa]. Una misma prueba puede estar en dos áreas (BRIEF-2 en atención y en
 * funciones ejecutivas; la Figura de Rey en ejecutivas y en memoria): en el
 * catálogo plano sale una sola vez, con todas sus áreas.
 */
const AREAS = [
  ["cognitiva", "Capacidad cognitiva e inteligencia", [
    ["WPPSI-IV", "Capacidad cognitiva en edad infantil"],
    ["WISC-V", "Inteligencia y perfil cognitivo en niños y adolescentes"],
    ["WAIS-IV", "Inteligencia en adolescentes mayores y adultos"],
    ["RIAS-2", "Inteligencia y memoria"],
    ["K-BIT", "Screening breve de inteligencia"],
    ["CUMANIN / CUMANES", "Madurez y desarrollo neuropsicológico"],
  ]],
  ["atencion", "Atención, impulsividad y TDAH", [
    ["AULA Nesplora", "Atención, impulsividad y actividad motora en entorno virtual"],
    ["AQUARIUM Nesplora", "Procesos atencionales y funciones ejecutivas"],
    ["d2-R", "Atención selectiva y concentración"],
    ["EMAV-1 / EMAV-2", "Atención sostenida"],
    ["CSAT", "Atención sostenida infantil"],
    ["CARAS-R", "Atención y control de la impulsividad"],
    ["Conners", "Sintomatología TDAH"],
    ["EDAH", "TDAH y problemas de conducta"],
    ["BRIEF-2", "Funciones ejecutivas en el contexto cotidiano"],
  ]],
  ["ejecutivas", "Funciones ejecutivas y neuropsicología", [
    ["ENFEN", "Funciones ejecutivas"],
    ["BRIEF-2", "Funcionamiento ejecutivo cotidiano"],
    ["Figura Compleja de Rey", "Planificación, organización visuoespacial y memoria"],
    ["Stroop", "Inhibición y control de la interferencia"],
    ["Torre de Londres", "Planificación y resolución de problemas"],
    ["NEPSY-II", "Evaluación neuropsicológica infantil"],
    ["CUMANES", "Desarrollo neuropsicológico"],
  ]],
  ["lectura", "Lectura y dislexia", [
    ["PROLEC-R", "Procesos lectores en Primaria"],
    ["PROLEC-SE-R", "Procesos lectores en Secundaria"],
    ["PROLEXIA", "Detección y diagnóstico de la dislexia"],
    ["TALE / TALE-2000", "Lectura y escritura"],
    ["DST-J", "Screening de riesgo de dislexia"],
  ]],
  ["escritura", "Escritura y ortografía", [
    ["PROESC", "Procesos de escritura"],
    ["TALE / TALE-2000", "Lectoescritura"],
    ["PROLEXIA", "Procesos relacionados con la dislexia"],
    ["PROLEXIA Diagnóstico", "Perfil específico de dificultades lectoras y escritoras"],
  ]],
  ["matematicas", "Matemáticas y discalculia", [
    ["TEDI-MATH", "Competencias matemáticas básicas"],
    ["TEMA-3", "Competencia matemática temprana"],
    ["BERDE", "Evaluación del rendimiento matemático"],
    ["Smartick – prueba de discalculia", "Screening de riesgo de discalculia"],
  ]],
  ["tea", "TEA y comunicación social", [
    ["ADOS-2", "Evaluación observacional de sintomatología TEA"],
    ["ADI-R", "Entrevista diagnóstica a familiares"],
    ["SCQ", "Screening de comunicación social y TEA"],
    ["M-CHAT-R/F", "Screening temprano de TEA"],
    ["SRS-2", "Responsividad social y sintomatología asociada a TEA"],
    ["CAST", "Screening de características TEA"],
  ]],
  ["emocional", "Área emocional y conductual", [
    ["SENA", "Problemas emocionales, conductuales y contextuales"],
    ["BASC", "Conducta y adaptación"],
    ["CBCL", "Problemas emocionales y conductuales"],
    ["CDI", "Sintomatología depresiva infantil"],
    ["STAIC", "Ansiedad estado/rasgo infantil"],
    ["STAI", "Ansiedad en adolescentes y adultos"],
  ]],
  ["lenguaje", "Lenguaje y logopedia", [
    ["CELF-5", "Evaluación integral del lenguaje"],
    ["CELF Preschool", "Lenguaje en edad infantil"],
    ["PLON-R", "Desarrollo del lenguaje oral"],
    ["BLOC-SR", "Componentes del lenguaje"],
    ["ITPA", "Procesos psicolingüísticos"],
    ["Peabody (PPVT)", "Vocabulario receptivo"],
    ["Registro Fonológico Inducido", "Producción fonológica"],
    ["Evaluación fonológica del habla", "Sonidos del habla y procesos fonológicos"],
  ]],
  ["sensorial", "Terapia ocupacional y procesamiento sensorial", [
    ["Sensory Profile 2", "Perfil de procesamiento sensorial"],
    ["SPM / SPM-2", "Procesamiento sensorial, praxis y participación"],
    ["Beery VMI", "Integración visomotora"],
    ["BOT-2", "Competencia motora"],
    ["MABC-2", "Coordinación y desarrollo motor"],
    ["PEDI-CAT", "Funcionamiento y autonomía"],
    ["AMPS", "Desempeño en actividades de la vida diaria"],
  ]],
  ["desarrollo", "Desarrollo y atención temprana", [
    ["Battelle", "Desarrollo global"],
    ["Bayley-III / Bayley-4", "Desarrollo infantil temprano"],
    ["Merrill-Palmer-R", "Desarrollo global infantil"],
    ["Brunet-Lézine", "Desarrollo psicomotor"],
    ["Portage", "Desarrollo y planificación de objetivos"],
  ]],
  ["memoria", "Memoria", [
    ["TOMAL-2", "Memoria y aprendizaje"],
    ["Figura Compleja de Rey", "Memoria visual"],
    ["TAVEC / TAVECI", "Aprendizaje y memoria verbal"],
    ["WMS-IV", "Memoria en adultos"],
    ["RIAS-2", "Índices de memoria"],
  ]],
  ["adaptativa", "Conducta adaptativa y autonomía", [
    ["Vineland-3", "Conducta adaptativa"],
    ["ABAS-II / ABAS-3", "Habilidades adaptativas"],
    ["PEDI-CAT", "Autonomía y funcionamiento cotidiano"],
  ]],
];

export const AREAS_PRUEBAS = Object.freeze(AREAS.map(([key, nombre]) => Object.freeze({ key, nombre })));

/** El catálogo PLANO de fábrica: una prueba por clave, con todas sus áreas. */
export const CATALOGO_PRUEBAS = Object.freeze((() => {
  const porClave = new Map();
  for (const [area, , pruebas] of AREAS) {
    for (const [nombre, uso] of pruebas) {
      const key = clavePrueba(nombre);
      const ya = porClave.get(key);
      if (ya) { if (!ya.areas.includes(area)) ya.areas.push(area); continue; }
      porClave.set(key, { key, nombre, uso, areas: [area], deFabrica: true });
    }
  }
  return [...porClave.values()].map((p) => Object.freeze({ ...p, areas: Object.freeze(p.areas) }));
})());

const MAX_NOMBRE = 120;
const MAX_USO = 300;
const MAX_PRUEBAS_CENTRO = 200;

/**
 * Las pruebas que AÑADE el centro (`settings.clinica.pruebasDiagnosticas`),
 * limpias: nombre obligatorio, área conocida o «otras», clave estable. Una con
 * la clave de una de fábrica no la pisa: se salta (la de fábrica manda).
 */
export function normalizarPruebasDelCentro(bruto) {
  if (!Array.isArray(bruto)) return [];
  const deFabrica = new Set(CATALOGO_PRUEBAS.map((p) => p.key));
  const areasValidas = new Set(AREAS_PRUEBAS.map((a) => a.key));
  const vistas = new Set();
  const salida = [];
  for (const crudo of bruto) {
    if (!crudo || typeof crudo !== "object") continue;
    const nombre = texto(crudo.nombre).slice(0, MAX_NOMBRE);
    if (!nombre) continue;
    const key = clavePrueba(nombre);
    if (!key || deFabrica.has(key) || vistas.has(key)) continue;
    vistas.add(key);
    const pedidas = Array.isArray(crudo.areas) ? crudo.areas : crudo.area ? [crudo.area] : [];
    const areas = pedidas.map(texto).filter((a) => areasValidas.has(a));
    salida.push({ key, nombre, uso: texto(crudo.uso).slice(0, MAX_USO), areas: areas.length ? areas : ["otras"], deFabrica: false });
    if (salida.length >= MAX_PRUEBAS_CENTRO) break;
  }
  return salida;
}

/** Las pruebas que puede elegir este centro: las de fábrica y las suyas. */
export function pruebasDe(tenant) {
  const propias = normalizarPruebasDelCentro(tenant?.settings?.clinica?.pruebasDiagnosticas);
  return [...CATALOGO_PRUEBAS.map((p) => ({ ...p, areas: [...p.areas] })), ...propias];
}

/** Las áreas para agrupar, con «Otras» al final solo si hace falta. */
export function areasDe(pruebas) {
  const lista = AREAS_PRUEBAS.map((a) => ({ ...a }));
  if ((pruebas ?? []).some((p) => p.areas?.includes("otras"))) lista.push({ key: "otras", nombre: "Otras pruebas" });
  return lista;
}

/* ═══ Lo escrito en un informe ═════════════════════════════════════════════ */

const MAX_PRUEBAS_INFORME = 40;
const MAX_FILAS = 40;
const MAX_CELDA = 80;
const MAX_TEXTO = 5000;

/** Las cinco columnas de la tabla de puntuaciones, en su orden. */
export const COLUMNAS_PUNTUACION = Object.freeze([
  { key: "escala", label: "Escala / índice" },
  { key: "pd", label: "P. directa" },
  { key: "pt", label: "P. típica / escalar" },
  { key: "pc", label: "Percentil" },
  { key: "clasificacion", label: "Clasificación" },
]);

/**
 * `contentSections.pruebas`, limpio. Cada prueba: qué es, qué salió y qué
 * significa. Las filas vacías de la tabla no se guardan; una prueba sin nombre
 * tampoco.
 */
export function normalizarPruebas(bruto) {
  if (!Array.isArray(bruto)) return [];
  const salida = [];
  for (const crudo of bruto) {
    if (!crudo || typeof crudo !== "object") continue;
    const nombre = texto(crudo.nombre).slice(0, MAX_NOMBRE);
    if (!nombre) continue;
    const filas = (Array.isArray(crudo.resultados) ? crudo.resultados : [])
      .filter((f) => f && typeof f === "object")
      .map((f) => Object.fromEntries(COLUMNAS_PUNTUACION.map((c) => [c.key, texto(f[c.key]).slice(0, MAX_CELDA)])))
      .filter((f) => Object.values(f).some(Boolean))
      .slice(0, MAX_FILAS);
    salida.push({
      key: texto(crudo.key) || clavePrueba(nombre),
      nombre,
      area: texto(crudo.area).slice(0, 40),
      descripcion: texto(crudo.descripcion).slice(0, MAX_TEXTO),
      resultados: filas,
      interpretacion: texto(crudo.interpretacion).slice(0, MAX_TEXTO),
    });
    if (salida.length >= MAX_PRUEBAS_INFORME) break;
  }
  return salida;
}

/** ¿Hay algo que imprimir? (una prueba elegida ya lo es: dice que se pasó). */
export function hayPruebas(contentSections) {
  return normalizarPruebas(contentSections?.[CLAVE_PRUEBAS]).length > 0;
}

/**
 * Qué columnas de la tabla se imprimen: solo las que alguna fila rellena. Una
 * prueba sin percentiles no lleva la columna «Percentil» en blanco.
 */
export function columnasConDatos(filas) {
  return COLUMNAS_PUNTUACION.filter((c) => (filas ?? []).some((f) => texto(f?.[c.key])));
}
