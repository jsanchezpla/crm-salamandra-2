import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, forbidden, notFound, error } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { asegurarTipoDeCitaDeGrupo } from "../../../../../../lib/clinica/tipoCitaTaller.js";
import { serializarGrupo, guardarTerapeutas, limpiarIds } from "../../../../../../lib/clinica/grupoDeTaller.js";

/**
 * Los GRUPOS de una actividad (01/09/2026, Rodrigo: «en los talleres hay que
 * poder poner varios grupos distintos para la misma actividad»).
 *
 * «Habilidades sociales» son 45 niños en Aumenta, y 45 niños no caben en una
 * sala: son varios grupos, cada uno con su hora, su gente y quien lo lleva. La
 * actividad es el paraguas; lo que se apunta en la agenda y se cobra es el
 * grupo. El porqué entero, en `models/tenant/TallerGrupo.model.js`.
 *
 * Crear un grupo crea además su TIPO DE CITA (oculto), que es lo que hace que
 * el taller se pueda elegir en la agenda como uno más.
 */

// 42P01 = la tabla no existe en este schema (tenant sin la migración).
const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller, TallerGrupo, TallerGrupoTerapeuta, TallerInscripcion, TeamMember, EventType } = tenantModels;
  const { id } = await params;

  try {
    const taller = await Taller.findByPk(id);
    if (!taller) return notFound("Taller no encontrado");

    const grupos = await TallerGrupo.findAll({
      where: { tallerId: id },
      order: [["name", "ASC"]],
      include: [
        {
          model: TallerGrupoTerapeuta,
          as: "terapeutas",
          include: [{ model: TeamMember, as: "profesional", attributes: ["id", "displayName", "avatarColor"] }],
        },
      ],
    });

    // Apuntados AHORA por grupo, de una sola consulta (N+1 en una pantalla que
    // se abre a diario).
    const abiertas = await TallerInscripcion.findAll({
      where: { tallerId: id, leftAt: null },
      attributes: ["grupoId"],
    });
    const cuenta = {};
    for (const i of abiertas) if (i.grupoId) cuenta[i.grupoId] = (cuenta[i.grupoId] ?? 0) + 1;

    // Su tipo de cita, para poder decir en pantalla con qué nombre sale en la
    // agenda. Un centro sin Citas no tiene la tabla: se queda en null.
    const tipos = new Map();
    if (EventType && grupos.length) {
      try {
        const filas = await EventType.findAll({
          where: { tallerGrupoId: grupos.map((g) => g.id) },
          attributes: ["id", "name", "tallerGrupoId", "active"],
          raw: true,
        });
        for (const t of filas) tipos.set(t.tallerGrupoId, t);
      } catch (e) {
        if (!tablaAusente(e)) throw e;
      }
    }

    return ok({
      grupos: grupos.map((g) => serializarGrupo(g, { apuntados: cuenta[g.id] ?? 0, tipoCita: tipos.get(g.id) ?? null })),
      total: grupos.length,
    });
  } catch (err) {
    if (tablaAusente(err)) return ok({ grupos: [], total: 0, sinMigrar: true });
    throw err;
  }
});

export const POST = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clinica")) return forbidden();

  const { Taller, TallerGrupo } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const taller = await Taller.findByPk(id);
  if (!taller) return notFound("Taller no encontrado");
  if (!taller.active) return error("Ese taller está retirado: reactívalo antes de crear grupos", 409);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return error("El nombre del grupo es obligatorio", 422);

  const choca = await TallerGrupo.findOne({ where: { tallerId: id, name } });
  if (choca) return error(`Ya hay un grupo «${name}» en este taller`, 409, { id: choca.id });

  const grupo = await TallerGrupo.create({
    tallerId: id,
    name,
    schedule: typeof body.schedule === "string" ? body.schedule.trim() || null : null,
    duration: Number.isFinite(Number(body.duration)) ? Math.max(1, Math.min(480, Number(body.duration))) : 90,
    color: typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color.trim()) ? body.color.trim() : null,
    capacity: Number.isFinite(Number(body.capacity)) && Number(body.capacity) > 0 ? Number(body.capacity) : null,
    conceptId: typeof body.conceptId === "string" && body.conceptId ? body.conceptId : null,
    notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
  });

  await guardarTerapeutas({ tenantModels, grupo, ids: limpiarIds(body.terapeutas), coordinaId: body.coordinaId });

  // Y su tipo de cita: sin esto, el grupo no se podría elegir en la agenda,
  // que es de lo que iba el encargo.
  const tipoCita = await asegurarTipoDeCitaDeGrupo({ tenantModels, taller, grupo });

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "clinica.taller.grupo.creado",
    entity: "TallerGrupo",
    entityId: grupo.id,
    after: { tallerId: id, name: grupo.name },
  });

  const conTerapeutas = await TallerGrupo.findByPk(grupo.id, {
    include: [
      {
        model: tenantModels.TallerGrupoTerapeuta,
        as: "terapeutas",
        include: [{ model: tenantModels.TeamMember, as: "profesional", attributes: ["id", "displayName", "avatarColor"] }],
      },
    ],
  });

  return created(serializarGrupo(conTerapeutas ?? grupo, { apuntados: 0, tipoCita }));
});
