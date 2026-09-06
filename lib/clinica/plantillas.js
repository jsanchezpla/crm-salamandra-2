/**
 * lib/clinica/plantillas.js — un documento clínico es una lista de apartados
 * (título + cuerpo), y esa lista deja de estar clavada en el código.
 *
 * (Fichero nuevo en /lib, regla #2: la MISMA lista la necesitan cuatro sitios
 * —el informe (`apartadosInforme.js`), el cajón donde se redacta, el PDF del
 * registro de sesión y el formulario de la sesión—. Con una copia en cada uno,
 * la primera que alguien tocara dejaría a las otras tres enseñando otra cosa.)
 *
 * ── EL ENCARGO (Rodrigo, 28/08/2026) ───────────────────────────────────────
 * «Q un informe sean un montón de título-cuerpo seguidos y eso se transfiera al
 * pdf. Estaría bien que pudieran crear plantillas de informes ellas con los
 * títulos que quieran». Y el 29/08: lo mismo para los REGISTROS DE SESIÓN, que
 * además tienen que poder salir en PDF; más la posibilidad de añadir un
 * apartado suelto a un documento concreto SIN guardarlo en ninguna plantilla.
 *
 * ── LAS TRES PIEZAS, Y POR QUÉ SON TRES ────────────────────────────────────
 *
 *  1. **El apartado**: `{ key, label, tipo }`. `label` es el título que se
 *     imprime; `tipo` dice si el cuerpo es un párrafo (`texto`) o una lista de
 *     viñetas (`lista`); `key` es DÓNDE se guarda lo escrito y **no se
 *     renombra nunca**: los informes ya firmados apuntan a la clave, igual que
 *     con las especialidades de derivación. Cambiar el título de un apartado
 *     cambia el rótulo, no el contenido.
 *
 *  2. **La plantilla**: `{ key, name, apartados[] }`, guardada por centro en
 *     `master.tenants.settings.clinica.plantillas` (mismo mecanismo que
 *     `referralSpecialties`, `performanceRoles` e `incentiveTiers`: JSONB en
 *     master, sin tabla nueva y sin migración). **La escribe el admin**, que
 *     es la respuesta a la pregunta que dejó abierta el Registro: los títulos
 *     de un informe clínico salen firmados por una colegiada, así que la
 *     plantilla es del CENTRO y la decide dirección — pero cualquiera puede
 *     añadir apartados a SU documento (punto 3).
 *
 *  3. **La foto**: cada documento guarda en su propio JSONB la lista de
 *     apartados con la que se escribió (`contentSections.apartados`). Eso es
 *     lo que hace que funcionen las dos cosas del encargo con UN solo
 *     mecanismo:
 *       · los apartados sueltos son apartados que están en la foto y en
 *         ninguna plantilla — se aplican aquí y no se guardan en ningún sitio
 *         más;
 *       · y un informe de hace un año se sigue imprimiendo con SUS títulos
 *         aunque el centro haya cambiado la plantilla entera después.
 *     Sin foto (los 22 informes que existen hoy, las 22.045 sesiones de
 *     Aumenta) se cae a la plantilla por defecto del centro y, si tampoco hay,
 *     a la de fábrica: los siete apartados de siempre. Nada cambia para nadie
 *     hasta que alguien toque una plantilla.
 *
 * El informe para la BECA no pasa por aquí (`lib/clinica/beca.js`): sus
 * apartados los manda la convocatoria, no el centro.
 */

import { PLANTILLA_DIAGNOSTICO, CLAVE_PRUEBAS, normalizarPruebas } from "./pruebasDiagnosticas.js";

/** Un apartado es un párrafo o una lista de viñetas. No hay más. */
export const TIPOS_APARTADO = ["texto", "lista"];
export const TIPO_POR_DEFECTO = "texto";

