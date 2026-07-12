/**
 * Estructuración de una sesión clínica con Claude: dada la transcripción de la nota
 * de voz de la terapeuta, produce el registro estructurado (objetivos, actividades,
 * desempeño, observaciones). Reutiliza el proveedor de Anthropic del módulo Outreach
 * y el patrón de "pedir SOLO JSON → parsear defensivo → normalizar → nunca romper".
 */

import { complete } from "../outreach/analysis/anthropic.js";

const SYSTEM = `Eres un asistente clínico de un centro de psicopedagogía infantil. Recibes la transcripción de una nota de voz que una terapeuta ha grabado tras una sesión con un paciente. Tu tarea es extraer y estructurar la información de forma profesional y concisa, en español.

Devuelve SOLO un JSON válido (sin texto alrededor, sin markdown, sin explicaciones) con EXACTAMENTE esta forma:
{
  "objectives": ["objetivo terapéutico trabajado 1", "objetivo 2"],
  "activities": "actividades realizadas en la sesión (texto)",
  "performance": "desempeño y evolución del paciente en la sesión (texto)",
  "observations": {
    "familyComments": "comentarios de/para la familia",
    "nextSessionNotes": "notas para próximas sesiones",
    "homeworkTasks": "tareas para casa",
    "incidents": "incidencias (o 'Ninguna')"
  }
}

Reglas: si algo no se menciona en la transcripción, deja el campo como cadena vacía (o lista vacía en objectives). No inventes datos que no estén en la transcripción. Los objetivos son etiquetas cortas (2-4 palabras).`;

function stripFences(s) {
  return String(s ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
function asStr(v) {
  if (v == null) return "";
  return typeof v === "string" ? v.trim() : String(v);
}
function asArr(v) {
  if (Array.isArray(v)) return v.map(asStr).filter(Boolean);
  if (v == null || v === "") return [];
  return [asStr(v)].filter(Boolean);
}

/**
 * @param {{ transcription: string, apiKey: string, model?: string }} args
 * @returns {Promise<{ objectives: string[], activities: string, performance: string, observations: object }>}
 */
export async function structureSession({ transcription, apiKey, model }) {
  const raw = await complete({
    system: SYSTEM,
    user: `Transcripción de la sesión:\n\n${transcription}`,
    model,
    maxTokens: 1500,
    apiKey,
  });

  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    parsed = {};
  }
  const obs = parsed?.observations && typeof parsed.observations === "object" && !Array.isArray(parsed.observations) ? parsed.observations : {};

  return {
    objectives: asArr(parsed?.objectives),
    activities: asStr(parsed?.activities),
    performance: asStr(parsed?.performance),
    observations: {
      familyComments: asStr(obs.familyComments),
      nextSessionNotes: asStr(obs.nextSessionNotes),
      homeworkTasks: asStr(obs.homeworkTasks),
      incidents: asStr(obs.incidents),
    },
  };
}
