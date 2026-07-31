import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { getTenantAnthropicKey } from "../../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../../lib/ai/anthropicModel.js";
import { demoForcesFakeAi } from "../../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../../lib/ai/aiAccess.js";
import { complete } from "../../../../../../lib/outreach/analysis/anthropic.js";
import {
  ALLOWED_ICONS,
  DEFAULT_ICON,
  DEFAULT_THRESHOLDS,
  slugifyAreaKey,
} from "../../../../../../lib/clinica/performanceConfig.js";
import { PERFORMANCE_PRESETS } from "../../../../../../lib/clinica/performancePresets.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// ── Modo simulado (demo pública): preset que mejor case con el nombre ───────
const PRESET_KEYWORDS = {
  terapeuta: ["terapeuta", "terapia", "psico", "clinic", "logopeda"],
  administracion: ["administra", "gestion", "oficina", "contab", "secretar"],
  comercial: ["comercial", "venta", "ventas", "sales", "captador"],
  recepcion: ["recepcion", "recepcionista", "atencion al publico", "front desk"],
  marketing: ["marketing", "contenido", "redes", "publicidad", "comunicacion"],
  gerencia: ["gerencia", "gerente", "direccion", "director", "manager", "coordinad"],
};

function sinAcentos(v) {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function fakeRoleProposal(roleName) {
  const q = sinAcentos(roleName);
  let preset = PERFORMANCE_PRESETS.find((p) => p.key === "gerencia");
  for (const p of PERFORMANCE_PRESETS) {
    const kws = PRESET_KEYWORDS[p.key] ?? [];
    if (q.includes(sinAcentos(p.name)) || kws.some((kw) => q.includes(kw))) {
      preset = p;
      break;
    }
  }
  return {
    name: roleName,
    thresholds: { ...preset.thresholds },
    areas: preset.areas.map((a) => ({ ...a })),
  };
}

// ── Normalización defensiva de la propuesta de la IA ────────────────────────
function normalizeAiRole(raw, roleName) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.areas)) return null;

  const areas = [];
  const usedKeys = [];
  for (const a of raw.areas.slice(0, 15)) {
    if (!a || typeof a !== "object") continue;
    const name = typeof a.name === "string" ? a.name.trim().slice(0, 120) : "";
    if (!name) continue;
    let weight = Math.round(Number(a.weight));
    if (!Number.isFinite(weight) || weight < 1) weight = 1;
    if (weight > 100) weight = 100;
    const key = slugifyAreaKey(name, usedKeys);
    usedKeys.push(key);
    areas.push({
      key,
      name,
      weight,
      icon: ALLOWED_ICONS.includes(a.icon) ? a.icon : DEFAULT_ICON,
      goal: typeof a.goal === "string" ? a.goal.trim().slice(0, 300) : "",
      description: typeof a.description === "string" ? a.description.trim().slice(0, 500) : "",
    });
  }
  if (areas.length < 1) return null;

  // Ajustar los pesos para que sumen EXACTAMENTE 100: reparto proporcional y
  // el redondeo sobrante se lo lleva el área de más peso.
  const sum = areas.reduce((s, a) => s + a.weight, 0);
  if (sum !== 100) {
    let acc = 0;
    for (const a of areas) {
      a.weight = Math.max(1, Math.round((a.weight / sum) * 100));
      acc += a.weight;
    }
    areas.sort((a, b) => b.weight - a.weight);
    areas[0].weight += 100 - acc;
    if (areas[0].weight < 1) return null; // irreparable (demasiadas áreas)
  }

  let thresholds = { ...DEFAULT_THRESHOLDS };
  const green = Math.round(Number(raw.thresholds?.green));
  const amber = Math.round(Number(raw.thresholds?.amber));
  if (Number.isFinite(green) && Number.isFinite(amber) && green <= 100 && green > amber && amber >= 0) {
    thresholds = { green, amber };
  }

  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : roleName;
  return { name, thresholds, areas };
}

function buildPrompts({ roleName, description }) {
  const system = [
    "Eres consultor de RRHH de una pyme española. Diseñas áreas de evaluación de desempeño para un puesto de trabajo.",
    "Responde SOLO con un objeto JSON válido, sin markdown, sin comentarios y sin texto fuera del JSON, con esta forma exacta:",
    '{"name": string, "thresholds": {"green": number, "amber": number}, "areas": [{"name": string, "weight": number, "icon": string, "goal": string, "description": string}]}',
    "Reglas:",
    "- Entre 4 y 8 áreas; los pesos son enteros y SUMAN EXACTAMENTE 100.",
    `- "icon" debe ser uno de: ${ALLOWED_ICONS.join(", ")}.`,
    '- "goal" es la meta del área en una frase corta y medible; "description" una aclaración breve (puede ser "").',
    '- "thresholds": green (nota desde la que el semáforo es verde) mayor que amber, ambos 0-100 (típicamente 85 y 70).',
    "- Todo el texto en español.",
  ].join("\n");
  const user = [
    `Puesto a evaluar: ${roleName}`,
    description ? `Qué hace este puesto en esta empresa: ${description}` : null,
    "Propón las áreas de desempeño con su peso, meta e icono.",
  ].filter(Boolean).join("\n");
  return { system, user };
}

/**
 * POST /api/clinica/performance/config/ai — proponer con IA las áreas de
 * desempeño de un rol. Body { roleName: string(2..120), description?: string }.
 * Siempre a petición del usuario (botón "Generar con IA"). Clave BYOK del
 * tenant; sin clave → 503. En la DEMO pública responde en modo SIMULADO
 * (preset que case con el nombre, sin API real, sin coste).
 */
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    if (!ctx.hasModule("team_avanzado")) return forbidden("Módulo Equipo avanzado no activo");
    if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo dirección puede configurar el desempeño");

    const veto = await vetoAi(ctx, request, "generar áreas de desempeño con IA");
    if (veto) return veto;

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido");
    }
    const roleName = typeof body.roleName === "string" ? body.roleName.trim() : "";
    if (roleName.length < 2 || roleName.length > 120) {
      return error("Indica el nombre del puesto (2-120 caracteres)");
    }
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : "";

    const esFake = demoForcesFakeAi(ctx);
    if (esFake) {
      return ok({ role: fakeRoleProposal(roleName), fake: true });
    }

    const apiKey = getTenantAnthropicKey(ctx);
    const model = getTenantAnthropicModel(ctx);
    const { system, user } = buildPrompts({ roleName, description });
    const text = await complete({ system, user, model, maxTokens: 3000, apiKey });

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
    } catch {
      return error("La IA no ha devuelto una propuesta válida. Inténtalo de nuevo.", 502);
    }
    const role = normalizeAiRole(parsed, roleName);
    if (!role) return error("La IA no ha devuelto una propuesta válida. Inténtalo de nuevo.", 502);

    return ok({ role, fake: false });
  } catch (err) {
    if (err?.code === "NO_API_KEY") {
      return error("Este cliente no tiene configurada la clave de IA (Configuración → IA)", 503);
    }
    return serverError(err);
  }
});
