/**
 * pulirInforme — la redacción asistida del informe clínico.
 *
 * (Fichero nuevo en /lib, regla #2: es lógica de redacción compartida por el
 * endpoint y su prueba, igual que `redactarInforme.js`, del que ES la segunda
 * mitad. Ahí se junta lo que dicen las sesiones; aquí se pule.)
 *
 * Lo que hace `redactarDesdeSesiones` es un VOLCADO: cada línea sale literal de
 * un registro de sesión, con su fecha delante. Se lee como un parte, no como un
 * informe, y la familia que lo recibe nota la diferencia. Esto coge ese volcado
 * y lo redacta.
 *
 * ── DE PARAFRASEAR A REDACTAR (Rodrigo, 04/09/2026) ────────────────────────
 * «La IA de los informes es muy básica, simple y poco técnica: solo reescribe
 * un poco lo que le envían. Tiene que completar más, diagnosticar y escribir
 * más párrafos.»
 *
 * El prompt de aquí decía literalmente «Tu trabajo es REDACTARLAS, no
 * ampliarlas» y «NO AÑADAS INFORMACIÓN: ni un dato, ni una causa, ni una
 * valoración». Con eso, lo mejor que podía salir era el mismo volcado con las
 * comas puestas. Dos cosas cambian, y las dos viven en `estiloClinico.js`
 * porque valen igual para los registros y las entrevistas:
 *
 *  1. **Se le pide elaboración clínica**, que no es lo mismo que añadir datos:
 *     nombrar los procesos implicados, explicar qué trabaja cada actividad,
 *     relacionar lo observado con lo que cuenta la familia, decir qué sugiere.
 *     Los DATOS siguen saliendo solo del volcado — y eso se comprueba, no se
 *     confía (`verificarSinInventar`, abajo, sigue igual de estricta).
 *
 *  2. **Se le piden los apartados que hasta hoy salían vacíos siempre**: los
 *     LOGROS —que `redactarDesdeSesiones` nunca rellena, porque una sesión
 *     suelta no dice «esto es un logro»—, las RECOMENDACIONES cuando no las
 *     hay y la PROPUESTA DE CONTINUIDAD. Son apartados de síntesis: se deducen
 *     del conjunto del informe, con las marcas de hipótesis.
 *
 * ── LAS DOS REGLAS DEL FICHERO DE AL LADO, AQUÍ EN CÓDIGO ───────────────────
 *
 * 1. NO PISA LO ESCRITO. Esta función **no guarda nada**: devuelve una
 *    PROPUESTA. Quien escribe sigue siendo la profesional, que la ve al lado de
 *    lo suyo y decide apartado por apartado. El MOTIVO DE INTERVENCIÓN sigue
 *    sin mandarse al modelo ni en un sentido ni en otro —no sale de las
 *    sesiones, lo escribe ella—, y la propuesta de continuidad solo se propone
 *    **si está vacía**: lo que ella haya escrito no se toca nunca.
 *
 * 2. NO INVENTA. Se le pide en el prompt, pero pedir no basta: un informe
 *    clínico acaba en manos de una familia y a veces de un juzgado, y ahí el
 *    "casi siempre hace caso" de un modelo no vale. Por eso la propuesta pasa
 *    después por `verificarSinInventar`, que la RECHAZA si aparece cualquier
 *    número, fecha o mes que no estuviera en el volcado. Es la clase de
 *    invención que más daño hace en un informe —una edad, un porcentaje, una
 *    sesión que no hubo— y la única que se puede comprobar sin opinar. Con la
 *    redacción larga es MÁS fácil que se cuele una cifra de paso ("las dos
 *    últimas sesiones"), así que ahora se le da una segunda oportunidad
 *    diciéndole exactamente qué sobra; si insiste, se descarta igual.
 */

import { completeConParada } from "../outreach/analysis/anthropic.js";
import { leerRespuesta } from "./registroCompleto.js";
import { estiloClinico, lineaDePaciente } from "./estiloClinico.js";

/** Los apartados que salen del volcado de sesiones y, por tanto, se pulen. */
export const SECCIONES_PULIBLES = [
  "objectives",
  "evolution",
  "achievements",
  "persistentDifficulties",
  "recommendations",
];

