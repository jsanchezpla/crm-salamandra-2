import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { buscarOFallar, exigirMailing, idDeRuta, leerBody, serializarPlantilla, texto } from "../../../../../lib/mailing/comun.js";
import { normalizarBloques } from "../../../../../lib/mailing/bloques.js";

/** PATCH y DELETE de una plantilla (firma o campaña guardada). */
export const PATCH = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const plantilla = await buscarOFallar(ctx.tenantModels.MailingTemplate, id, "Esa plantilla");
  const body = await leerBody(request);
  const cambios = {};
  if ("nombre" in body) cambios.nombre = texto(body.nombre, 120, { requerido: true, nombre: "El nombre de la plantilla" });
  if ("asunto" in body && plantilla.tipo === "campana") cambios.asunto = texto(body.asunto, 200);
  if ("preheader" in body && plantilla.tipo === "campana") cambios.preheader = texto(body.preheader, 200);
  if ("bloques" in body) {
    const bloques = normalizarBloques(body.bloques);
    if (plantilla.tipo === "firma" && !bloques.some((b) => b.tipo === "firma")) {
      throw new ValidationError("Una plantilla de firma tiene que llevar un bloque de firma");
    }
    cambios.bloques = plantilla.tipo === "firma" ? bloques.filter((b) => b.tipo === "firma").slice(0, 1) : bloques;
  }
  if (!Object.keys(cambios).length) throw new ValidationError("No hay nada que cambiar");
  await plantilla.update(cambios);
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.plantilla.updated",
    entity: "mailing_template",
    entityId: plantilla.id,
    after: { nombre: plantilla.nombre, campos: Object.keys(cambios) },
  });
  return ok({ plantilla: serializarPlantilla(plantilla) });
});

export const DELETE = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const plantilla = await buscarOFallar(ctx.tenantModels.MailingTemplate, id, "Esa plantilla");
  const antes = { nombre: plantilla.nombre, tipo: plantilla.tipo };
  await plantilla.destroy();
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.plantilla.deleted",
    entity: "mailing_template",
    entityId: id,
    before: antes,
  });
  return ok({ borrado: true });
});
