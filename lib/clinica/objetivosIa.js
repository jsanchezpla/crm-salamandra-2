/**
 * lib/clinica/objetivosIa.js — de unas ideas clave a los objetivos de
 * intervención del plan, con Claude.
 *
 * Lo pidió Aumenta el 02/09/2026 (buzón AV-0019, Laura): «dentro de cada
 * paciente, en el apartado de Plan, en la parte de objetivos, que al meter
 * ideas clave para trabajar esos objetivos la IA elabore los objetivos de
 * intervención reales adaptados a cada paciente».
 *
 * ── PURO, A PROPÓSITO ───────────────────────────────────────────────────────
 * Aquí no hay base de datos ni llamada al modelo: solo el prompt que se le
 * manda, cómo se lee lo que contesta y la propuesta canned de la demo. Así
 * `scripts/_smoke-objetivos-ia.mjs` lo fija sin clave ni servidor. La llamada
 * vive en `app/api/pacientes/[id]/plan/objetivos-ia/route.js`.
 *
 * ── LO QUE NO VIAJA AL MODELO ───────────────────────────────────────────────
 * Ni el nombre del paciente ni el de la familia: al modelo le basta la edad,
 * las especialidades y lo que ya está escrito en el plan. `contextoDelPaciente`
 * es una lista CERRADA de campos por eso mismo.
 */

export const MAX_OBJETIVOS = 10;
export const MAX_IDEAS = 2000;
const MAX_OBJETIVO = 300;

const texto = (v, max) => String(v ?? "").trim().slice(0, max);

// La edad vive desde el 03/09/2026 en lib/clinica/edad.js (la necesitan
// también la ficha, el listado y los informes); se re-exporta para que quien
// la importaba de aquí siga funcionando.
import { edadDe } from "./edad.js";
import { textosDeObjetivos } from "./objetivosDelPlan.js";
import { estiloClinico, lineaDePaciente, contextoDelPaciente } from "./estiloClinico.js";
export { edadDe };
/*
 * `contextoDelPaciente` se mudó a `estiloClinico.js` el 09/09/2026 y se
 * re-exporta desde aquí para no romper a quien lo importaba.
 *
 * El motivo es un CICLO: este fichero pasó a usar `estiloClinico` (el prompt de
 * la casa) y `estiloClinico` usaba `contextoDelPaciente` de aquí. ESM aguanta
 * el ciclo mientras las dos se usen dentro de funciones, pero es una trampa
 * puesta para el día que alguien mueva una llamada al cuerpo del módulo. Y de
 * paso está mejor: qué se le cuenta al modelo del paciente es exactamente de lo
 * que trata `estiloClinico`.
 */
export { contextoDelPaciente };

/**
 * El prompt. `plan` es lo que hay escrito en la pantalla (guardado o no).
 *
 * ── 09/09/2026: ESTE ERA EL PROMPT QUE SE HABÍA QUEDADO ATRÁS ─────────────
 * Los otros tres prompts clínicos pasaron por la casa común
 * (`estiloClinico.js`) el 04/09/2026 y este no. Se notaba en tres cosas, y las
 * tres salían en lo que Blanca leía:
 *
 *   · Tenía su PROPIA identidad inventada por nosotros —«un centro de
 *     psicología y logopedia infantil en España»— distinta de la de los otros
 *     dos prompts y falsa para el 22,5 % de los pacientes de Aumenta, que son
 *     adultos.
 *   · Le PEDÍA al modelo «la terminología que usa el centro» sin darle ni una
 *     palabra de esa terminología. Esa línea era el encargo entero en
 *     miniatura.
 *   · Decía «sin diagnósticos nuevos» de pasada, mientras que la casa tiene
 *     una prohibición explícita y razonada de diagnosticar, que es lo único de
 *     todo esto que no se puede corregir después.
 *
 * Ahora la identidad, la frontera de lo que se puede inventar, las marcas de
 * interpretación y las prohibiciones salen de `estiloClinico`, con el perfil
 * del centro dentro; aquí se queda solo lo que es propio de un objetivo.
 */
