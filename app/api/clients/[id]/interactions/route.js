import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, notFound, error } from "../../../../../lib/utils/apiResponse.js";

const VALID_TYPES = ["call", "email", "meeting", "note"];

export const GET = withTenant(async (_request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Interaction } = tenantModels;
  const { id } = await params;

  const interactions = await Interaction.findAll({
    where: { clientId: id },
    order: [["date", "DESC"], ["createdAt", "DESC"]],
  });

  return ok(interactions);
});

export const POST = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, Interaction } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  const { type, content, date, createdBy } = body;
  if (!content?.trim()) return error("El contenido es obligatorio", 422);
  if (!date) return error("La fecha es obligatoria", 422);

  const interaction = await Interaction.create({
    clientId: id,
    type: VALID_TYPES.includes(type) ? type : "note",
    content: content.trim(),
    date,
    createdBy: createdBy?.trim() || null,
  });

  return created(interaction);
});
