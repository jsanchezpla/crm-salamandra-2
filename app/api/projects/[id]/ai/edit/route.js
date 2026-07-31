import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { isAdminRole, isLeadOfProject } from "../../../../../../lib/projects/projectAuth.js";
import { getTenantAnthropicKey } from "../../../../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../../../../lib/ai/anthropicModel.js";
import { vetoAi } from "../../../../../../lib/ai/aiAccess.js";
import { demoForcesFakeAi } from "../../../../../../lib/demo/isDemo.js";
import { complete } from "../../../../../../lib/outreach/analysis/anthropic.js";
import { buildEditPrompts } from "../../../../../../lib/projects/ai/prompts.js";
import { buildProjectSnapshot, normalizeOperations } from "../../../../../../lib/projects/ai/editOps.js";
import { fakeEditOps } from "../../../../../../lib/projects/ai/fake.js";

const ADMIN_DENY = "Solo administradores o el lead del proyecto pueden modificarlo";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_KEY_MSG = "Este cliente no tiene configurada la clave de IA (Configuración → IA)";
const INVALID_OPS_MSG = "La IA no ha devuelto una propuesta válida, prueba a reformular la instrucción";

function stripFences(text) {
  const t = String(text ?? "").trim();
  const match = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : t;
}

/**
 * Carga el estado del proyecto y lo condensa en el snapshot para el prompt.
 * Compartido conceptualmente con /ai/apply (allí se recarga fresco de BD).
 */
export async function loadSnapshot({ projectId, tenantModels }) {
  const { Project, Phase, BoardColumn, Task, TaskAssignee, TeamMember, ProjectMember } = tenantModels;

  const project = await Project.findByPk(projectId);
  if (!project) throw new NotFoundError("Proyecto no encontrado");

  const [phases, columns, taskRows, members, teamRows] = await Promise.all([
    Phase.findAll({ where: { projectId }, order: [["order", "ASC"]] }),
    BoardColumn.findAll({ where: { projectId }, order: [["order", "ASC"]] }),
    Task.findAll({
      where: { projectId },
      order: [["createdAt", "ASC"]],
      include: [
        {
          model: TaskAssignee,
          as: "assigneeLinks",
          required: false,
          include: [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"] }],
        },
      ],
    }),
    ProjectMember.findAll({
      where: { projectId },
      include: [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName"] }],
    }),
    TeamMember.findAll({
      where: { status: "active" },
      attributes: ["id", "displayName", "position"],
      order: [["displayName", "ASC"]],
      raw: true,
    }),
  ]);

  const tasks = taskRows.map((row) => {
    const t = row.toJSON();
    t.assignees = (t.assigneeLinks ?? [])
      .filter((al) => al.teamMember)
      .map((al) => ({ teamMemberId: al.teamMember.id, displayName: al.teamMember.displayName }));
    delete t.assigneeLinks;
    return t;
  });

  const teamMembers = teamRows.map((m) => ({ id: m.id, name: m.displayName, position: m.position ?? null }));

  const snapshot = buildProjectSnapshot({ project, phases, columns, tasks, members, teamMembers });
  return { project, snapshot };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/[id]/ai/edit
//
// Body: { instruction: string(5..2000) }
//
// Propone una lista de operaciones para reorganizar el proyecto ("entra una
// persona nueva", "añade una fase de QA"...). NO escribe nada: el usuario
// revisa la propuesta y la confirma contra /api/projects/[id]/ai/apply.
// Responde ok({ summary, operations, warnings, fake }).
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    if (!ctx.hasModule("projects")) throw new ForbiddenError();
    const { tenantModels } = ctx;
    const { id: projectId } = await params;
    if (!UUID_RE.test(projectId)) throw new ValidationError("projectId inválido");

    // Mismo criterio que el PATCH del proyecto: admin O lead.
    const role = request.headers.get("x-user-role");
    const userId = request.headers.get("x-user-id");
    if (!isAdminRole(role) && !(await isLeadOfProject({ projectId, userId, tenantModels }))) {
      return forbidden(ADMIN_DENY);
    }

    const veto = await vetoAi(ctx, request, "reorganizar un proyecto con IA");
    if (veto) return veto;

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body JSON inválido");
    }
    const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
    if (instruction.length < 5) {
      throw new ValidationError("Describe el cambio con un poco más de detalle (mínimo 5 caracteres)");
    }
    if (instruction.length > 2000) {
      throw new ValidationError("La instrucción supera los 2000 caracteres");
    }

    const { snapshot } = await loadSnapshot({ projectId, tenantModels });

    // Patrón demo Caso B: la demo pública simula la propuesta (sin coste).
    const esFake = demoForcesFakeAi(ctx);
    const apiKey = esFake ? null : getTenantAnthropicKey(ctx);
    if (!esFake && !apiKey) return error(NO_KEY_MSG, 503);
    const model = getTenantAnthropicModel(ctx);

    let parsed;
    if (esFake) {
      parsed = fakeEditOps(instruction, snapshot);
    } else {
      const { system, user } = buildEditPrompts({ instruction, snapshot });
      const raw = await complete({ system, user, model, maxTokens: 8000, apiKey });
      try {
        parsed = JSON.parse(stripFences(raw));
      } catch {
        throw new ValidationError(INVALID_OPS_MSG);
      }
    }
    if (!parsed || typeof parsed !== "object") throw new ValidationError(INVALID_OPS_MSG);

    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const { operations, warnings } = normalizeOperations(parsed.operations ?? parsed, snapshot);

    return ok({ summary, operations, warnings, fake: esFake });
  } catch (err) {
    if (err?.code === "NO_API_KEY") return error(NO_KEY_MSG, 503);
    throw err; // withTenant → handleRouteError
  }
});
