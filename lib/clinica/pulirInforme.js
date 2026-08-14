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
 * ── LAS DOS REGLAS DEL FICHERO DE AL LADO, AQUÍ EN CÓDIGO ───────────────────
 *
 * 1. NO PISA LO ESCRITO. Esta función **no guarda nada**: devuelve una
 *    PROPUESTA. Quien escribe sigue siendo la profesional, que la ve al lado de
 *    lo suyo y decide apartado por apartado. Y de los ocho apartados del
 *    informe solo se le pasan CINCO — los que salen del volcado—; el motivo de
 *    intervención y la propuesta de continuidad los escribe ella y no se le
 *    mandan siquiera al modelo, así que no hay forma de que se los reescriba.
 *
 * 2. NO INVENTA. Se le pide en el prompt, pero pedir no basta: un informe
 *    clínico acaba en manos de una familia y a veces de un juzgado, y ahí el
 *    "casi siempre hace caso" de un modelo no vale. Por eso la propuesta pasa
 *    después por `verificarSinInventar`, que la RECHAZA si aparece cualquier
 *    número, fecha o mes que no estuviera en el volcado. Es la clase de
 *    invención que más daño hace en un informe —una edad, un porcentaje, una
 *    sesión que no hubo— y la única que se puede comprobar sin opinar.
 */

import { complete } from "../outreach/analysis/anthropic.js";

/** Los apartados que salen del volcado de sesiones y, por tanto, se pulen. */
export const SECCIONES_PULIBLES = [
  "objectives",
  "evolution",
  "achievements",
  "persistentDifficulties",
  "recommendations",
];

/** Cómo se llama cada uno para el modelo (y para los avisos de pantalla). */
export const NOMBRES = {
  objectives: "Objetivos de trabajo",
  evolution: "Evolución",
  achievements: "Logros",
  persistentDifficulties: "Dificultades que persisten",
  recommendations: "Recomendaciones",
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const SYSTEM = `Eres la profesional de un centro de psicopedagogía infantil que redacta el informe de seguimiento que va a leer la familia de un paciente.

Recibes, apartado por apartado, ANOTACIONES DE SESIÓN volcadas literalmente: frases sueltas, telegráficas, muchas con la fecha delante ("14 de marzo: ..."). Tu trabajo es REDACTARLAS, no ampliarlas.

Devuelve SOLO un JSON válido (sin markdown, sin texto alrededor) con exactamente las mismas claves que recibas y, en cada una, una lista de frases en español:
{ "objectives": ["..."], "evolution": ["..."], ... }

REGLAS, POR ESTE ORDEN:
1. NO AÑADAS INFORMACIÓN. Ni un dato, ni una fecha, ni una edad, ni un número, ni un diagnóstico, ni una causa, ni una valoración que no esté en lo que recibes. Si un apartado viene con poco, se queda con poco: un informe corto es correcto, uno adornado es falso.
2. NO QUITES INFORMACIÓN. Todo hecho que llegue tiene que seguir estando. Puedes unir dos anotaciones de la misma fecha en una frase, pero no descartar ninguna.
3. CONSERVA LAS FECHAS tal como vienen y en el mismo orden cronológico.
4. Escribe en tercera persona, en presente o pretérito perfecto, con un registro profesional y comprensible para una familia. Sin jerga innecesaria y sin tecnicismos que no vinieran ya escritos.
5. Nunca uses el nombre del paciente (no lo tienes): di "el/la paciente", o el sujeto que corresponda.
6. Lo que una anotación atribuye a la familia ("la familia refiere...") sigue atribuido a la familia. No lo conviertas en observación de la profesional.
7. Los objetivos son etiquetas breves: déjalos breves.`;

function stripFences(s) {
  return String(s ?? "")
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();
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

/** Meses nombrados en el texto (las fechas del volcado van así). */
function meses(texto) {
  const t = String(texto).toLowerCase();
  return new Set(MESES.filter((m) => t.includes(m)));
}

/**
 * ¿La propuesta se ha inventado algo comprobable?
 *
 * Comprueba lo que se puede comprobar sin opinar: que no aparezca ningún número
 * ni ningún mes que no estuviera ya. No pretende detectar toda invención
 * posible —eso no lo sabe hacer una función— pero sí la que más daño hace y la
 * que un modelo produce sin querer al "redondear" una frase.
 *
 * Devuelve { ok, motivos: string[] } por apartado, con el detalle de qué apareció.
 */
export function verificarSinInventar(original, propuesta) {
  const motivos = [];
  for (const clave of SECCIONES_PULIBLES) {
    const antes = juntar(original?.[clave]);
    const despues = juntar(propuesta?.[clave]);
    if (!despues) continue;

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
 * Pide la propuesta a Claude y la devuelve verificada.
 *
 * @returns {Promise<{ propuesta: object, avisos: string[] }>}
 * @throws  Error con `code = "IA_INVENTA"` si la propuesta no pasa la
 *          verificación. Es un fallo, no un aviso: no se le puede enseñar a una
 *          profesional un borrador con datos inventados y confiar en que los vea.
 */
export async function pulirInforme({ contentSections, apiKey, model }) {
  const entrada = loQueHayQuePulir(contentSections);
  if (Object.keys(entrada).length === 0) {
    const err = new Error("No hay nada que pulir: vuelca antes las sesiones al informe");
    err.code = "SIN_CONTENIDO";
    throw err;
  }

  const user = Object.entries(entrada)
    .map(([clave, lista]) => `## ${NOMBRES[clave]} (clave "${clave}")\n${lista.map((l) => `- ${l}`).join("\n")}`)
    .join("\n\n");

  const raw = await complete({
    system: SYSTEM,
    user: `Anotaciones volcadas de las sesiones:\n\n${user}`,
    model,
    maxTokens: 4000,
    apiKey,
  });

  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    const err = new Error("La IA no ha devuelto un borrador legible. Vuelve a intentarlo.");
    err.code = "IA_ILEGIBLE";
    throw err;
  }

  // Solo se acepta lo que se pidió: cualquier clave de más se tira.
  const propuesta = {};
  for (const clave of Object.keys(entrada)) {
    const lista = comoLista(parsed?.[clave]);
    if (lista.length) propuesta[clave] = lista;
  }
  if (Object.keys(propuesta).length === 0) {
    const err = new Error("La IA no ha devuelto ningún apartado. Vuelve a intentarlo.");
    err.code = "IA_ILEGIBLE";
    throw err;
  }

  const veredicto = verificarSinInventar(entrada, propuesta);
  if (!veredicto.ok) {
    const err = new Error(
      `El borrador se ha descartado porque añadía datos que no estaban en las sesiones: ${veredicto.motivos.join("; ")}.`
    );
    err.code = "IA_INVENTA";
    throw err;
  }

  return { propuesta, avisos: avisosDePerdida(entrada, propuesta) };
}

/**
 * ── MODO DEMO (simulado) ────────────────────────────────────────────────────
 * La demo pública da sesión de admin a cualquiera, así que no dispara IA de
 * pago (mismo criterio que el resto del CRM, `demoForcesFakeAi`). Esto enseña
 * el mismo flujo sin llamar a nadie: junta las anotaciones de cada apartado en
 * frases y quita la repetición del "fecha: " delante de cada línea, que es
 * justo lo que más canta del volcado. Determinista y sin inventar nada —pasa la
 * misma verificación que la de verdad—.
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
  return { propuesta, avisos: avisosDePerdida(entrada, propuesta) };
}
