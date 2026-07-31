import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../../lib/utils/errors.js";
import { getTenantAnthropicKey } from "../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../lib/ai/anthropicModel.js";
import { vetoAi } from "../../../../../lib/ai/aiAccess.js";
import { demoForcesFakeAi } from "../../../../../lib/demo/isDemo.js";
import { complete } from "../../../../../lib/outreach/analysis/anthropic.js";
import { buildGeneratePrompts } from "../../../../../lib/projects/ai/prompts.js";
import { normalizePlan } from "../../../../../lib/projects/ai/parsePlan.js";
import { fakeProjectPlan } from "../../../../../lib/projects/ai/fake.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_KEY_MSG = "Este cliente no tiene configurada la clave de IA (Configuración → IA)";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/ai/generate
//
// Body: { prompt: string(10..4000), clientId?: uuid }
//
// Genera la VISTA PREVIA de un proyecto completo (fases, tareas, hitos,
// miembros) a partir de un texto libre. NO escribe nada en BD: el usuario
// revisa el plan y lo confirma contra /api/projects/ai/create.
// En la demo pública responde en modo SIMULADO (sin API real, sin coste).
// Responde ok({ plan, fake }).
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _routeContext, ctx) => {
  try {
    if (!ctx.hasModule("projects")) throw new ForbiddenError();

    const veto = await vetoAi(ctx, request, "generar un proyecto con IA");
    if (veto) return veto;

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body JSON inválido");
    }
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (prompt.length < 10) {
      throw new ValidationError("Describe el proyecto con un poco más de detalle (mínimo 10 caracteres)");
    }
    if (prompt.length > 4000) {
      throw new ValidationError("La descripción supera los 4000 caracteres");
    }
    const clientId = body?.clientId ?? null;
    if (clientId != null && !UUID_RE.test(clientId)) {
      throw new ValidationError("clientId inválido");
    }

    const { TeamMember, Client } = ctx.tenantModels;

    // Solo miembros activos: a la IA no se le ofrecen bajas ni excedencias.
    const teamRows = await TeamMember.findAll({
      where: { status: "active" },
      attributes: ["id", "displayName", "position"],
      order: [["displayName", "ASC"]],
      raw: true,
    });
    const teamMembers = teamRows.map((m) => ({ id: m.id, name: m.displayName, position: m.position ?? null }));

    let clientName = null;
    if (clientId) {
      const client = await Client.findByPk(clientId, { attributes: ["id", "name"] });
      clientName = client?.name ?? null;
    }

    // Patrón demo Caso B: la demo pública simula la IA (sin clave, sin coste).
    const esFake = demoForcesFakeAi(ctx);
    const apiKey = esFake ? null : getTenantAnthropicKey(ctx);
    if (!esFake && !apiKey) return error(NO_KEY_MSG, 503);
    const model = getTenantAnthropicModel(ctx);

    let raw;
    if (esFake) {
      raw = fakeProjectPlan(prompt, { teamMembers });
    } else {
      const { system, user } = buildGeneratePrompts({ prompt, teamMembers, clientName });
      // maxTokens generoso: un plan de 12 fases y 60 tareas es largo y un JSON
      // truncado no parsea.
      raw = await complete({ system, user, model, maxTokens: 12000, apiKey });
    }

    const plan = normalizePlan(raw, { teamMembers });
    return ok({ plan, fake: esFake });
  } catch (err) {
    if (err?.code === "NO_API_KEY") return error(NO_KEY_MSG, 503);
    throw err; // withTenant → handleRouteError (ValidationError 422, etc.)
  }
});
