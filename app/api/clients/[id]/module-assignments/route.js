import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, error } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import {
  marcasYModulosAsignables,
  syncClinicPatient,
  listAssignments,
  isMissingTable,
} from "../../../../../lib/clients/moduleAssignments.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {
    /* auditoría best-effort */
  }
}

function serialize(rows) {
  return rows.map((a) => ({
    moduleKey: a.moduleKey,
    enabled: a.enabled,
    assignedAt: a.assignedAt,
    metadata: a.metadata ?? {},
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/clients/[id]/module-assignments
// → { available: [moduleKey...], assignments: [{moduleKey, enabled, ...}] }
//   `available` = módulos asignables que este tenant tiene activos (nutricion/clinica).
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();
  const { Client, ClientModuleAssignment } = tenantModels;
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("id inválido", 422);

  const client = await Client.findByPk(id, { attributes: ["id"] });
  if (!client) return notFound("Cliente no encontrado");

  const available = marcasYModulosAsignables(hasModule);
  const rows = await listAssignments(ClientModuleAssignment, id);
  return ok({ available, assignments: serialize(rows) });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/clients/[id]/module-assignments
// Body: { assignments: [{ module_key, enabled }] }  (acepta moduleKey también)
//
// Upsert por (client_id, module_key). Para module_key='clinica' materializa /
// retira el Patient enlazado (aparece/desaparece en el módulo Clínica).
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  if (!hasModule("clients")) return forbidden();
  const { Client, ClientModuleAssignment } = tenantModels;
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("id inválido", 422);

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  const body = await request.json().catch(() => null);
  const incoming = Array.isArray(body?.assignments) ? body.assignments : null;
  if (!incoming) return error("Body inválido: se espera { assignments: [{ module_key, enabled }] }", 422);

  const available = marcasYModulosAsignables(hasModule);
  const userId = request.headers.get("x-user-id");
  const now = new Date();

  // Validación previa (todo o nada): no aplicar cambios parciales si un
  // module_key es inválido para este tenant.
  const normalized = incoming.map((a) => ({
    moduleKey: String(a?.module_key ?? a?.moduleKey ?? "").trim(),
    enabled: !!a?.enabled,
  }));
  for (const { moduleKey } of normalized) {
    if (!available.includes(moduleKey)) {
      return error(`Módulo no asignable en este tenant: "${moduleKey}"`, 422);
    }
  }

  // Transacción: aplicar TODAS las asignaciones (y la materialización de
  // Clínica) de forma atómica — si una falla, no queda estado a medias.
  const clinic = [];
  try {
    await tenantSequelize.transaction(async (t) => {
      for (const { moduleKey, enabled } of normalized) {
        const row = await ClientModuleAssignment.findOne({ where: { clientId: id, moduleKey }, transaction: t });
        if (row) {
          await row.update(
            {
              enabled,
              // assigned_at se fija la primera vez que se activa; no se pisa al reactivar.
              assignedAt: enabled ? row.assignedAt ?? now : row.assignedAt,
              assignedByUserId: userId ?? row.assignedByUserId,
            },
            { transaction: t }
          );
        } else {
          await ClientModuleAssignment.create(
            {
              clientId: id,
              moduleKey,
              enabled,
              assignedAt: enabled ? now : null,
              assignedByUserId: userId ?? null,
            },
            { transaction: t }
          );
        }
        if (moduleKey === "clinica") {
          clinic.push({ ...(await syncClinicPatient({ tenantModels, client, enabled, transaction: t })), moduleKey });
        }
      }
    });
  } catch (err) {
    // Tenant con schema parcial sin la tabla (migración pendiente): 42P01. El
    // GET degrada a []; aquí degradamos a 503 en vez de un 500 genérico.
    if (isMissingTable(err)) return error("Asignaciones de módulo no disponibles todavía en este tenant (migración pendiente).", 503);
    throw err;
  }

  await auditLog({
    tenantId: tenant.id,
    userId,
    action: "client.modules.updated",
    entity: "Client",
    entityId: id,
    before: null,
    after: { assignments: normalized, clinic },
    ip: request.headers.get("x-forwarded-for"),
  });

  const rows = await listAssignments(ClientModuleAssignment, id);
  return ok({ available, assignments: serialize(rows), clinic });
});
