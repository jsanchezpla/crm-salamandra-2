/**
 * Parseo y normalización de la respuesta de la IA.
 *
 * Se pide solo JSON, pero nunca se confía ciegamente en el modelo: se quitan
 * vallas de markdown, se acotan los scores, se fuerzan los tipos y se rellena
 * lo que falte. Un modelo que devuelve basura no debe corromper la BD.
 */

/** Quita vallas ```json ... ``` por si el modelo las añade pese al prompt. */
function stripFences(text) {
  const t = String(text ?? "").trim();
  const match = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : t;
}

function toScore(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function toStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

function toText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** El correo modelo siempre sale con { subject, body } presentes. */
function normEmail(value) {
  const c = value && typeof value === "object" ? value : {};
  return {
    subject: toText(c.asunto ?? c.subject),
    body: toText(c.cuerpo ?? c.body),
  };
}

function normBlock(block) {
  const b = block && typeof block === "object" ? block : {};
  return {
    score: toScore(b.score),
    reasonWhy: toText(b.reason_why ?? b.reasonWhy),
    needs: toStringList(b.necesidades ?? b.needs),
    pitch: toText(b.pitch),
    emailDraft: normEmail(b.correo ?? b.email ?? b.emailDraft),
  };
}

/**
 * Parsea la respuesta al mapa { [businessLineKey]: bloque normalizado }.
 *
 * Solo se devuelven las claves de las líneas pedidas: si el modelo se inventa
 * una línea extra, se ignora; si omite una, se rellena con un bloque vacío
 * (score 0) en vez de fallar el análisis entero.
 */
export function parseAnalysis(text, businessLines) {
  let obj;
  try {
    obj = JSON.parse(stripFences(text));
  } catch {
    throw new Error("La IA no devolvió un JSON válido");
  }
  if (!obj || typeof obj !== "object") {
    throw new Error("La IA no devolvió un objeto JSON");
  }

  const result = {};
  for (const line of businessLines) {
    result[line.key] = normBlock(obj[line.key]);
  }
  return result;
}