/**
 * Los documentos que se componen por apartados.
 *
 * `acta` entra el 01/09/2026 (Rodrigo: «implantar una plantilla para actas de
 * reunión para que las haga directamente el CRM a través de un audio o unas
 * notas que le suba, como los registros de sesión»). Es el primero que NO es
 * clínico —no tiene paciente ni firma colegiada—, y aun así vive aquí a
 * propósito: lo que se pidió es exactamente lo que este fichero ya sabe hacer
 * —una lista de apartados que el centro decide, una foto guardada con cada
 * documento y un reparto por claves que no se renombran—. Duplicarlo en
 * `lib/reuniones/` habría sido tener dos editores de plantillas que se van
 * separando solos.
 */
export const DOCUMENTOS = ["informe", "registro", "acta"];

/**
 * Los siete apartados del informe clínico, que hasta hoy vivían escritos en
 * `apartadosInforme.js` (SECCIONES) y, con otros rótulos, en los siete textarea
 * del cajón. Las CLAVES son las de siempre: los informes guardados apuntan a
 * ellas, y `apartadosInforme.js` sigue exportando esta misma lista como
 * respaldo con la forma `{ lista: bool }` que pide el generador del PDF.
 *
 * Los rótulos que se quedan son los del PDF, no los del cajón («Objetivos» y
 * no «Objetivos terapéuticos»): ahora el título del formulario ES el título que
 * se imprime, que es justo lo que se pedía.
 */
export const APARTADOS_INFORME_BASE = Object.freeze([
  { key: "motiveOfIntervention", label: "Motivo de intervención", tipo: "texto" },
  { key: "objectives", label: "Objetivos", tipo: "lista" },
  { key: "evolution", label: "Evolución", tipo: "lista" },
  { key: "achievements", label: "Logros", tipo: "lista" },
  { key: "persistentDifficulties", label: "Dificultades que persisten", tipo: "lista" },
  { key: "recommendations", label: "Recomendaciones", tipo: "lista" },
  { key: "continuityProposal", label: "Propuesta de continuidad", tipo: "texto" },
]);

/**
 * Los apartados del REGISTRO DE SESIÓN: la parte 2 del registro en tres partes
 * (sprint Aumenta 2026-07). Son exactamente los campos que ya se rellenaban a
 * mano y los mismos que imprime el anexo del informe, en su orden.
 *
 * Fuera quedan a propósito la parte 1 (preparación) y la parte 3 (devolución de
 * la familia), que no son apartados del informe de la sesión sino el envoltorio
 * del registro; y desde luego las notas internas, que no salen del CRM.
 */
export const APARTADOS_REGISTRO_BASE = Object.freeze([
  { key: "objectives", label: "Objetivos trabajados", tipo: "lista" },
  { key: "activities", label: "Actividades realizadas", tipo: "texto" },
  { key: "performance", label: "Desempeño", tipo: "texto" },
  { key: "familyComments", label: "Comentarios familiares", tipo: "texto" },
  { key: "nextSessionNotes", label: "Próximas sesiones", tipo: "texto" },
  { key: "homeworkTasks", label: "Tareas para casa", tipo: "texto" },
  { key: "incidents", label: "Incidencias", tipo: "texto" },
]);

/**
 * Los apartados del ACTA DE UNA REUNIÓN DE EQUIPO (01/09/2026, Aumenta por
 * Rodrigo). Son los de un acta de toda la vida, en el orden en que se dictan:
 * quién vino, qué se habló, qué se decidió, quién hace qué y cuándo se vuelve.
 *
 * «Acuerdos» y «Tareas» van como LISTA y no como párrafo a propósito: son lo
 * único del acta que alguien va a releer la semana siguiente para ver si se
 * hizo, y una lista se repasa de un vistazo. Y «Asistentes» va el primero
 * porque es lo que convierte el acta en un documento con valor: quién estaba.
 */
export const APARTADOS_ACTA_BASE = Object.freeze([
  { key: "asistentes", label: "Asistentes", tipo: "lista" },
  { key: "temas", label: "Temas tratados", tipo: "texto" },
  { key: "acuerdos", label: "Acuerdos", tipo: "lista" },
  { key: "tareas", label: "Tareas y responsables", tipo: "lista" },
  { key: "proximaReunion", label: "Próxima reunión", tipo: "texto" },
]);