/**
 * Los apartados que se ELABORAN a partir del resto del informe, y que por eso
 * se pueden proponer aunque estén vacíos.
 *
 * `achievements` y `recommendations` también están arriba: si traen algo se
 * redactan como los demás, y si no, se deducen. `continuityProposal` no se
 * pule nunca —no hay nada volcado en ella— pero sí se propone cuando está en
 * blanco, que es como llega el 100 % de los informes recién volcados.
 *
 * El motivo de intervención NO está aquí a propósito: es un dato (por qué
 * consultó la familia), no una síntesis, y de las sesiones no se deduce.
 */
export const SECCIONES_SINTESIS = ["achievements", "recommendations", "continuityProposal"];

/** Cómo se llama cada uno para el modelo (y para los avisos de pantalla). */
export const NOMBRES = {
  objectives: "Objetivos de trabajo",
  evolution: "Evolución",
  achievements: "Logros",
  persistentDifficulties: "Dificultades que persisten",
  recommendations: "Recomendaciones",
  continuityProposal: "Propuesta de continuidad",
};

/** Qué se espera dentro de cada apartado, para que no salgan los cinco iguales. */
const QUE_VA_EN = {
  objectives: "etiquetas breves de lo que se trabaja (2-6 palabras). Déjalos breves: no son frases.",
  evolution:
    "el cuerpo del informe. Agrupa las sesiones por lo que tienen en común —o por su orden en el tiempo— y escribe párrafos seguidos que cuenten qué se ha trabajado, con qué tipo de tarea, cómo ha respondido y qué cambia respecto al principio. Nombra los procesos implicados y di qué sugiere lo observado.",
  achievements:
    "lo que el paciente ha conseguido, deducido de la evolución: avances concretos y observables, cada uno en una frase que diga en qué se nota.",
  persistentDifficulties:
    "lo que sigue costando, descrito en términos de proceso (qué falla y en qué situaciones), no como una lista de quejas.",
  recommendations:
    "qué conviene hacer, para quién y para qué: pautas para casa, para el aula y líneas de trabajo en sesión. Cada una tiene que decir qué se busca con ella.",
  continuityProposal:
    "si procede seguir, con qué foco y por qué, en dos o tres frases. Sin frecuencias, duraciones ni fechas que no estén en el material.",
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Holgado por lo mismo que en el registro (`structureSession.js`): la salida ya
 * no son cinco listas de frases cortas sino un informe redactado, y con 4.000
 * se cortaba a la mitad del apartado más largo. Los tokens de salida se pagan
 * por lo que se usa, no por el tope.
 */
const MAX_TOKENS = 12_000;

/**
 * El SYSTEM. Lo genérico —quién escribe, qué puede añadir y qué no, cómo se
 * marca una interpretación, cuánto se escribe— sale de `estiloClinico.js`, que
 * es lo mismo que leen la IA del registro y la de la entrevista. Aquí solo va
 * lo que es del informe: que lo que recibe son anotaciones volcadas, que no se
 * puede perder nada de lo que llega y la forma exacta de la respuesta.
 */
function systemDelInforme({ contexto, hayQueProponer }) {
  return [
    estiloClinico({ sintesis: hayQueProponer, contexto }),
    `LO QUE RECIBES: las ANOTACIONES DE SESIÓN de este paciente, volcadas literalmente y apartado por apartado — frases sueltas, telegráficas, muchas con la fecha delante ("14 de marzo: …"). Son las notas que la profesional escribió sesión a sesión. Con ellas tienes que redactar el informe de seguimiento que va a leer la familia.`,
    `REGLAS PROPIAS DE ESTE DOCUMENTO:
1. NO PIERDAS NADA. Todo hecho que llegue en las anotaciones tiene que seguir estando en el informe. Puedes juntar, reordenar y agrupar; descartar, no.
2. CONSERVA LAS FECHAS que traigan las anotaciones y su orden cronológico. No añadas ninguna otra.
3. Lo que una anotación atribuye a la familia ("la familia refiere…") sigue atribuido a la familia. No lo conviertas en observación de la profesional.
4. El informe lo lee una familia: técnico sí, pero explicado. Un término del oficio se usa y, si hace falta, se aclara en la misma frase.`,
    `FORMA EXACTA DE LA RESPUESTA: SOLO un JSON válido (sin markdown, sin texto alrededor), con una clave por apartado y, en cada una, una lista de frases o párrafos en español:
{ "evolution": ["…", "…"], "achievements": ["…"] }
Cada elemento de la lista es un párrafo o una frase completa; no metas viñetas ni guiones dentro del texto.`,
  ].join("\n\n");
}

const comoLista = (v) =>
  (Array.isArray(v) ? v : v == null || v === "" ? [] : [v])
    .map((x) => (x == null ? "" : String(x).trim()))
    .filter(Boolean);

/** El texto de un apartado, todo junto, para comparar y para el prompt. */
const juntar = (lista) => comoLista(lista).join("\n");

/** Cifras del texto: "14", "2026", "3,5". Es lo que no puede aparecer de nuevo. */
function cifras(texto) {
  return new Set(String(texto).match(/\d+(?:[.,]\d+)?/g) ?? []);
}

/**
 * Meses nombrados en el texto (las fechas del volcado van así).
 *
 * Por PALABRA ENTERA, y no por `includes`, desde el 04/09/2026: "mayor" tiene
 * dentro "mayo". Con el volcado telegráfico de antes casi no pasaba, pero en
 * cuanto la IA redacta de verdad —"con mayor autonomía", "mayor tolerancia a la
 * frustración"— aparece en cualquier informe, y el borrador entero se
 * descartaba por una fecha inventada que no existía.
 */
function meses(texto) {
  const t = String(texto).toLowerCase();
  return new Set(MESES.filter((m) => new RegExp(`\\b${m}\\b`).test(t)));
}

/**
 * ¿La propuesta se ha inventado algo comprobable?
 *
 * Comprueba lo que se puede comprobar sin opinar: que no aparezca ningún número
 * ni ningún mes que no estuviera ya. No pretende detectar toda invención
 * posible —eso no lo sabe hacer una función— pero sí la que más daño hace y la
 * que un modelo produce sin querer al "redondear" una frase.
 *
 * Un apartado que venía VACÍO (los de síntesis: logros, propuesta de
 * continuidad) se compara contra el volcado ENTERO y no contra su propia
 * casilla, que está en blanco: se elabora leyendo todo lo demás, así que puede
 * repetir una fecha de la evolución sin estar inventándola.
 *
 * Devuelve { ok, motivos: string[] } por apartado, con el detalle de qué apareció.
 */
export function verificarSinInventar(original, propuesta) {
  const motivos = [];
  const todo = juntar(
    [...SECCIONES_PULIBLES, ...SECCIONES_SINTESIS].map((k) => juntar(original?.[k])).filter(Boolean)
  );
  const claves = new Set([...SECCIONES_PULIBLES, ...SECCIONES_SINTESIS]);

  for (const clave of claves) {
    const despues = juntar(propuesta?.[clave]);
    if (!despues) continue;
    const propio = juntar(original?.[clave]);
    const antes = propio || todo;

    const cifrasAntes = cifras(antes);
    for (const c of cifras(despues)) {
      if (!cifrasAntes.has(c)) motivos.push(`${NOMBRES[clave]}: aparece un número que no estaba ("${c}")`);
    }
    const mesesAntes = meses(antes);
    for (const m of meses(despues)) {
      if (!mesesAntes.has(m)) motivos.push(`${NOMBRES[clave]}: aparece una fecha que no estaba ("${m}")`);
    }
  }
  return { ok: motivos.length === 0, motivos };
}

/**
 * Apartados que han encogido mucho. No invalida la propuesta —unir dos
 * anotaciones acorta de forma legítima— pero se le dice a la profesional para
 * que mire ESE apartado con lupa antes de aceptarlo.
 */
export function avisosDePerdida(original, propuesta) {
  const avisos = [];
  for (const clave of SECCIONES_PULIBLES) {
    const antes = juntar(original?.[clave]).length;
    const despues = juntar(propuesta?.[clave]).length;
    if (antes === 0) continue;
    if (despues === 0) {
      avisos.push(`${NOMBRES[clave]}: la propuesta lo deja vacío.`);
    } else if (despues < antes * 0.5) {
      avisos.push(`${NOMBRES[clave]}: la propuesta ocupa menos de la mitad. Comprueba que no se ha perdido nada.`);
    }
  }
  return avisos;
}

/** Solo los apartados con algo dentro: no se le manda al modelo lo vacío. */
export function loQueHayQuePulir(contentSections) {
  const entrada = {};
  for (const clave of SECCIONES_PULIBLES) {
    const lista = comoLista(contentSections?.[clave]);
    if (lista.length) entrada[clave] = lista;
  }
  return entrada;
}

/**
 * Los apartados de síntesis que están VACÍOS: los que se van a proponer.
 *
 * Vacíos y solo vacíos. Lo que la profesional haya escrito en «Logros» o en la
 * propuesta de continuidad no se le manda al modelo ni se toca — misma regla
 * que el motivo de intervención, que no entra aquí de ninguna manera.
 */
export function loQueSePuedeProponer(contentSections) {
  return SECCIONES_SINTESIS.filter((clave) => comoLista(contentSections?.[clave]).length === 0);
}

/** El mensaje de usuario: el volcado y, detrás, lo que hay que elaborar. */
function mensajeDelInforme(entrada, aProponer) {
  const partes = [
    `ANOTACIONES VOLCADAS DE LAS SESIONES:\n\n${Object.entries(entrada)
      .map(([clave, lista]) => `## ${NOMBRES[clave]} (clave "${clave}")\n${lista.map((l) => `- ${l}`).join("\n")}`)
      .join("\n\n")}`,
    `QUÉ ESCRIBIR EN CADA APARTADO:\n${Object.keys(entrada)
      .map((clave) => `- "${clave}" · ${NOMBRES[clave]}: ${QUE_VA_EN[clave]}`)
      .join("\n")}`,
  ];
  if (aProponer.length) {
    partes.push(
      `APARTADOS QUE ESTÁN VACÍOS Y HAY QUE ELABORAR [SÍNTESIS] a partir de todo lo anterior:\n${aProponer
        .map((clave) => `- "${clave}" · ${NOMBRES[clave]}: ${QUE_VA_EN[clave]}`)
        .join(
          "\n"
        )}\nSi de las anotaciones no se sostiene alguno, devuélvelo vacío ([]): es preferible a rellenarlo con algo que valdría para cualquier paciente.`
    );
  }
  partes.push(
    `Devuelve el JSON con estas claves y ninguna más: ${[...Object.keys(entrada), ...aProponer]
      .map((c) => `"${c}"`)
      .join(", ")}.`
  );
  return partes.join("\n\n");
}

/** Una llamada al modelo → la propuesta ya recortada a lo que se pidió. */
async function pedirPropuesta({ system, user, model, apiKey, claves }) {
  const { texto: raw, parada } = await completeConParada({
    system,
    user,
    model,
    maxTokens: MAX_TOKENS,
    apiKey,
    // Por streaming, por lo mismo que el registro entero y la IA de Proyectos
    // (ver `anthropic.js`): con 12.000 tokens de tope, una petición muda puede
    // pasarse de los 120 s de timeout y morir en un error interno.
    stream: true,
  });

  // El mismo parseo defensivo del registro: rescata lo que venga envuelto en
  // texto o cortado a media frase, en vez de tirar la respuesta entera.
  const { objeto, incidencia } = leerRespuesta(raw);
  const propuesta = {};
  for (const clave of claves) {
    const lista = comoLista(objeto?.[clave]);
    if (lista.length) propuesta[clave] = lista;
  }
  return { propuesta, incidencia: parada === "max_tokens" ? "cortada" : incidencia };
}

/**
 * Pide la propuesta a Claude y la devuelve verificada.
 *
 * @param {object}  args
 * @param {object}  args.contentSections  El informe tal como está guardado.
 * @param {object}  [args.paciente]       Para ajustar edad y áreas (sin nombre).
 * @param {string}  args.apiKey
 * @param {string}  [args.model]
 * @returns {Promise<{ propuesta: object, avisos: string[] }>}
 * @throws  Error con `code = "IA_INVENTA"` si la propuesta no pasa la
 *          verificación ni siquiera después de pedirle que quite lo que sobra.
 *          Es un fallo, no un aviso: no se le puede enseñar a una profesional un
 *          borrador con datos inventados y confiar en que los vea.
 */
export async function pulirInforme({ contentSections, paciente = null, apiKey, model }) {
  const entrada = loQueHayQuePulir(contentSections);
  if (Object.keys(entrada).length === 0) {
    const err = new Error("No hay nada que pulir: vuelca antes las sesiones al informe");
    err.code = "SIN_CONTENIDO";
    throw err;
  }

  const aProponer = loQueSePuedeProponer(contentSections);
  const claves = [...Object.keys(entrada), ...aProponer];
  const system = systemDelInforme({
    contexto: lineaDePaciente(paciente),
    hayQueProponer: aProponer.length > 0,
  });
  const user = mensajeDelInforme(entrada, aProponer);

  let { propuesta, incidencia } = await pedirPropuesta({ system, user, model, apiKey, claves });

  if (Object.keys(propuesta).length === 0) {
    const err = new Error("La IA no ha devuelto ningún apartado. Vuelve a intentarlo.");
    err.code = "IA_ILEGIBLE";
    throw err;
  }

  let veredicto = verificarSinInventar(entrada, propuesta);
  if (!veredicto.ok) {
    // Segunda y última oportunidad, diciéndole qué sobra. Casi siempre es una
    // cifra de paso ("las dos últimas sesiones") en un texto por lo demás
    // correcto, y descartar el informe entero por eso era desperdiciar una
    // llamada ya pagada y dejar a la profesional sin nada.
    console.warn("[clinica:pulir] reintento por datos inventados", veredicto.motivos);
    const reintento = await pedirPropuesta({
      system,
      user: `${user}\n\nTu respuesta anterior se ha descartado porque añadía datos que no están en las anotaciones:\n${veredicto.motivos
        .map((m) => `- ${m}`)
        .join(
          "\n"
        )}\n\nVuelve a escribirla entera sin esas cifras ni esas fechas. No las sustituyas por otras ni por aproximaciones: reformula la frase para que no haga falta ninguna.`,
      model,
      apiKey,
      claves,
    });
    if (Object.keys(reintento.propuesta).length) {
      propuesta = reintento.propuesta;
      incidencia = reintento.incidencia;
      veredicto = verificarSinInventar(entrada, propuesta);
    }
  }

  if (!veredicto.ok) {
    const err = new Error(
      `El borrador se ha descartado porque añadía datos que no estaban en las sesiones: ${veredicto.motivos.join("; ")}.`
    );
    err.code = "IA_INVENTA";
    throw err;
  }

  const avisos = avisosDePerdida(entrada, propuesta);
  if (incidencia === "cortada") {
    avisos.push("La redacción se ha quedado sin sitio antes de terminar: revisa si falta algún apartado y vuelve a pedirla si falta.");
  }
  return { propuesta, avisos };
}

/**
 * ── MODO DEMO (simulado) ────────────────────────────────────────────────────
 * La demo pública da sesión de admin a cualquiera, así que no dispara IA de
 * pago (mismo criterio que el resto del CRM, `demoForcesFakeAi`). Esto enseña
 * el mismo flujo sin llamar a nadie: junta las anotaciones de cada apartado en
 * frases y quita la repetición del "fecha: " delante de cada línea, que es
 * justo lo que más canta del volcado. Determinista y sin inventar nada —pasa la
 * misma verificación que la de verdad—.
 *
 * De los apartados de síntesis solo simula los LOGROS, y a partir de la
 * evolución: es lo que hace visible en la demo que la IA completa lo que no
 * estaba volcado. La propuesta de continuidad no se simula — cualquier frase
 * que se escribiera aquí sería justo la clase de relleno que el prompt de
 * verdad prohíbe.
 */
export function fakePulirInforme({ contentSections }) {
  const entrada = loQueHayQuePulir(contentSections);
  const propuesta = {};
  for (const [clave, lista] of Object.entries(entrada)) {
    if (clave === "objectives") {
      propuesta[clave] = lista; // ya son etiquetas breves
      continue;
    }
    // Une las líneas de dos en dos enlazándolas, que es el efecto visible de
    // redactar un volcado: menos líneas y más frase.
    const salida = [];
    for (let i = 0; i < lista.length; i += 2) {
      const a = lista[i];
      const b = lista[i + 1];
      salida.push(b ? `${a.replace(/[.;]\s*$/, "")}; asimismo, ${b.charAt(0).toLowerCase()}${b.slice(1)}` : a);
    }
    propuesta[clave] = salida;
  }
  if (loQueSePuedeProponer(contentSections).includes("achievements") && entrada.evolution?.length) {
    propuesta.achievements = [
      `Se observan avances en lo trabajado durante el periodo: ${entrada.evolution[entrada.evolution.length - 1]
        .replace(/^[^:]{0,30}:\s*/, "")
        .replace(/[.;]\s*$/, "")}.`,
    ];
  }
  return { propuesta, avisos: avisosDePerdida(entrada, propuesta) };
}
