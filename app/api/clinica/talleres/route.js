import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, error } from "../../../../lib/utils/apiResponse.js";
import { Op } from "sequelize";

/**
 * Talleres — actividades de grupo a las que se apunta quien quiere.
 *
 * No son especialidades: ver la cabecera de `models/tenant/Taller.model.js`.
 * El listado trae cuánta gente hay apuntada AHORA (inscripciones sin fecha de
 * baja), que es lo primero que se mira al abrir la pantalla.
 */

// 42P01 = la tabla no existe en este schema (tenant sin la migración).
const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller, TallerInscripcion, TeamMember } = tenantModels;
  const { searchParams } = new URL(request.url);
  const verInactivos = searchParams.get("verInactivos") === "1";

  try {
    const talleres = await Taller.findAll({
      where: verInactivos ? {} : { active: true },
      order: [["name", "ASC"]],
      include: [{ model: TeamMember, as: "responsable", attributes: ["id", "name"] }],
    });

    // Apuntados AHORA, de una sola consulta: con un include por taller esto
    // serían N+1 consultas en una pantalla que se abre a diario.
    const abiertas = await TallerInscripcion.findAll({
      where: { leftAt: null },
      attributes: ["tallerId"],
    });
    const cuenta = {};
    for (const i of abiertas) cuenta[i.tallerId] = (cuenta[i.tallerId] ?? 0) + 1;

    return ok({
      talleres: talleres.map((t) => ({ ...t.toJSON(), apuntados: cuenta[t.id] ?? 0 })),
      total: talleres.length,
    });
  } catch (err) {
    // Un tenant al que aún no le ha llegado la migración ve la pantalla vacía,
    // no un error rojo.
    if (tablaAusente(err)) return ok({ talleres: [], total: 0, sinMigrar: true });
    throw err;
  }
});

export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller } = tenantModels;
  const body = await request.json();

  const name = body.name?.trim();
  if (!name) return error("El nombre del taller es obligatorio", 422);

  const yaExiste = await Taller.findOne({ where: { name: { [Op.iLike]: name } } });
  if (yaExiste) return error(`Ya existe un taller llamado «${yaExiste.name}»`, 409, { id: yaExiste.id });

  const taller = await Taller.create({
    name,
    description: body.description?.trim() || null,
    teamMemberId: body.teamMemberId || null,
    schedule: body.schedule?.trim() || null,
    notes: body.notes?.trim() || null,
  });

  return created({ ...taller.toJSON(), apuntados: 0 });
});