/** La plantilla de fábrica de cada documento: lo que hay cuando no hay nada. */
export const PLANTILLA_BASE = Object.freeze({
  informe: Object.freeze({ key: "base", name: "Informe clínico", apartados: APARTADOS_INFORME_BASE }),
  registro: Object.freeze({ key: "base", name: "Registro de sesión", apartados: APARTADOS_REGISTRO_BASE }),
  acta: Object.freeze({ key: "base", name: "Acta de reunión", apartados: APARTADOS_ACTA_BASE }),
});

/**
 * LA ENTREVISTA INICIAL (02/09/2026, AV-0017 de Aumenta; Rodrigo: «la
 * entrevista inicial va a ser un tipo especial de cita» y su registro tiene
 * estos campos, y se rellena desde el bloc de notas o el audio con IA como el
 * resto).
 *
 * Son los 15 apartados de la entrevista del centro, en su orden. Cada uno
 * lleva su PISTA: los subpuntos de la entrevista («¿Desde cuándo ocurre?»,
 * «Embarazo y parto», «PT / AL / Orientación»…). La pista se enseña bajo el
 * título en el formulario y viaja en el prompt de la IA, que es como una
 * transcripción de una hora se reparte por 15 apartados sin inventar nada.
 * No es un apartado por subpunto a propósito: 60 casillas no las rellena
 * nadie, y una entrevista se escribe por bloques.
 *
 * Es una plantilla de REGISTRO más, con clave fija, que se ofrece en todos
 * los centros con clínica (`plantillasDe`) detrás de las suyas; si un centro
 * guarda la suya con la misma clave, manda la suya. La cita marcada como
 * «valoración inicial» (`EventType.isInitialAssessment`) la elige sola al
 * preparar la sesión (lib/clinica/prepararSesion.js).
 */
export const APARTADOS_ENTREVISTA_BASE = Object.freeze([
  { key: "identificacion", label: "1. Datos de identificación", tipo: "texto", pista: "Nombre y apellidos · Fecha de nacimiento · Edad · Fecha de la entrevista · Profesional que realiza la entrevista" },
  { key: "motivoConsulta", label: "2. Motivo de consulta", tipo: "texto", pista: "¿Cuál es el motivo principal de la consulta? · ¿Desde cuándo ocurre? · ¿Qué esperan conseguir con la intervención?" },
  { key: "antecedentesPersonales", label: "3. Antecedentes personales", tipo: "texto", pista: "Embarazo y parto (embarazo, parto, semanas de gestación, complicaciones) · Desarrollo (motor, lenguaje, control de esfínteres, alimentación, sueño) · Salud (diagnósticos médicos, enfermedades relevantes, intervenciones quirúrgicas, alergias, medicación, pruebas realizadas, especialistas que lo siguen)" },
  { key: "antecedentesFamiliares", label: "4. Antecedentes familiares", tipo: "texto", pista: "Composición familiar · Profesión de los padres/cuidadores · Hermanos · Antecedentes familiares relevantes · Situaciones familiares importantes (separaciones, fallecimientos, acogimiento…)" },
  { key: "funcionamientoActual", label: "5. Funcionamiento actual", tipo: "texto", pista: "Comunicación y lenguaje (comprensión, expresión, conversación, pronunciación) · Área cognitiva (atención, memoria, aprendizaje, organización, funciones ejecutivas) · Área emocional (estado de ánimo, ansiedad, autoestima, regulación emocional, frustración) · Conducta (normas, impulsividad, rabietas, agresividad, conductas repetitivas, oposición) · Área social (relación con iguales y con adultos, juego, intereses) · Autonomía (aseo, vestido, alimentación, organización, desplazamientos, dinero en adultos) · Área motora y sensorial (coordinación, motricidad fina y gruesa, equilibrio, sensibilidad sensorial)" },
  { key: "escolarLaboral", label: "6. Escolar / laboral", tipo: "texto", pista: "En niños: centro educativo, curso, rendimiento, adaptaciones, PT, AL, orientación, repeticiones, apoyos externos · En adultos: estudios, profesión, situación laboral, dificultades laborales" },
  { key: "intervencionesPrevias", label: "7. Intervenciones previas", tipo: "texto", pista: "¿Ha recibido tratamiento anteriormente? · ¿Qué profesionales? · Duración · Resultados" },
  { key: "fortalezas", label: "8. Fortalezas", tipo: "texto", pista: "¿Qué hace especialmente bien? · Intereses · Motivaciones · Capacidades" },
  { key: "dificultadesPrincipales", label: "9. Dificultades principales", tipo: "texto", pista: "Espacio libre." },
  { key: "expectativas", label: "10. Expectativas", tipo: "texto", pista: "¿Qué espera la familia o el paciente del centro?" },
  { key: "observacionClinica", label: "11. Observación clínica", tipo: "texto", pista: "Primeras impresiones del profesional." },
  { key: "impresionClinica", label: "12. Impresión clínica inicial", tipo: "texto", pista: "Hipótesis inicial · Necesidad de evaluación · Necesidad de derivación" },
  { key: "propuestaActuacion", label: "13. Propuesta de actuación", tipo: "texto", pista: "Servicio/s recomendados · Frecuencia · Necesidad de valoración · Pruebas sugeridas" },
  { key: "acuerdosIntervencion", label: "14. Acuerdos de intervención", tipo: "lista", pista: "Objetivos iniciales · Organización de las sesiones · Compromisos del centro · Compromisos de la familia/paciente" },
  { key: "documentacionAportada", label: "15. Documentación aportada", tipo: "lista", pista: "Informes médicos · Informes escolares · Informes psicológicos · Valoraciones previas · Analíticas · Otros" },
]);

