import { Op } from "sequelize";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, error, serverError } from "../../../lib/utils/apiResponse.js";
import { findRelevant } from "../../../lib/assistant/knowledge.js";
import { answerQuestion } from "../../../lib/assistant/answer.js";
import { getTenantAnthropicKey } from "../../../lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "../../../lib/ai/anthropicModel.js";

const MAX_MSGS = 12;

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_MSGS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

async function searchClients(tenantModels, query) {
  const { Client } = tenantModels;
  if (!Client) return [];
  const words = String(query)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\W+/)
    .filter((w) => w.length >= 3 && !["como", "donde", "cuando", "para", "que", "los", "las", "una", "cliente", "clientes", "busca", "buscar"].includes(w));
  if (!words.length) return [];
  try {
    const rows = await Client.findAll({
      where: { [Op.or]: words.map((w) => ({ name: { [Op.iLike]: `%${w}%` } })) },
      attributes: ["id", "name"],
      limit: 6,
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  } catch {
    return [];
  }
}

// POST /api/assistant — Salamandrobot. Disponible en cualquier tenant (ayuda
// transversal, sin gate de módulo). Requiere sesión (withTenant).
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const messages = sanitizeMessages(body?.messages);
    if (!messages.length) return error("Sin mensajes");
    const query = [...messages].reverse().find((m) => m.role === "user")?.content || "";

    const relevant = findRelevant(query);
    const clients = await searchClients(ctx.tenantModels, query);
    const apiKey = getTenantAnthropicKey(ctx);
    const model = getTenantAnthropicModel(ctx);

    let result;
    try {
      result = await answerQuestion({
        messages, relevant, clients, apiKey, model, companyName: ctx.tenant?.name,
        forceFake: ctx.slug === "demo",
      });
    } catch {
      // La IA falló (clave inválida, timeout, 503…): no rompemos el chat.
      const fallback = relevant?.[0]?.help ||
        "Puedo orientarte por los módulos del CRM y buscar clientes, facturas o pacientes. ¿Qué necesitas?";
      result = { answer: fallback, model: "sin-ia" };
    }

    const links = [
      ...clients.slice(0, 4).map((c) => ({ label: c.name, href: `/clientes/${c.id}` })),
      ...relevant.slice(0, 3).map((r) => ({ label: r.title, href: r.path })),
    ];

    return ok({ answer: result.answer, model: result.model, links });
  } catch (err) {
    return serverError(err);
  }
});
