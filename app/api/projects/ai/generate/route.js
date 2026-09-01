import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { error } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../../lib/utils/errors.js";
import { getTenantAnthropicKey } from "../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../lib/ai/anthropicModel.js";
import { vetoAi } from "../../../../../lib/ai/aiAccess.js";
import { demoForcesFakeAi } from "../../../../../lib/demo/isDemo.js";
import { complete } from "../../../../../lib/outreach/analysis/anthropic.js";
import { buildGeneratePrompts } from "../../../../../lib/projects/ai/prompts.js";
import { normalizePlan } from "../../../../../lib/projects/ai/parsePlan.js";
import { esErrorDeIa, mensajeDeErrorIa } from "../../../../../lib/ai/errorLegible.js";
import { fakeProjectPlan } from "../../../../../lib/projects/ai/fake.js";
import { respuestaConLatido } from "../../../../../lib/ai/respuestaConLatido.js";

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
// Responde 200 con { ok, data: { plan, fake } } POR STREAMING (respuestaConLatido):
// mira `j.ok`, no solo `res.ok`.
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

    /*
     * A partir de aquí la respuesta ya está viajando (`respuestaConLatido`):
     * planificar un proyecto entero tarda minutos y una conexión callada la
     * corta nginx a los 60 s. Todo lo que puede contestar un código HTTP
     * distinto de 200 —permisos, validación, falta de clave— ha quedado
     * ARRIBA a propósito: aquí el fallo ya solo cabe dentro del cuerpo.
     */
    return respuestaConLatido(async () => {
      try {
        let raw;
        if (esFake) {
          raw = fakeProjectPlan(prompt, { teamMembers });
        } else {
          const { system, user } = buildGeneratePrompts({ prompt, teamMembers, clientName });
          /*
           * maxTokens generoso: un plan de 12 fases y 60 tareas es largo y un
           * JSON truncado no parsea. Por streaming y con 5 minutos de margen:
           * sin `stream` se pedían 12.000 tokens de golpe contra un timeout de
           * 120 s, que a la velocidad normal del modelo no llegaba nunca — y
           * eso salía por pantalla como «Error interno del servidor».
           */
          raw = await complete({
            system,
            user,
            model,
            maxTokens: 12000,
            apiKey,
            stream: true,
            timeoutMs: 300_000,
          });
        }
        return { ok: true, data: { plan: normalizePlan(raw, { teamMembers }), fake: esFake } };
      } catch (err) {
        if (err?.code === "NO_API_KEY") return { ok: false, error: NO_KEY_MSG };
        // Lo que falla en Anthropic se cuenta, no se esconde: antes subía a
        // `handleRouteError`, que en producción contesta «Error interno del
        // servidor» y deja el motivo solo en los logs del contenedor. Clave
        // caducada, modelo retirado y saturación se veían todos igual.
        if (esErrorDeIa(err)) {
          console.error("[projects/ai/generate]", err?.name, err?.status, err?.message);
          return { ok: false, error: mensajeDeErrorIa(err) };
        }
        // ValidationError de `normalizePlan`: su mensaje YA está escrito para
        // el usuario («prueba a reformular el prompt»).
        if (err?.statusCode === 422 || err?.name === "ValidationError") {
          return { ok: false, error: err.message };
        }
        throw err;
      }
    });
  } catch (err) {
    if (err?.code === "NO_API_KEY") return error(NO_KEY_MSG, 503);
    throw err; // withTenant → handleRouteError (ValidationError 422, etc.)
  }
});