export const PLANTILLA_ENTREVISTA = Object.freeze({
  key: "entrevista_inicial",
  name: "Entrevista inicial",
  apartados: APARTADOS_ENTREVISTA_BASE,
});

/**
 * Los apartados del REGISTRO DE UN TALLER (03/09/2026, Aumenta por Rodrigo):
 * «Info general para todos los pacientes de ese grupo: objetivos, actividades,
 * desempeño, comentarios familiares, preparación previa, devolución a la
 * familia.» Es el registro común de la tarde, el que se copia igual a todos
 * los que vinieron; la observación de cada niño va aparte y no es un apartado
 * de esta lista (`lib/clinica/tallerSesion.js`).
 *
 * Las cuatro primeras claves son las del registro de sesión de siempre a
 * propósito: así, en la ficha de cada paciente, caen en sus columnas de toda
 * la vida y el informe evolutivo y las estadísticas las leen sin más. Las dos
 * últimas son propias del taller y viven en el JSONB del registro.
 */
export const APARTADOS_TALLER_BASE = Object.freeze([
  { key: "objectives", label: "Objetivos", tipo: "lista" },
  { key: "activities", label: "Actividades", tipo: "texto" },
  { key: "performance", label: "Desempeño", tipo: "texto" },
  { key: "familyComments", label: "Comentarios familiares", tipo: "texto" },
  { key: "preparacionPrevia", label: "Preparación previa", tipo: "texto" },
  { key: "devolucionFamilia", label: "Devolución a la familia", tipo: "texto" },
]);

export const PLANTILLA_TALLER = Object.freeze({
  key: "taller",
  name: "Registro de taller",
  apartados: APARTADOS_TALLER_BASE,
});

/**
 * Plantillas de fábrica que se OFRECEN además de la base (y además de las del
 * centro): salen detrás de las suyas y el centro puede sustituirlas guardando
 * una con la misma clave. Hoy, la entrevista inicial y el registro de taller,
 * para el registro.
 */
export const PLANTILLAS_EXTRA = Object.freeze({
  registro: Object.freeze([PLANTILLA_ENTREVISTA, PLANTILLA_TALLER]),
  // La valoración diagnóstica (05/09/2026, AV-0045 de Aumenta): sus 25
  // apartados viven en `pruebasDiagnosticas.js` con el catálogo de pruebas.
  informe: Object.freeze([PLANTILLA_DIAGNOSTICO]),
});

/** La pista de un apartado no es un texto libre sin tope: 1.000 caben los subpuntos más largos (el de «Funcionamiento actual» pasa de 600). */
const MAX_PISTA = 1000;

