import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../../lib/db/masterDb.js";
import {
  CONTACT_KINDS,
  normalizeContactValue,
  normalizeLabel,
  validateContactValue,
  syncClientMirror,
  serializeContactMethod,
  isMissingTable,
} from "../../../../../lib/clients/contactMethods.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function auditLog(data) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create(data);
  } catch {
    /* auditoría best-effort */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/clients/[id]/contact-methods
// → { methods: [{ id, kind, value, label, isPrimary }] } (principal primero)
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();
  const { Client, ClientContactMethod } = tenantModels;
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("id inválido", 422);

  const client = await Client.findByPk(id, { attributes: ["id"] });
  if (!client) return notFound("Cliente no encontrado");

  if (!ClientContactMethod) return ok({ methods: [] });
  try {
    const rows = await ClientContactMethod.findAll({
      where: { clientId: id },
      order: [["kind", "ASC"], ["isPrimary", "DESC"], ["createdAt", "ASC"]],
    });
    return ok({ methods: rows.map(serializeContactMethod) });
  } catch (err) {
    // Tenant sin la tabla todavía (migración pendiente): degradar a lista vacía.
    if (isMissingTable(err)) return ok({ methods: [] });
    throw err;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/clients/[id]/contact-methods
// Body: { kind: 'email'|'phone', value, label?, isPrimary? }
//   - El primer método de un tipo es SIEMPRE principal.
//   - Si isPrimary=true, se degrada el principal anterior de ese tipo (índice
//     parcial único: como mucho un principal por (cliente, tipo)).
//   - El principal se refleja en Client.email / Client.phone.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, { params }, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  if (!hasModule("clients")) return forbidden();
  const { Client, ClientContactMethod } = tenantModels;
  if (!ClientContactMethod) return error("Métodos de contacto no disponibles en este tenant (migración pendiente).", 503);
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("id inválido", 422);

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  const body = await request.json().catch(() => null);
  const kind = String(body?.kind ?? "").trim();
  if (!CONTACT_KINDS.includes(kind)) return error(`kind inválido (email|phone)`, 422);
  const value = normalizeContactValue(kind, body?.value);
  const invalid = validateContactValue(kind, value);
  if (invalid) return error(invalid, 422);
  const label = normalizeLabel(body?.label);

  try {
    const row = await tenantSequelize.transaction(async (t) => {
      // Dedup: no repetir el mismo valor del mismo tipo para el cliente.
      const dup = await ClientContactMethod.findOne({ where: { clientId: id, kind, value }, transaction: t });
      if (dup) {
        const e = new Error("Ya existe ese contacto");
        e.code = "DUP";
        throw e;
      }
      const count = await ClientContactMethod.count({ where: { clientId: id, kind }, transaction: t });
      const wantPrimary = count === 0 ? true : !!body?.isPrimary;
      if (wantPrimary) {
        // Degradar el principal anterior ANTES de insertar (índice parcial no
        // diferido: no puede haber dos is_primary=true a la vez).
        await ClientContactMethod.update(
          { isPrimary: false },
          { where: { clientId: id, kind, isPrimary: true }, transaction: t }
        );
      }
      const createdRow = await ClientContactMethod.create(
        { clientId: id, kind, value, label, isPrimary: wantPrimary },
        { transaction: t }
      );
      await syncClientMirror({ client, ClientContactMethod, transaction: t });
      return createdRow;
    });

    await auditLog({
      tenantId: tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "client.contact_method.created",
      entity: "Client",
      entityId: id,
      before: null,
      after: serializeContactMethod(row),
      ip: request.headers.get("x-forwarded-for"),
    });
    return created(serializeContactMethod(row));
  } catch (err) {
    if (err.code === "DUP") return error("Ya existe ese contacto para el cliente", 409);
    // Colisión del índice parcial único (dos "principal" a la vez por carrera).
    if (err.name === "SequelizeUniqueConstraintError") return error("Conflicto al guardar el contacto, reinténtalo", 409);
    if (isMissingTable(err)) return error("Métodos de contacto no disponibles en este tenant (migración pendiente).", 503);
    throw err;
  }
});
