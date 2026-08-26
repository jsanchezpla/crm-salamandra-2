import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { normalizarPlantilla } from "../../../../lib/correo/plantillas.js";

/**
 * /api/correo/plantillas — plantillas de correo escritas por el centro.
 *
 * Pedidas por Rodrigo el 26/08/2026: «hay que poder crear plantillas de correo
 * ilimitadas». Sin tope de cuántas, a propósito; lo acotado es cada campo, con
 * los MISMOS topes que el envío (asunto 200, cuerpo 20.000) — una plantilla que
 * no cupiera en un envío sería una promesa rota.
 *
 * Son del centro, como las listas y los remitentes: quien escribe correos las
 * ve todas. No confundir con `lib/email/templates/` (las de sistema).
 */

function puedeUsarCorreo(ctx) {
  return ctx.hasModule("clients") || ctx.hasModule("outreach");
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  if (!puedeUsarCorreo(ctx)) throw new ForbiddenError();
  const { CorreoPlantilla } = ctx.tenantModels;
  const filas = await CorreoPlantilla.findAll({ order: [["nombre", "ASC"]] });
  return ok({
    plantillas: filas.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      asunto: p.asunto ?? "",
      cuerpo: p.cuerpo ?? "",
      creadaPor: p.createdBy ?? null,
      actualizadaEn: p.updatedAt,
    })),
  });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  if (!puedeUsarCorreo(ctx)) throw new ForbiddenError();

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const p = normalizarPlantilla(body);
  if (p.error) throw new ValidationError(p.error);

  const { CorreoPlantilla } = ctx.tenantModels;
  const plantilla = await CorreoPlantilla.create({
    nombre: p.nombre,
    asunto: p.asunto,
    cuerpo: p.cuerpo,
    createdBy: ctx.user?.email ?? null,
  });

  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "correo.plantilla_creada",
    entity: "correo_plantilla",
    entityId: plantilla.id,
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
