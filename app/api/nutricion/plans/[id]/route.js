import { NextResponse } from "next/server";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import {
  ok,
  error,
  forbidden,
  notFound,
  noContent,
  serverError,
} from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import {
  UUID_RE,
  countActiveAssignments,
  loadPlanTree,
} from "../../../../../lib/nutricion/plans.js";

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId, userId, action, entity: "Plan", entityId, before, after, ip,
    });
  } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/nutricion/plans/[id] — detalle con árbol meals → options → foods
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Plan } = tenantModels;
    const tree = await loadPlanTree(Plan, tenantModels, id);
    if (!tree) return notFound("Plan no encontrado");
    if (tree.archivedAt) return notFound("Plan no encontrado");

    return ok(tree);
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/nutricion/plans/[id] — editar metadata (name/description/visible)
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Plan } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    const row = await Plan.findByPk(id);
    if (!row || row.archivedAt) return notFound("Plan no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    // Campos protegidos
    if (body.type !== undefined && body.type !== row.type) {
      return error("No se puede cambiar type", 422);
    }
    if (body.templateId !== undefined && body.templateId !== row.templateId) {
      return error("No se puede cambiar templateId", 422);
    }
    if (body.clientId !== undefined && body.clientId !== row.clientId) {
      return error("No se puede cambiar clientId", 422);
    }

    const before = row.toJSON();
    const updates = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 2) return error("name debe tener al menos 2 caracteres");
      updates.name = name;
    }
    if (body.description !== undefined) {
      updates.description = body.description === null
        ? null
        : String(body.description).slice(0, 10000);
    }
    if (body.visibleToClient !== undefined) {
      updates.visibleToClient = Boolean(body.visibleToClient);
    }
    // ¿El PDF del paciente lleva P/H/G/fibra? (2026-07-22) Gobierna SOLO el
    // documento que se entrega; el editor del CRM sigue calculándolos siempre.
    if (body.showMacros !== undefined) {
      updates.showMacros = Boolean(body.showMacros);
    }
    // Comentarios por día (rediseño 2026-07-22): mapa completo
    // { "1": "texto", … "7": "texto" }. Se REEMPLAZA entero (son ≤7 textos);
    // claves fuera de 1-7 o valores no-texto → 422.
    if (body.dayComments !== undefined) {
      const dc = body.dayComments;
      if (dc === null || typeof dc !== "object" || Array.isArray(dc)) {
        return error("dayComments debe ser un objeto { \"1\"…\"7\": texto }", 422);
      }
      const clean = {};
      for (const [k, v] of Object.entries(dc)) {
        const day = Number(k);
        if (!Number.isInteger(day) || day < 1 || day > 7) {
          return error(`dayComments: clave inválida "${k}" (1-7)`, 422);
        }
        if (typeof v !== "string") return error(`dayComments[${k}] debe ser texto`, 422);
        const text = v.slice(0, 5000).trim();
        if (text) clean[String(day)] = text; // días en blanco no se guardan
      }
      updates.dayComments = clean;
    }

    if (Object.keys(updates).length > 0) {
      await row.update(updates);
    }

    let hadAssignments = 0;
    if (row.type === "template") {
      hadAssignments = await countActiveAssignments(Plan, row.id);
    }

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.plan.updated",
      entityId: row.id,
      before,
      after: row.toJSON(),
      ip,
    });

    return NextResponse.json({
      ok: true,
      hadAssignments,
      plan: row.toJSON(),
    });
  } catch (err) {
    return serverError(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/nutricion/plans/[id] — soft delete
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Plan } = tenantModels;
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    const row = await Plan.findByPk(id);
    if (!row || row.archivedAt) return notFound("Plan no encontrado");

    const before = row.toJSON();
    await row.update({ archivedAt: new Date() });

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "nutricion.plan.archived",
      entityId: row.id,
      before,
      after: row.toJSON(),
      ip,
    });

    return noContent();
  } catch (err) {
    return serverError(err);
  }
});
