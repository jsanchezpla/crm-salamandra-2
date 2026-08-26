import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";
import { ok, noContent, forbidden, error } from "../../../../lib/utils/apiResponse.js";
import { NotFoundError, ForbiddenError } from "../../../../lib/utils/errors.js";
import { aceptaEtapa, etapaAlGanar, etapasDe } from "../../../../lib/leads/embudos.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar leads";

async function resolveLead(tenantModels, id) {
  const { Lead } = tenantModels;
  const lead = await Lead.findByPk(id);
  if (!lead) throw new NotFoundError("Lead no encontrado");
  return lead;
}

export const GET = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("leads")) throw new ForbiddenError();
  const { id } = await params;
  const lead = await resolveLead(tenantModels, id);
  return ok(lead);
});

export const PATCH = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("leads")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);
  const { id } = await params;
  const lead = await resolveLead(tenantModels, id);
  const body = await request.json();

  const allowed = [
    "name",
    "phone",
    "email",
    "title",
    "stage",
    "probability",
    "value",
    "expectedCloseDate",
    "assignedTo",
    "notes",
    "customFields",
    "clientId",
    "tipo_usuario",
    "motivo",
    "servicio",
    "curso",
    "taller",
    "mensaje",
  ];

  const updates = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  /*
   * La etapa se valida contra el EMBUDO DE ESTE CLIENTE (26/08/2026), no contra
   * la lista canónica: aquella dice qué etapas existen en el CRM (veinte), no
   * cuáles ofrece este embudo (entre cuatro y siete). Con la general, se podía
   * mover a alguien a una etapa que su pantalla no tiene, y ese lead salía con
   * su chip pero sin fila — y los contadores de la cabecera dejaban de sumar.
   *
   * Y se DICE, en vez de tirarla en silencio como hasta hoy: pedir una etapa,
   * recibir un 200 y que no haya cambiado nada es de los fallos que se tardan
   * horas en entender.
   */
  if ("stage" in updates && !aceptaEtapa(tenant.slug, updates.stage, hasModule)) {
    return error(
      `«${updates.stage}» no es una etapa de este embudo. Las suyas: ${etapasDe(tenant.slug, hasModule).join(", ")}.`,
      422
    );
  }

  if ("email" in updates) updates.email = updates.email?.trim().toLowerCase() || null;

  // Validar clientId: null para desvincular, o UUID que exista en el tenant.
  if ("clientId" in updates) {
    if (updates.clientId === null || updates.clientId === "") {
      updates.clientId = null;
    } else {
      const { Client } = tenantModels;
      const exists = await Client.findByPk(updates.clientId, { attributes: ["id"] });
      if (!exists) delete updates.clientId;
    }
  }

  /*
   * QUE LO MARQUE EL CRM SOLO (26/08/2026, Jorge).
   *
   * En cuanto un interesado queda enlazado a una ficha, el CRM lo mueve él
   * mismo a la etapa de ganado de SU embudo — «Ya es paciente» en un centro
   * clínico, «Convertido» en una consultora, y nada en booking, donde ganar es
   * que se cierre la fecha y no que el contratante tenga ficha.
   *
   * Hasta hoy lo decidía el navegador: la pantalla de Laura mandaba `paciente`
   * a mano y la de spain_enzymes `won`. Eso dejaba dos agujeros. Uno, que una
   * pantalla sin esa línea escrita —la de Aumenta— no podía marcar a nadie por
   * bien que fuera. Y dos, que el navegador hace DOS llamadas (crear la ficha y
   * mover el interesado) y está documentado que la segunda puede fallar: la
   * ficha quedaba creada y el embudo diciendo que aquello seguía pendiente.
   *
   * Tres condiciones, y las tres importan:
   *   · Solo al ENLAZAR, no al desenlazar ni al guardar otra cosa.
   *   · Solo si NO venía ya enlazado, para que reenlazar a otra ficha no
   *     rebobine a alguien que su equipo había movido a mano después.
   *   · Solo si quien llama no manda etapa. Si la manda, gana ella: las dos
   *     pantallas que ya convertían siguen mandando la suya y no se les cambia
   *     el comportamiento por debajo.
   */
  if (!("stage" in updates) && updates.clientId && !lead.clientId) {
    const ganada = etapaAlGanar(tenant.slug, hasModule);
    if (ganada) updates.stage = ganada;
  }

  // Merge customFields en lugar de sobreescribir  // Merge customFields en lugar de sobreescribir
  if (updates.customFields) {
    updates.customFields = { ...(lead.customFields ?? {}), ...updates.customFields };
  }

  const antes = resumen(lead, ["name", "email", "stage", "value"]);
  await lead.update(updates);
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "lead.updated",
    entity: "Lead",
    entityId: lead.id,
    before: antes,
    after: resumen(lead, ["name", "email", "stage", "value"]),
  });
  return ok(lead);
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("leads")) throw new ForbiddenError();
  const role = request.headers.get("x-user-role");
  if (!ADMIN_ROLES.has(role)) return forbidden(ADMIN_DENY);
  const { id } = await params;
  const lead = await resolveLead(tenantModels, id);
  const antesBorrar = resumen(lead, ["name", "email", "stage", "value"]);
  const idLead = lead.id;
  await lead.destroy();
  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "lead.deleted",
    entity: "Lead",
    entityId: idLead,
    before: antesBorrar,
  });
  return noContent();
});
