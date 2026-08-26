import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { normalizarListaDestinatarios, normalizarNombreLista } from "../../../../lib/correo/listas.js";

/**
 * /api/correo/listas — las listas de destinatarios guardadas del centro.
 *
 * Pedidas por Rodrigo el 26/08/2026 («poder hacer listas personalizadas»). Son
 * DEL CENTRO, no de cada persona: la lista «Familias de logopedia» que monta
 * una compañera le sirve a la siguiente, igual que los remitentes o las
 * plantillas. Quien puede escribir correos puede verlas y usarlas todas.
 *
 * La lista guarda una FOTO de los destinatarios ({email, nombre, detalle,
 * fuente}), no el filtro que los produjo — ver el modelo (CorreoLista).
 */

function puedeUsarCorreo(ctx) {
  // La misma condición que enseña la pantalla /correo en el sidebar.
  return ctx.hasModule("clients") || ctx.hasModule("outreach");
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  if (!puedeUsarCorreo(ctx)) throw new ForbiddenError();
  const { CorreoLista } = ctx.tenantModels;
  const filas = await CorreoLista.findAll({ order: [["nombre", "ASC"]] });
  return ok({
    listas: filas.map((l) => ({
      id: l.id,
      nombre: l.nombre,
      destinatarios: l.destinatarios ?? [],
      creadaPor: l.createdBy ?? null,
      actualizadaEn: l.updatedAt,
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

  const n = normalizarNombreLista(body?.nombre);
  if (n.error) throw new ValidationError(n.error);
  const d = normalizarListaDestinatarios(body?.destinatarios);
  if (d.error) throw new ValidationError(d.error);

  const { CorreoLista } = ctx.tenantModels;
  const lista = await CorreoLista.create({
    nombre: n.nombre,
    destinatarios: d.destinatarios,
    createdBy: ctx.user?.email ?? null,
  });

  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "correo.lista_creada",
    entity: "correo_lista",
    entityId: lista.id,
    after: { nombre: lista.nombre, destinatarios: d.destinatarios.length },
  });

  return ok({
    lista: { id: lista.id, nombre: lista.nombre, destinatarios: lista.destinatarios },
    descartados: d.descartados,
  });
});
