import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { autorDe, exigirMailing, leerBody, serializarPlantilla, texto } from "../../../../lib/mailing/comun.js";
import { normalizarBloques } from "../../../../lib/mailing/bloques.js";

/**
 * /api/mailing/plantillas — firmas y campañas guardadas como plantilla.
 *
 * `tipo` = "firma" (un bloque de firma que el editor inserta con un clic) o
 * "campana" (un correo entero del que partir). Mismo formato de bloques que
 * una campaña, saneado al guardar.
 */
const TIPOS = new Set(["firma", "campana"]);

export const GET = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const tipo = new URL(request.url).searchParams.get("tipo");
  const where = TIPOS.has(tipo) ? { tipo } : {};
  const filas = await ctx.tenantModels.MailingTemplate.findAll({ where, order: [["tipo", "ASC"], ["nombre", "ASC"]] });
  return ok({ plantillas: filas.map(serializarPlantilla) });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const body = await leerBody(request);
  const tipo = TIPOS.has(body.tipo) ? body.tipo : "campana";
  const nombre = texto(body.nombre, 120, { requerido: true, nombre: "El nombre de la plantilla" });
  const bloques = normalizarBloques(body.bloques);
  if (tipo === "firma" && !bloques.some((b) => b.tipo === "firma")) {
    throw new ValidationError("Una plantilla de firma tiene que llevar un bloque de firma");
  }
  const plantilla = await ctx.tenantModels.MailingTemplate.create({
    nombre,
    tipo,
    asunto: tipo === "campana" ? texto(body.asunto, 200) : null,
    preheader: tipo === "campana" ? texto(body.preheader, 200) : null,
    bloques: tipo === "firma" ? bloques.filter((b) => b.tipo === "firma").slice(0, 1) : bloques,
    createdBy: autorDe(request),
  });
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.plantilla.created",
    entity: "mailing_template",
    entityId: plantilla.id,
    after: { nombre: plantilla.nombre, tipo },
  });
  return ok({ plantilla: serializarPlantilla(plantilla) });
});