/** Dónde vive la foto de apartados dentro del JSONB de un documento. */
export const CLAVE_APARTADOS = "apartados";
/** Y de qué plantilla salió (informativo: manda la foto, no esto). */
export const CLAVE_PLANTILLA = "plantilla";

// Topes. No son de seguridad, son de sentido común: un informe de 60 apartados
// no lo lee nadie, y esto acaba en un JSONB de master.
export const MAX_APARTADOS = 30;
export const MAX_PLANTILLAS = 20;
const MAX_LABEL = 120;
const MAX_NOMBRE = 80;

// Las claves de fábrica son camelCase (`motiveOfIntervention`); las nuevas
// salen del slug de su título (`entorno_familiar`). Las dos formas caben aquí.
const CLAVE_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

// Claves que NO puede pedir un apartado nuevo: son campos con significado
// propio dentro de `contentSections` y machacarlos rompería el documento.
export const CLAVES_RESERVADAS = new Set([
  CLAVE_APARTADOS,
  CLAVE_PLANTILLA,
  "sourceSessionIds",
  "referralSpecialty",
  "anexarRegistros",
  // Del informe de beca (lib/clinica/beca.js): su apartado propio.
  "methodology",
  // Las pruebas con puntuaciones del informe de diagnóstico (05/09/2026):
  // un apartado que se llamara «Pruebas» pisaría el bloque entero.
  CLAVE_PRUEBAS,
]);

const texto = (v) => (v == null ? "" : String(v).trim());

/** Clave estable a partir de un título: «Entorno familiar» → `entorno_familiar`. */
export function slugApartado(label) {
  const s = texto(label)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  // Una clave tiene que empezar por letra (y «123» slugea a «123»).
  return s && /^[a-z]/.test(s) ? s : s ? `ap_${s}` : "";
}

function tipoValido(v) {
  return TIPOS_APARTADO.includes(v) ? v : TIPO_POR_DEFECTO;
}

/**
 * Limpia una lista de apartados venida de fuera (un navegador, un JSONB viejo).
 * Devuelve siempre un array; tira lo que no se puede arreglar.
 *
 * `previos` sirve para CONSERVAR la clave cuando solo se ha reescrito el
 * título: si el centro renombra «Evolución» a «Evolución del curso», los
 * informes que ya tienen texto en `evolution` lo siguen enseñando. Misma regla
 * que el catálogo de derivaciones.
 */
export function normalizarApartados(bruto, { previos = [] } = {}) {
  if (!Array.isArray(bruto)) return [];
  const porEtiqueta = new Map();
  for (const p of Array.isArray(previos) ? previos : []) {
    if (p?.label && p?.key) porEtiqueta.set(texto(p.label).toLowerCase(), p.key);
  }
  const vistas = new Set();
  const salida = [];
  for (const crudo of bruto) {
    if (!crudo || typeof crudo !== "object") continue;
    const label = texto(crudo.label).slice(0, MAX_LABEL);
    if (!label) continue; // un apartado sin título no es un apartado
    const pedida = texto(crudo.key);
    let key = CLAVE_RE.test(pedida) && !CLAVES_RESERVADAS.has(pedida) ? pedida : "";
    if (!key) key = porEtiqueta.get(label.toLowerCase()) ?? "";
    if (!key) key = slugApartado(label);
    // Un apartado que se llame «Apartados» tiene un slug que ya significa otra
    // cosa. Se le pone prefijo en vez de tirarlo: quien lo escribió quiere ese
    // título, y perder el apartado en silencio es peor que darle otra clave.
    if (CLAVES_RESERVADAS.has(key)) key = `ap_${key}`.slice(0, 64);
    if (!key || !CLAVE_RE.test(key)) continue;
    // Dos apartados con el mismo título escribirían en el mismo sitio y el
    // segundo pisaría al primero: se desempata con un sufijo.
    let unica = key;
    let n = 2;
    while (vistas.has(unica)) unica = `${key}_${n++}`.slice(0, 64);
    vistas.add(unica);
    // La pista (los subpuntos de un apartado, 02/09/2026) viaja con el
    // apartado si la tiene; no se inventa ninguna donde no la hay.
    const pista = texto(crudo.pista).slice(0, MAX_PISTA);
    salida.push({ key: unica, label, tipo: tipoValido(crudo.tipo), ...(pista ? { pista } : {}) });
    if (salida.length >= MAX_APARTADOS) break;
  }
  return salida;
}

