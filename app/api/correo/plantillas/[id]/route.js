import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { normalizarPlantilla } from "../../../../../lib/correo/plantillas.js";

/** PUT (reescribir) y DELETE de una plantilla de correo del centro. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function puedeUsarCorreo(ctx) {
  return ctx.hasModule("clients") || ctx.hasModule("outreach");
}

async function plantillaDe(ctx, rc) {
  const { id } = await rc.params;
  if (!UUID_RE.test(String(id ?? ""))) throw new ValidationError("Identificador inválido");
  const plantilla = await ctx.tenantModels.CorreoPlantilla.findByPk(id);
  if (!plantilla) throw new NotFoundError("Esa plantilla ya no existe");
  return plantilla;
}

export const PUT = withTenant(async (request, rc, ctx) => {
  if (!puedeUsarCorreo(ctx)) throw new ForbiddenError();
  const plantilla = await plantillaDe(ctx, rc);

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  // El PUT reescribe la plantilla entera (nombre, asunto y cuerpo): es lo que
  // hace el botón «Actualizar plantilla» de la pantalla, y un parche a medias
  // dejaría plantillas con el asunto de una versión y el cuerpo de otra.
  const p = normalizarPlantilla({ nombre: body?.nombre ?? plantilla.nombre, asunto: body?.asunto, cuerpo: body?.cuerpo });
  if (p.error) throw new ValidationError(p.error);

  const antes = { nombre: plantilla.nombre };
  await plantilla.update({ nombre: p.nombre, asunto: p.asunto, cuerpo: p.cuerpo });

  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "correo.plantilla_actualizada",
    entity: "correo_plantilla",
    entityId: plantilla.id,
    before: antes,
    after: { nombre: plantilla.nombre },
  });

  return ok({
    plantilla: {
      id: plantilla.id,
      nombre: plantilla.nombre,
      asunto: plantilla.asunto ?? "",
      cuerpo: plantilla.cuerpo ?? "",
    },
  });
});

export const DELETE = withTenant(async (request, rc, ctx) => {
  if (!puedeUsarCorreo(ctx)) throw new ForbiddenError();
  const plantilla = await plantillaDe(ctx, rc);

  const resumen = { nombre: plantilla.nombre };
  await plantilla.destroy();

  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "correo.plantilla_borrada",
    entity: "correo_plantilla",
    entityId: plantilla.id,
    before: resumen,
  });

  return ok({ borrada: true });
});