export function promptObjetivos({ ideas, plan = {}, paciente = {}, centro = null }) {
  const system = [
    estiloClinico({ contexto: lineaDePaciente(paciente), centro }),
    "LO QUE TIENES QUE ESCRIBIR: los OBJETIVOS DE INTERVENCIÓN de un plan terapéutico, a partir de las ideas clave que te da la profesional.",
    [
      "REGLAS PROPIAS DE UN OBJETIVO (mandan sobre las de arriba si chocan):",
      `- Entre 3 y ${MAX_OBJETIVOS} objetivos, cada uno UNA frase de como mucho 200 caracteres.`,
      "- Operativos: conducta observable, con criterio de logro cuando tenga sentido (frecuencia, apoyo necesario, contexto).",
      "- Usa las ideas clave como base: no inventes áreas que la profesional no ha mencionado ni repitas objetivos que ya están en el plan.",
      "- Sin fechas.",
    ].join("\n"),
    'FORMA EXACTA DE LA RESPUESTA: SOLO un objeto JSON válido, sin markdown ni texto alrededor: {"objetivos": [string, ...]}',
  ].join("\n\n");

  const ctx = contextoDelPaciente(paciente);
  // Los objetivos llevan terapeuta desde el 07/09/2026 (AV-0061): al modelo
  // le llegan solo los textos, que es lo único que necesita para no repetir.
  const yaTiene = Array.isArray(plan.objectives)
    ? textosDeObjetivos(plan.objectives).map((o) => texto(o, MAX_OBJETIVO)).filter(Boolean)
    : [];
  const user = [
    `Paciente: ${ctx.edad != null ? `${ctx.edad} años` : "edad no indicada"}` +
      (ctx.especialidades.length ? ` · especialidades: ${ctx.especialidades.join(", ")}` : "") +
      (ctx.nivelEducativo ? ` · nivel educativo: ${ctx.nivelEducativo}` : "") +
      ` · ${ctx.tipo}`,
    plan.diagnosis ? `Diagnóstico o hipótesis de trabajo: ${texto(plan.diagnosis, 2000)}` : null,
    plan.consultationReasons ? `Motivo de consulta: ${texto(plan.consultationReasons, 4000)}` : null,
    plan.previousInfo ? `Información previa: ${texto(plan.previousInfo, 4000)}` : null,
    yaTiene.length ? `Objetivos que YA tiene el plan (no los repitas):\n- ${yaTiene.join("\n- ")}` : null,
    `Ideas clave de la terapeuta:\n${texto(ideas, MAX_IDEAS)}`,
    "Redacta los objetivos de intervención.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

const sinAcentos = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Lo que contesta el modelo → lista limpia. Acepta el JSON con o sin vallas de
 * markdown, un objeto `{objetivos:[…]}` o directamente un array; tira lo que no
 * sea texto, recorta, quita repetidos (sin tildes ni mayúsculas) y los que el
 * plan ya tiene. Con basura devuelve `[]`, nunca revienta.
 */
export function parsearObjetivos(respuesta, { max = MAX_OBJETIVOS, yaTiene = [] } = {}) {
  let crudo = String(respuesta ?? "").trim();
  crudo = crudo.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let datos;
  try {
    datos = JSON.parse(crudo);
  } catch {
    return [];
  }
  const lista = Array.isArray(datos) ? datos : Array.isArray(datos?.objetivos) ? datos.objetivos : [];
  const vistos = new Set(yaTiene.map(sinAcentos));
  const salida = [];
  for (const item of lista) {
    const t = typeof item === "string" ? texto(item, MAX_OBJETIVO) : "";
    if (!t) continue;
    const clave = sinAcentos(t);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(t);
    if (salida.length >= max) break;
  }
  return salida;
}

/**
 * La propuesta de la demo (sin gastar IA): una frase por idea. Es un
 * escaparate, no un plan; lo importante es que se vea el flujo entero.
 */
export function objetivosDeEnsayo(ideas) {
  const trozos = String(ideas ?? "")
    .split(/[\n,;.]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 5);
  if (!trozos.length) return [];
  return trozos.map(
    (idea) =>
      `Trabajar ${idea.charAt(0).toLowerCase()}${idea.slice(1)} en sesión con apoyo visual, hasta lograrlo de forma autónoma en 4 de cada 5 ocasiones.`
  );
}
