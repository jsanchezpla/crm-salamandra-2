import { Op } from "sequelize";
import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { readDocumentBuffer } from "@/lib/documents/documentStorage.js";
import { textoDePdf } from "@/lib/documents/textoDePdf.js";
import { esInforme, rellenoDesdeInformes } from "@/lib/clinica/planDesdeInformes.js";
import { listaDe, terapeutasEfectivos } from "@/lib/clinica/terapeutas.js";
import { normalizeSpecialties } from "@/lib/clinica/specialties.js";

/**
 * GET /api/pacientes/[id]/plan/desde-informes — el motivo de consulta (y el
 * diagnóstico, si viene con su nombre) que el Plan puede traer de los informes
 * PDF subidos al paciente (15/09/2026, AV-0103 de Silvia).
 *
 * Gemelo de `desde-entrevista`: sin IA, NO ESCRIBE, y solo propone lo que en el
 * plan guardado está vacío. Lo que se acepte se guarda por el «Guardar plan» de
 * siempre. Las reglas de qué se copia y a qué terapia va viven en
 * `lib/clinica/planDesdeInformes.js`.
 *
 * Los documentos son los mismos que la pestaña Documentos del paciente enseña a
 * cualquiera con Clínica o Pacientes, así que no abre nada que no se viera ya.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Del más nuevo al más viejo, y no más: el más reciente de cada terapia es el
// que manda, y un paciente con veinte informes no tiene que esperar a los veinte.
const MAX_INFORMES = 12;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Document, InterventionPlan, Patient, TeamMember } = ctx.tenantModels;
    const paciente = await Patient.findByPk(id, { attributes: ["id", "mainTherapistId"] });
    if (!paciente) return notFound("Paciente no encontrado");

    const filas = await Document.findAll({
      where: {
        patientId: id,
        source: "paciente",
        mimeType: "application/pdf",
        fileName: { [Op.iLike]: "%informe%" },
      },
      attributes: ["id", "fileName", "storagePath", "documentDate", "createdAt"],
      order: [["documentDate", "DESC NULLS LAST"], ["createdAt", "DESC"]],
      limit: MAX_INFORMES,
    });
    const docs = filas.map((f) => f.toJSON()).filter((d) => esInforme(d.fileName));
    if (!docs.length) return ok({ hayInformes: false });

    /*
     * Las terapeutas del paciente y sus especialidades: la de la asignación si
     * la tiene (104 de 655 en Aumenta) y, si no, las de su ficha de equipo.
     */
    const equipo = await listaDe(ctx.tenantModels, ctx.tenantSequelize, [id]);
    const efectivos = terapeutasEfectivos(paciente, equipo[id]);
    const fichas = efectivos.length
      ? await TeamMember.findAll({ where: { id: { [Op.in]: efectivos.map((t) => t.teamMemberId) } }, attributes: ["id", "specialties"], raw: true })
      : [];
    const especialidadesDe = new Map(fichas.map((m) => [m.id, normalizeSpecialties(m.specialties)]));
    const terapeutas = efectivos.map((t) => ({
      id: t.teamMemberId,
      especialidades: t.specialty ? [t.specialty] : especialidadesDe.get(t.teamMemberId) ?? [],
    }));

    const informes = [];
    for (const d of docs) {
      let leido;
      try {
        leido = await textoDePdf(await readDocumentBuffer(ctx.tenant.slug, d.storagePath));
      } catch {
        leido = { texto: null, problema: "sin texto" }; // el fichero no está en disco
      }
      informes.push({ fileName: d.fileName, fecha: d.documentDate ?? null, ...leido });
    }

    const plan = InterventionPlan
      ? await InterventionPlan.findOne({
          where: { patientId: id },
          attributes: ["diagnosis", "consultationReasons", "consultationReasonsByTherapist"],
        }).catch(() => null)
      : null;

    return ok({ hayInformes: true, ...rellenoDesdeInformes(plan?.toJSON?.() ?? {}, terapeutas, informes) });
  } catch (err) {
    return serverError(err);
  }
});
