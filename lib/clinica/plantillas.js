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
const CLAVES_RESERVADAS = new Set([
  CLAVE_APARTADOS,
  CLAVE_PLANTILLA,
  "sourceSessionIds",
  "referralSpecialty",
  "anexarRegistros",
  // Del informe de beca (lib/clinica/beca.js): su apartado propio.
  "methodology",
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
    salida.push({ key: unica, label, tipo: tipoValido(crudo.tipo) });
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
  return limpias.length ? limpias : [{ ...base, apartados: base.apartados.map((a) => ({ ...a })) }];
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
