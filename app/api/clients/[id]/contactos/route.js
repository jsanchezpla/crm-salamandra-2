import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { created, ok } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/utils/errors.js";

/**
 * /api/clients/:id/contactos — las PERSONAS de una ficha.
 *
 * ── POR QUÉ NACE ESTO ──────────────────────────────────────────────────────
 * El modelo `Contact` existía desde el principio pero solo lo enseñaba el
 * módulo clínico, en `/api/pacientes/:id/contactos`. Quien no tuviera Pacientes
 * podía tener contactos guardados y no verlos en ninguna pantalla.
 *
 * Se destapó el 24/08/2026 al separar la organización de la persona en los
 * contratantes de Laura Úbeda (Rodrigo: «la empresa y el nombre deberían estar
 * separados»): se cargaron 38 personas y buzones y no había dónde mirarlos.
 * Separar sin poder ver es peor que no separar.
 *
 * ── POR QUÉ NO SE REUTILIZA EL DE PACIENTES ────────────────────────────────
 * Porque aquel cuelga de un `patient`, no de un `client`, y exige el módulo
 * `pacientes`. Son la misma tabla y dos puertas distintas a propósito: en un
 * centro clínico los contactos son la familia del paciente; aquí son el
 * concejal de Cultura y el técnico de sonido de una sala.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fichaOFalla(ctx, id) {
  if (!UUID_RE.test(id ?? "")) throw new ValidationError("Identificador inválido");
  const { Client } = ctx.tenantModels;
  const ficha = await Client.findByPk(id, { attributes: ["id"] });
  if (!ficha) throw new NotFoundError("Ficha no encontrada");
  return ficha;
}

/** GET — las personas de esta ficha, la principal primero. */
export const GET = withTenant(async (_request, { params }, ctx) => {
  if (!ctx.hasModule("clients")) throw new ForbiddenError();
  const { id } = await params;
  await fichaOFalla(ctx, id);

  const { Contact } = ctx.tenantModels;
  const contactos = await Contact.findAll({
    where: { clientId: id },
    attributes: ["id", "name", "role", "email", "phone", "isPrimary", "notes"],
    order: [
      ["isPrimary", "DESC"],
      ["name", "ASC"],
    ],
  });

  return ok({ contactos });
});

/** POST — añadir una persona a la ficha. */
export const POST = withTenant(async (request, { params }, ctx) => {
  if (!ctx.hasModule("clients")) throw new ForbiddenError();
  const { id } = await params;
  await fichaOFalla(ctx, id);

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const name = String(body?.name ?? "").trim();
  if (!name) throw new ValidationError("El nombre no puede quedar vacío");

  const email = String(body?.email ?? "").trim().toLowerCase() || null;
  // El modelo valida `isEmail`, así que un correo mal escrito reventaría con un
  // error de Sequelize en crudo. Mejor decirlo en cristiano.
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ValidationError("Ese correo no parece un correo");
  }

  const { Contact } = ctx.tenantModels;
  const contacto = await Contact.create({
    clientId: id,
    name: name.slice(0, 200),
    role: String(body?.role ?? "").trim().slice(0, 120) || null,
    email,
    phone: String(body?.phone ?? "").trim().slice(0, 40) || null,
    isPrimary: !!body?.isPrimary,
    notes: String(body?.notes ?? "").trim() || null,
  });

  return created({ contacto });
});
