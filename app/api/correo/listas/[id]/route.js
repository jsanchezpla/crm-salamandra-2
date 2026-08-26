import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { normalizarListaDestinatarios, normalizarNombreLista } from "../../../../../lib/correo/listas.js";

/** PUT (renombrar o cambiar destinatarios) y DELETE de una lista guardada. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function puedeUsarCorreo(ctx) {
  return ctx.hasModule("clients") || ctx.hasModule("outreach");
}

async function listaDe(ctx, rc) {
  const { id } = await rc.params;
  if (!UUID_RE.test(String(id ?? ""))) throw new ValidationError("Identificador inválido");
  const lista = await ctx.tenantModels.CorreoLista.findByPk(id);
  if (!lista) throw new NotFoundError("Esa lista ya no existe");
  return lista;
}

export const PUT = withTenant(async (request, rc, ctx) => {
  if (!puedeUsarCorreo(ctx)) throw new ForbiddenError();
  const lista = await listaDe(ctx, rc);

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const cambios = {};
  if (body?.nombre !== undefined) {
    const n = normalizarNombreLista(body.nombre);
    if (n.error) throw new ValidationError(n.error);
    cambios.nombre = n.nombre;
  }
  let descartados = [];
  if (body?.destinatarios !== undefined) {
    const d = normalizarListaDestinatarios(body.destinatarios);
    if (d.error) throw new ValidationError(d.error);
    cambios.destinatarios = d.destinatarios;
    descartados = d.descartados;
  }
  if (!Object.keys(cambios).length) throw new ValidationError("No hay nada que cambiar");

  const antes = { nombre: lista.nombre, destinatarios: (lista.destinatarios ?? []).length };
  await lista.update(cambios);

  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "correo.lista_actualizada",
    entity: "correo_lista",
    entityId: lista.id,
    before: antes,
    after: { nombre: lista.nombre, destinatarios: (lista.destinatarios ?? []).length },
  });

  return ok({
    lista: { id: lista.id, nombre: lista.nombre, destinatarios: lista.destinatarios },
    descartados,
  });
});

export const DELETE = withTenant(async (request, rc, ctx) => {
  if (!puedeUsarCorreo(ctx)) throw new ForbiddenError();
  const lista = await listaDe(ctx, rc);

  const resumen = { nombre: lista.nombre, destinatarios: (lista.destinatarios ?? []).length };
  await lista.destroy();

  // Borrar una lista es destructivo: SIEMPRE deja rastro (regla de auditoría).
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "correo.lista_borrada",
    entity: "correo_lista",
    entityId: lista.id,
    before: resumen,
  });

  return ok({ borrada: true });
});
