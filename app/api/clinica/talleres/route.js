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

  const { Taller, TallerInscripcion, TeamMember, BillingConcept } = tenantModels;
  const { searchParams } = new URL(request.url);
  const verInactivos = searchParams.get("verInactivos") === "1";

  try {
    const talleres = await Taller.findAll({
      where: verInactivos ? {} : { active: true },
      order: [["name", "ASC"]],
      include: [{ model: TeamMember, as: "responsable", attributes: ["id", "displayName"] }],
    });

    // Apuntados AHORA, de una sola consulta: con un include por taller esto
    // serían N+1 consultas en una pantalla que se abre a diario.
    const abiertas = await TallerInscripcion.findAll({
      where: { leftAt: null },
      attributes: ["tallerId"],
    });
    const cuenta = {};
    for (const i of abiertas) cuenta[i.tallerId] = (cuenta[i.tallerId] ?? 0) + 1;

    // El concepto de cobro de cada taller (31/08/2026), colgado a mano: no
    // hay asociación (FK suave a propósito) y un concepto borrado sale null.
    const conceptIds = [...new Set(talleres.map((t) => t.conceptId).filter(Boolean))];
    const conceptos = new Map();
    if (BillingConcept && conceptIds.length) {
      const filas = await BillingConcept.findAll({
        where: { id: conceptIds },
        attributes: ["id", "name", "unitPrice", "periodicity"],
        raw: true,
      });
      for (const c of filas) conceptos.set(c.id, c);
    }

    return ok({
      talleres: talleres.map((t) => ({
        ...t.toJSON(),
        apuntados: cuenta[t.id] ?? 0,
        concepto: (t.conceptId && conceptos.get(t.conceptId)) || null,
      })),
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

  const { Taller, BillingConcept } = tenantModels;
  const body = await request.json();

  const name = body.name?.trim();
  if (!name) return error("El nombre del taller es obligatorio", 422);

  // El concepto de cobro, opcional (31/08/2026): un id que no existe se
  // descarta en vez de guardar un enlace roto.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let conceptId = null;
  if (typeof body.conceptId === "string" && UUID_RE.test(body.conceptId) && BillingConcept) {
    const c = await BillingConcept.findByPk(body.conceptId, { attributes: ["id"] });
    if (c) conceptId = body.conceptId;
  }

  const yaExiste = await Taller.findOne({ where: { name: { [Op.iLike]: name } } });
  if (yaExiste) return error(`Ya existe un taller llamado «${yaExiste.name}»`, 409, { id: yaExiste.id });

  const taller = await Taller.create({
    name,
    description: body.description?.trim() || null,
    teamMemberId: body.teamMemberId || null,
    schedule: body.schedule?.trim() || null,
    notes: body.notes?.trim() || null,
    conceptId,
  });

  return created({ ...taller.toJSON(), apuntados: 0 });
});
