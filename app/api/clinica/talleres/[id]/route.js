import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, forbidden, notFound, error } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../lib/utils/auditoria.js";
import { Op } from "sequelize";

/** Ficha del taller: sus datos y quién está apuntado (ahora y antes). */
export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller, TallerInscripcion, Patient, TeamMember } = tenantModels;
  const { id } = await params;

  const taller = await Taller.findByPk(id, {
    include: [{ model: TeamMember, as: "responsable", attributes: ["id", "name"] }],
  });
  if (!taller) return notFound("Taller no encontrado");

  const inscripciones = await TallerInscripcion.findAll({
    where: { tallerId: id },
    order: [["joinedAt", "DESC"]],
    include: [{ model: Patient, as: "patient", attributes: ["id", "firstName", "lastName"] }],
  });

  return ok({
    ...taller.toJSON(),
    // Separados a propósito: al abrir un taller lo que se quiere ver es quién
    // está AHORA; los que pasaron por él son consulta de histórico.
    apuntados: inscripciones.filter((i) => !i.leftAt),
    pasaron: inscripciones.filter((i) => i.leftAt),
  });
});

export const PUT = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const taller = await Taller.findByPk(id);
  if (!taller) return notFound("Taller no encontrado");

  if ("name" in body) {
    const name = body.name?.trim();
    if (!name) return error("El nombre del taller es obligatorio", 422);
    const choca = await Taller.findOne({ where: { name: { [Op.iLike]: name }, id: { [Op.ne]: id } } });
    if (choca) return error(`Ya existe otro taller llamado «${choca.name}»`, 409, { id: choca.id });
    body.name = name;
  }

  const cambios = {};
  if ("name" in body) cambios.name = body.name;
  for (const c of ["description", "schedule", "notes"]) if (c in body) cambios[c] = body[c]?.trim() || null;
  if ("teamMemberId" in body) cambios.teamMemberId = body.teamMemberId || null;
  if ("active" in body) cambios.active = !!body.active;

  await taller.update(cambios);
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "clinica.taller.updated",
    entity: "Taller",
    entityId: taller.id,
    after: resumen(taller, ["name", "active"]),
  });

  return ok(taller);
});

/**
 * Retirar un taller. NO lo borra si alguien pasó por él: sus inscripciones son
 * historial del paciente y borrarlas dejaría huecos sin explicación.
 */
export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller, TallerInscripcion } = tenantModels;
  const { id } = await params;

  const taller = await Taller.findByPk(id);
  if (!taller) return notFound("Taller no encontrado");

  const usos = await TallerInscripcion.count({ where: { tallerId: id } });
  if (usos > 0) {
    await taller.update({ active: false });
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "clinica.taller.deactivated",
      entity: "Taller",
      entityId: taller.id,
      before: resumen(taller, ["name", "active"]),
    });
    return ok({ desactivado: true, usos, mensaje: `Retirado: han pasado ${usos} paciente(s) por él` });
  }

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "clinica.taller.deleted",
    entity: "Taller",
    entityId: taller.id,
    before: resumen(taller, ["name"]),
  });
  await taller.destroy();
  return ok({ eliminado: true });
});
