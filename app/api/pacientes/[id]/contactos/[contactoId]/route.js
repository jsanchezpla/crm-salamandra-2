import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../../../lib/utils/apiResponse.js";
import { logClinicaAudit } from "../../../../../../lib/clinica/audit.js";
import { vetoDeContactoExterno } from "../../../../../../lib/clinica/rotuloContactoExterno.js";

/**
 * /api/pacientes/[id]/contactos/[contactoId] — editar o borrar un contacto
 * externo del paciente.
 *
 * Al borrar, las actas de coordinación que lo referenciaban NO se borran: la FK
 * es ON DELETE SET NULL. Un acta es un documento clínico y no puede
 * desaparecer porque alguien limpie la agenda.
 */

const cap = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

async function buscar(ctx, id, contactoId) {
  const { ExternalContact } = ctx.tenantModels;
  if (!ExternalContact) return null;
  // Se filtra TAMBIÉN por paciente: sin eso, conociendo un id de contacto se
  // podría editar el de otro paciente pasando cualquier id en la ruta.
  return ExternalContact.findOne({ where: { id: contactoId, patientId: id } });
}

export const PATCH = withTenant(async (request, routeContext, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo clínico no disponible");
  const { id, contactoId } = await routeContext.params;
  if (!UUID_RE.test(String(id)) || !UUID_RE.test(String(contactoId))) {
    return error("Identificador inválido", 422);
  }

  const fila = await buscar(ctx, id, contactoId);
  if (!fila) return notFound("Contacto no encontrado");

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido", 400);
  }

  // Nombre O papel, la regla del modelo desde el 02/08/2026. Antes el nombre no
  // se podía vaciar, y eso dejaba sin arreglo los contactos que llegaron SIN él
  // del volcado de Organízate: para guardarles un teléfono había que inventarse
  // un nombre (AV-0102). Se mira contra lo que quedará en la fila, no solo
  // contra lo que manda el cuerpo, porque el PATCH es parcial.
  const updates = {};
  if ("name" in body) updates.name = cap(body.name, 200);
  if ("role" in body) updates.role = cap(body.role, 200);
  const veto = vetoDeContactoExterno({
    name: "name" in updates ? updates.name : fila.name,
    role: "role" in updates ? updates.role : fila.role,
  });
  if (veto) return error(veto, 422);
  if ("email" in body) updates.email = cap(body.email, 255);
  if ("phone" in body) updates.phone = cap(body.phone, 50);
  if ("entity" in body) updates.entity = cap(body.entity, 200);
  if ("notes" in body) updates.notes = cap(body.notes, 2000);

  if (Object.keys(updates).length === 0) return ok({ id: contactoId });

  await fila.update(updates);
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.contacto_externo.updated",
    entity: "ExternalContact",
    entityId: contactoId,
    after: { paciente: id, campos: Object.keys(updates) },
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok({ id: contactoId });
});

export const DELETE = withTenant(async (request, routeContext, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo clínico no disponible");
  const { id, contactoId } = await routeContext.params;
  if (!UUID_RE.test(String(id)) || !UUID_RE.test(String(contactoId))) {
    return error("Identificador inválido", 422);
  }

  const fila = await buscar(ctx, id, contactoId);
  if (!fila) return notFound("Contacto no encontrado");

  const nombre = fila.name;
  await fila.destroy();

  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.contacto_externo.deleted",
    entity: "ExternalContact",
    entityId: contactoId,
    before: { paciente: id, nombre },
    ip: request.headers.get("x-forwarded-for"),
  });
  return ok({ id: contactoId, deleted: true });
});