/** Limpia una plantilla entera. Devuelve null si no queda nada aprovechable. */
export function normalizarPlantilla(bruto, { previa = null } = {}) {
  if (!bruto || typeof bruto !== "object") return null;
  const name = texto(bruto.name).slice(0, MAX_NOMBRE);
  if (!name) return null;
  const apartados = normalizarApartados(bruto.apartados, { previos: previa?.apartados ?? [] });
  if (!apartados.length) return null; // una plantilla sin apartados no imprime nada
  const pedida = texto(bruto.key);
  const key = CLAVE_RE.test(pedida) ? pedida : previa?.key || slugApartado(name) || "plantilla";
  return { key, name, apartados };
}

/** Limpia la lista de plantillas de un centro para UN documento. */
export function normalizarPlantillas(bruto, { previas = [] } = {}) {
  if (!Array.isArray(bruto)) return [];
  const porKey = new Map((Array.isArray(previas) ? previas : []).map((p) => [p?.key, p]));
  const vistas = new Set();
  const salida = [];
  for (const crudo of bruto) {
    const limpia = normalizarPlantilla(crudo, { previa: porKey.get(texto(crudo?.key)) ?? null });
    if (!limpia) continue;
    let unica = limpia.key;
    let n = 2;
    while (vistas.has(unica)) unica = `${limpia.key}_${n++}`.slice(0, 64);
    vistas.add(unica);
    salida.push({ ...limpia, key: unica });
    if (salida.length >= MAX_PLANTILLAS) break;
  }
  return salida;
}

/**
 * Las plantillas EFECTIVAS de un centro para un documento. Sin nada guardado
 * (o con basura guardada) devuelve la de fábrica: un centro que no ha tocado
 * esto se comporta exactamente como antes de que existiera este fichero.
 */
export function plantillasDe(tenant, doc) {
  const base = PLANTILLA_BASE[doc];
  if (!base) return [];
  const guardadas = tenant?.settings?.clinica?.plantillas?.[doc];
  const limpias = normalizarPlantillas(guardadas);
  const lista = limpias.length ? limpias : [{ ...base, apartados: base.apartados.map((a) => ({ ...a })) }];
  // Las de fábrica que se ofrecen además (la entrevista inicial): detrás de
  // las del centro, salvo que el centro haya guardado la suya con esa clave o
  // la haya BORRADO desde Configuración (`plantillasOcultas`, que escribe el
  // PUT de plantillas cuando se guarda una lista sin ella — revisión
  // 02/09/2026: sin ese rastro, borrarla no servía de nada porque volvía a
  // aparecer en la siguiente lectura).
  const ocultas = new Set(plantillasOcultasDe(tenant, doc));
  for (const extra of PLANTILLAS_EXTRA[doc] ?? []) {
    if (!ocultas.has(extra.key) && !lista.some((p) => p.key === extra.key)) {
      lista.push({ ...extra, apartados: extra.apartados.map((a) => ({ ...a })) });
    }
  }
  return lista;
}

/** Las plantillas de fábrica que el centro ha borrado a propósito para un documento. */
export function plantillasOcultasDe(tenant, doc) {
  const v = tenant?.settings?.clinica?.plantillasOcultas?.[doc];
  return Array.isArray(v) ? v.filter((k) => typeof k === "string") : [];
}

/**
 * Lo que hay que anotar como oculto al guardar la lista de un documento: las
 * de fábrica «extra» que NO vienen en lo guardado. Así, borrar la entrevista
 * desde Configuración se respeta, y volver a incluirla la desoculta.
 */
