import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, error, serverError } from "../../../lib/utils/apiResponse.js";
import { answerQuestion } from "../../../lib/assistant/answer.js";
import { prepararTurno } from "../../../lib/assistant/turno.js";
import { vetoAi } from "../../../lib/ai/aiAccess.js";

const MAX_MSGS = 12;

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_MSGS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

// POST /api/assistant — Salamandrobot. Sin moduleKey: lo ve quien tenga sesión
// (withTenant). Lo que toca datos o gasta IA se decide en `prepararTurno`
// (`lib/assistant/turno.js`, 14/09/2026): fichas solo con Clientes y sin
// consultas externas ajenas, simulado en las cuatro demos, y `vetoAi` solo si
// se va a gastar IA —si dice que no, se contesta sin IA con su frase en
// `avisoIA`, no con el 403/429—.
export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    const messages = sanitizeMessages(body?.messages);
    if (!messages.length) return error("Sin mensajes");

    const turno = await prepararTurno({ ctx, request, messages }, { vetoAi });
    const { relevant, clients } = turno;

    let result;
    try {
      result = await answerQuestion({
        messages, relevant, clients, apiKey: turno.apiKey, model: turno.model, companyName: ctx.tenant?.name,
        forceFake: turno.simulado,
      });
    } catch (e) {
      // Un fallo de la IA ya lo recoge `answerQuestion` y contesta sin IA con
      // su `avisoIA` (13/09/2026). Lo que llega aquí es otra cosa: no rompemos
      // el chat, pero tampoco se hace pasar por una respuesta normal.
      console.error("[assistant]", e?.name, e?.message);
      const fallback = relevant?.[0]?.help ||
        "Puedo orientarte por los módulos del CRM y buscar clientes, facturas o pacientes. ¿Qué necesitas?";
      result = {
        answer: fallback,
        model: "sin-ia",
        avisoIA: "La IA no ha podido responder ahora. Te contesto con la ayuda del CRM.",
      };
    }

    const links = [
      ...clients.slice(0, 4).map((c) => ({ label: c.name, href: `/clientes/${c.id}` })),
      ...relevant.slice(0, 3).map((r) => ({ label: r.title, href: r.path })),
    ];

    // Un solo aviso: el del veto (sin IA a propósito) o el del fallo de la IA.
    return ok({ answer: result.answer, model: result.model, links, avisoIA: turno.avisoIA ?? result.avisoIA ?? null });
  } catch (err) {
    return serverError(err);
  }
});
