import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, noContent } from "../../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../../lib/db/masterDb.js";
import {
  normalizeContactValue,
  normalizeLabel,
  validateContactValue,
  syncClientMirror,
  serializeContactMethod,
  isMissingTable,
} from "../../../../../../lib/clients/contactMethods.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {
    /* auditoría best-effort */
  }
}

async function loadOwned(ClientContactMethod, clientId, methodId, transaction) {
  return ClientContactMethod.findOne({ where: { id: methodId, clientId }, transaction });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/clients/[id]/contact-methods/[methodId]
// Body: { value?, label?, isPrimary? }
//   - isPrimary=true → promueve este (y degrada el principal anterior del tipo).
//   - isPrimary=false sobre el principal actual → 422 (promueve otro en su lugar).
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  if (!hasModule("clients")) return forbidden();
  const { Client, ClientContactMethod } = tenantModels;
  if (!ClientContactMethod) return error("Métodos de contacto no disponibles en este tenant.", 503);
  const { id, methodId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(methodId)) return error("id inválido", 422);

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return error("Body inválido", 422);

  try {
    const updated = await tenantSequelize.transaction(async (t) => {
      const method = await loadOwned(ClientContactMethod, id, methodId, t);
      if (!method) {
        const e = new Error("no encontrado");
        e.code = "NF";
        throw e;
      }
      const updates = {};
      if ("value" in body) {
        const value = normalizeContactValue(method.kind, body.value);
        const invalid = validateContactValue(method.kind, value);
        if (invalid) {
          const e = new Error(invalid);
          e.code = "VAL";
          throw e;
        }
        // Dedup contra OTRO método del mismo tipo con ese valor.
        const dup = await ClientContactMethod.findOne({
          where: { clientId: id, kind: method.kind, value },
          transaction: t,
        });
        if (dup && dup.id !== method.id) {
          const e = new Error("Ya existe ese contacto para el cliente");
          e.code = "DUP";
          throw e;
        }
        updates.value = value;
      }
      if ("label" in body) updates.label = normalizeLabel(body.label);

      if ("isPrimary" in body) {
        const wantPrimary = !!body.isPrimary;
        if (wantPrimary && !method.isPrimary) {
          await ClientContactMethod.update(
            { isPrimary: false },
            { where: { clientId: id, kind: method.kind, isPrimary: true }, transaction: t }
          );
          updates.isPrimary = true;
        } else if (!wantPrimary && method.isPrimary) {
          // No permitir quedarse sin principal: se cambia promoviendo otro.
          const e = new Error("Para cambiar el principal, marca otro contacto como principal.");
          e.code = "VAL";
          throw e;
        }
      }

      if (Object.keys(updates).length > 0) await method.update(updates, { transaction: t });
      await syncClientMirror({ client, ClientContactMethod, transaction: t });
      return method;
    });

    await auditLog({
      tenantId: tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "client.contact_method.updated",
      entity: "Client",
      entityId: id,
      before: null,
      after: serializeContactMethod(updated),
      ip: request.headers.get("x-forwarded-for"),
    });
    return ok(serializeContactMethod(updated));
  } catch (err) {
    if (err.code === "NF") return notFound("Método de contacto no encontrado");
    if (err.code === "VAL") return error(err.message, 422);
    if (err.code === "DUP") return error(err.message, 409);
    if (err.name === "SequelizeUniqueConstraintError") return error("Conflicto al guardar el contacto, reinténtalo", 409);
    if (isMissingTable(err)) return error("Métodos de contacto no disponibles en este tenant.", 503);
    throw err;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/clients/[id]/contact-methods/[methodId]
//   - Si se borra el principal y quedan otros del mismo tipo, se promueve el más
//     antiguo. El espejo Client.email/phone se recalcula.
// ─────────────────────────────────────────────────────────────────────────────
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  if (!hasModule("clients")) return forbidden();
  const { Client, ClientContactMethod } = tenantModels;
  if (!ClientContactMethod) return error("Métodos de contacto no disponibles en este tenant.", 503);
  const { id, methodId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(methodId)) return error("id inválido", 422);

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  try {
    const removed = await tenantSequelize.transaction(async (t) => {
      const method = await loadOwned(ClientContactMethod, id, methodId, t);
      if (!method) {
        const e = new Error("no encontrado");
        e.code = "NF";
        throw e;
      }
      const snapshot = serializeContactMethod(method);
      const wasPrimary = method.isPrimary;
      const kind = method.kind;
      await method.destroy({ transaction: t });
      if (wasPrimary) {
        // Promover el más antiguo restante del mismo tipo (si queda alguno).
        const next = await ClientContactMethod.findOne({
          where: { clientId: id, kind },
          order: [["createdAt", "ASC"]],
          transaction: t,
        });
        if (next) await next.update({ isPrimary: true }, { transaction: t });
      }
      await syncClientMirror({ client, ClientContactMethod, transaction: t });
      return snapshot;
    });

    await auditLog({
      tenantId: tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "client.contact_method.deleted",
      entity: "Client",
      entityId: id,
      before: removed,
      after: null,
      ip: request.headers.get("x-forwarded-for"),
    });
    return noContent();
  } catch (err) {
    if (err.code === "NF") return notFound("Método de contacto no encontrado");
    if (isMissingTable(err)) return error("Métodos de contacto no disponibles en este tenant.", 503);
    throw err;
  }
});