export function ocultasTrasGuardar(doc, plantillas) {
  const lista = Array.isArray(plantillas) ? plantillas : [];
  return (PLANTILLAS_EXTRA[doc] ?? []).filter((e) => !lista.some((p) => p?.key === e.key)).map((e) => e.key);
}

/** Una plantilla por su clave; sin clave (o desconocida), la primera. */
export function plantillaDe(tenant, doc, key) {
  const todas = plantillasDe(tenant, doc);
  if (!todas.length) return null;
  return todas.find((p) => p.key === key) ?? todas[0];
}

/**
 * La foto de apartados que guardó un documento, ya limpia. Vacío si no tiene
 * (todo lo escrito antes de esta función).
 */
export function apartadosGuardados(contentSections) {
  const cs = contentSections && typeof contentSections === "object" ? contentSections : {};
  return normalizarApartados(cs[CLAVE_APARTADOS]);
}

/**
 * LA función: con qué apartados se lee y se imprime este documento.
 *
 *   1º su propia foto (lo que se escribió, apartados sueltos incluidos),
 *   2º la plantilla que dice usar,
 *   3º la primera plantilla del centro,
 *   4º la de fábrica.
 */
export function apartadosPara(contentSections, tenant, doc) {
  return apartadosConPlantillas(contentSections, plantillasDe(tenant, doc));
}

/**
 * Lo mismo, pero con las plantillas ya resueltas. Es lo que usa el NAVEGADOR:
 * el formulario tiene el documento y la lista de plantillas que le dio
 * `/api/clinica/plantillas`, pero no tiene el tenant ni puede tenerlo. Así el
 * cajón y el PDF deciden los apartados con la misma función y no con dos que se
 * parecen.
 */
export function apartadosConPlantillas(contentSections, plantillas) {
  const foto = apartadosGuardados(contentSections);
  if (foto.length) return foto;
  const cs = contentSections && typeof contentSections === "object" ? contentSections : {};
  const todas = Array.isArray(plantillas) ? plantillas : [];
  const clave = texto(cs[CLAVE_PLANTILLA]);
  const plantilla = todas.find((p) => p?.key === clave) ?? todas[0] ?? null;
  return Array.isArray(plantilla?.apartados) ? plantilla.apartados.map((a) => ({ ...a })) : [];
}

/**
 * El JSONB de un documento, limpio: la foto de apartados normalizada y el resto
 * de claves tal cual. Lo llaman los endpoints antes de guardar, porque esto
 * viene de un navegador — sin esto, un `apartados` que fuera una cadena, o con
 * 400 entradas, se guardaría igual y luego el PDF tendría que apañárselas.
 */
export function limpiarContentSections(bruto) {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {};
  const salida = { ...bruto };
  if (CLAVE_APARTADOS in salida) salida[CLAVE_APARTADOS] = normalizarApartados(salida[CLAVE_APARTADOS]);
  if (CLAVE_PLANTILLA in salida) salida[CLAVE_PLANTILLA] = texto(salida[CLAVE_PLANTILLA]).slice(0, 64);
  // Las pruebas del informe de diagnóstico, con sus filas de puntuaciones
  // limpias y sin las vacías (05/09/2026).
  if (CLAVE_PRUEBAS in salida) salida[CLAVE_PRUEBAS] = normalizarPruebas(salida[CLAVE_PRUEBAS]);
  return salida;
}

/* ═══ Valores ══════════════════════════════════════════════════════════════ */

/** El cuerpo de un apartado, en la forma que pide su tipo. */
export function valorDeApartado(bolsa, apartado) {
  const v = bolsa?.[apartado.key];
  if (apartado.tipo === "lista") {
    if (Array.isArray(v)) return v.map(texto).filter(Boolean);
    return texto(v) ? [texto(v)] : [];
  }
  return Array.isArray(v) ? v.map(texto).filter(Boolean).join("\n\n") : texto(v);
}

/** ¿Hay algo escrito en este apartado? (los vacíos no se imprimen). */
export function tieneApartado(bolsa, apartado) {
  return valorDeApartado(bolsa, apartado).length > 0;
}

