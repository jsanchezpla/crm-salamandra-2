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

/** Edad en años a `hoy` desde `birthDate`; si no hay fecha, la `age` guardada. */
export function edadDe(paciente, hoy = new Date()) {
  const f = paciente?.birthDate ? new Date(paciente.birthDate) : null;
  if (f && !Number.isNaN(f.getTime())) {
    let edad = hoy.getFullYear() - f.getFullYear();
    const m = hoy.getMonth() - f.getMonth();
    if (m < 0 || (m === 0 && hoy.getDate() < f.getDate())) edad -= 1;
    if (edad >= 0 && edad <= 120) return edad;
  }
  const n = Number(paciente?.age);
  return Number.isInteger(n) && n >= 0 && n <= 120 ? n : null;
}

/** Lo ÚNICO del paciente que viaja al modelo. Lista cerrada: nada de nombres. */
export function contextoDelPaciente(paciente, hoy = new Date()) {
  return {
    edad: edadDe(paciente, hoy),
    especialidades: Array.isArray(paciente?.specialties)
      ? paciente.specialties.map((s) => texto(s, 60)).filter(Boolean).slice(0, 8)
      : [],
    nivelEducativo: texto(paciente?.educationLevel, 80) || null,
    tipo: paciente?.careType === "nutricion" ? "nutrición" : "terapia",
  };
}

/** El prompt. `plan` es lo que hay escrito en la pantalla (guardado o no). */
export function promptObjetivos({ ideas, plan = {}, paciente = {} }) {
  const system = [
    "Eres psicólogo/a clínico/a y pedagogo/a de un centro de psicología y logopedia infantil en España.",
    "Redactas OBJETIVOS DE INTERVENCIÓN de un plan terapéutico a partir de las ideas clave que te da la terapeuta.",
    "Responde SOLO con un objeto JSON válido, sin markdown ni texto fuera del JSON, con esta forma exacta:",
    '{"objetivos": [string, ...]}',
    "Reglas:",
    `- Entre 3 y ${MAX_OBJETIVOS} objetivos, cada uno UNA frase de como mucho 200 caracteres.`,
    "- Objetivos reales y operativos: conducta observable, con criterio de logro cuando tenga sentido (frecuencia, apoyo necesario, contexto).",
    "- Adaptados a la edad y a las especialidades del paciente; en el idioma y la terminología que usa el centro.",
    "- Usa las ideas clave como base: no inventes áreas que la terapeuta no ha mencionado ni repitas objetivos que ya están en el plan.",
    "- Sin nombres propios, sin diagnósticos nuevos, sin fechas.",
    "- Todo en español.",
  ].join("\n");

  const ctx = contextoDelPaciente(paciente);
  const yaTiene = Array.isArray(plan.objectives)
    ? plan.objectives.map((o) => texto(o, MAX_OBJETIVO)).filter(Boolean)
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
