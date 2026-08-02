import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound } from "../../../../../lib/utils/apiResponse.js";
import { logClinicaAudit } from "../../../../../lib/clinica/audit.js";

/**
 * /api/pacientes/[id]/contactos — agenda de profesionales EXTERNOS del paciente.
 *
 * La orientadora del instituto, la tutora del cole, el psiquiatra… gente de
 * fuera con la que se coordina el caso. Antes se escribían a mano en cada acta
 * de coordinación (`Coordination.participants`), así que el mismo nombre se
 * reescribía una y otra vez y su teléfono no vivía en ninguna parte.
 *
 *   GET  → la agenda del paciente
 *   POST → añade un contacto (solo el nombre es obligatorio)
 */

const cap = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Misma puerta que el resto del módulo clínico: Pacientes (el dato) y Clínica
// (las acciones) son una sola superficie.
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

const serializar = (c) => ({
  id: c.id,
  name: c.name,
  role: c.role,
  email: c.email,
  phone: c.phone,
  entity: c.entity,
  notes: c.notes,
  createdAt: c.createdAt,
});

export const GET = withTenant(async (request, routeContext, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo clínico no disponible");
  const { id } = await routeContext.params;
  if (!UUID_RE.test(String(id))) return error("Identificador inválido", 422);

  const { ExternalContact } = ctx.tenantModels;
  if (!ExternalContact) return ok({ contactos: [] });

  // La tabla puede no existir todavía: entre desplegar el código y correr
  // `migrate-external-contacts` hay una ventana en la que el modelo está
  // registrado pero `external_contacts` no está creada en ese schema. Sin este
  // guard, la ficha del paciente entera respondería 500 en esa ventana — y el
  // mismo criterio que usa `lib/clients/listaEspera.js` para su cola.
  let filas;
  try {
    filas = await ExternalContact.findAll({
      where: { patientId: id },
      order: [["name", "ASC"]],
      limit: 200,
    });
  } catch (err) {
    if (/does not exist|no existe/i.test(err?.message ?? "")) return ok({ contactos: [] });
    throw err;
  }
  return ok({ contactos: filas.map(serializar) });
});

export const POST = withTenant(async (request, routeContext, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo clínico no disponible");
  const { id } = await routeContext.params;
  if (!UUID_RE.test(String(id))) return error("Identificador inválido", 422);

  const { ExternalContact, Patient } = ctx.tenantModels;
  if (!ExternalContact) return error("La agenda de contactos no está disponible", 503);

  // Se comprueba que el paciente existe ANTES de crear: sin esto, un id
  // equivocado dejaría contactos colgando de nadie, invisibles para siempre.
  const paciente = await Patient.findByPk(id, { attributes: ["id", "clientId"] });
  if (!paciente) return notFound("Paciente no encontrado");

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido", 400);
  }

  const name = cap(body?.name, 200);
  if (!name) return error("El nombre es obligatorio", 422);

  const fila = await ExternalContact.create({
    patientId: id,
    // Foto del cliente al crear, igual que el resto de registros clínicos: el
    // salto paciente→cliente es frágil (clientId es nullable y a menudo vacío).
    clientId: paciente.clientId ?? null,
    name,
    role: cap(body?.role, 200),
    email: cap(body?.email, 255),
    phone: cap(body?.phone, 50),
    entity: cap(body?.entity, 200),
    notes: cap(body?.notes, 2000),
  });

  // Se audita el ALTA pero no el contenido: son datos de contacto de terceros
  // (profesionales de un menor) y la tabla de auditoría vive en master,
  // compartida por todos los clientes.
  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "clinica.contacto_externo.created",
    entity: "ExternalContact",
    entityId: fila.id,
    after: { paciente: id, tiene_rol: !!fila.role },
    ip: request.headers.get("x-forwarded-for"),
  });

  return created({ contacto: serializar(fila) });
});