/**
 * Bolsa de valores → lo que se teclea: un textarea por apartado, y en los de
 * lista una línea por viñeta. Es la convención que ya usaba el cajón del
 * informe; aquí queda escrita UNA vez para que el registro de sesión no invente
 * otra.
 */
export function aFormulario(bolsa, apartados) {
  const form = {};
  for (const a of Array.isArray(apartados) ? apartados : []) {
    const v = valorDeApartado(bolsa, a);
    form[a.key] = Array.isArray(v) ? v.join("\n") : v;
  }
  return form;
}

/** Y de vuelta: lo tecleado toma la forma que pide cada apartado. */
export function desdeFormulario(form, apartados) {
  const bolsa = {};
  for (const a of Array.isArray(apartados) ? apartados : []) {
    const v = texto(form?.[a.key]);
    bolsa[a.key] = a.tipo === "lista" ? v.split("\n").map((x) => x.trim()).filter(Boolean) : v;
  }
  return bolsa;
}

/* ═══ Registro de sesión: dónde vive de verdad cada apartado ═══════════════ */

/**
 * Los apartados de fábrica del registro NO están en un JSONB: son columnas de
 * `clinic_sessions` desde el primer día, y de ellas comen el volcado a
 * informes, las estadísticas y el anexo. Así que se leen y se escriben donde
 * siempre; solo los apartados NUEVOS van al JSONB `contentSections`.
 *
 * Por eso las 22.045 sesiones de Aumenta siguen enteras sin tocar una fila.
 */
export const CAMPOS_SESION = Object.freeze({
  objectives: ["objectives"],
  activities: ["activities"],
  performance: ["performance"],
  familyComments: ["observations", "familyComments"],
  nextSessionNotes: ["observations", "nextSessionNotes"],
  homeworkTasks: ["observations", "homeworkTasks"],
  incidents: ["observations", "incidents"],
});

/** Fila de sesión → bolsa plana `{ clave: valor }` para leer sus apartados. */
export function valoresDeSesion(sesion) {
  const j = sesion?.toJSON ? sesion.toJSON() : sesion ?? {};
  const cs =
    j.contentSections && typeof j.contentSections === "object" && !Array.isArray(j.contentSections)
      ? j.contentSections
      : {};
  const obs =
    j.observations && typeof j.observations === "object" && !Array.isArray(j.observations) ? j.observations : {};
  const bolsa = { ...cs };
  delete bolsa[CLAVE_APARTADOS];
  delete bolsa[CLAVE_PLANTILLA];
  for (const [clave, ruta] of Object.entries(CAMPOS_SESION)) {
    bolsa[clave] = ruta.length === 1 ? j[ruta[0]] : obs[ruta[1]];
  }
  return bolsa;
}

/**
 * Al revés: la bolsa plana que trae el formulario se reparte entre las columnas
 * de siempre y el JSONB, y se guarda la foto de apartados con la que se
 * escribió. Devuelve el objeto listo para `create`/`update`.
 *
 * Lo que NO toca, a propósito: `prepText`, `prepFiles`, `parentFeedback` e
 * `internalNotes`. Las partes 1 y 3 del registro y las notas internas no son
 * apartados de plantilla y tienen su propio sitio en el formulario.
 */
export function repartirValoresDeSesion(bolsa, apartados) {
  const limpios = normalizarApartados(apartados);
  const v = bolsa && typeof bolsa === "object" ? bolsa : {};
  const observations = {};
  const contentSections = { [CLAVE_APARTADOS]: limpios };
  const salida = { observations, contentSections };

  for (const [clave, ruta] of Object.entries(CAMPOS_SESION)) {
    const apartado = limpios.find((a) => a.key === clave);
    // Un apartado de fábrica que la plantilla ya no usa conserva su columna
    // vacía, no un valor a medias de otro sitio.
    const valor = apartado ? valorDeApartado(v, apartado) : clave === "objectives" ? [] : "";
    if (ruta.length === 1) salida[ruta[0]] = valor;
    else observations[ruta[1]] = valor;
  }
  for (const a of limpios) {
    if (CAMPOS_SESION[a.key]) continue;
    contentSections[a.key] = valorDeApartado(v, a);
  }
  return salida;
}
