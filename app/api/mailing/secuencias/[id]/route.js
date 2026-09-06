import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { buscarOFallar, exigirMailing, idDeRuta, leerBody, serializarSecuencia } from "../../../../../lib/mailing/comun.js";
import { campanaLista, exigirSes } from "../../../../../lib/mailing/envio.js";
import { historialDeSecuencia } from "../../../../../lib/mailing/secuencias.js";
import { assertNotDemoPaidCall } from "../../../../../lib/demo/isDemo.js";
import { normalizarDatosSecuencia } from "../route.js";

/**
 * /api/mailing/secuencias/[id] — una secuencia.
 *
 * GET con su histórico (las campañas automáticas por periodo).
 * PATCH edita; `activa: true` la enciende (sella `activadaDesde` si estaba
 * apagada) y exige asunto, contenido y SES configurado: una secuencia
 * encendida a medias mandaría correos vacíos a la primera familia nueva.
 * DELETE la borra con su histórico (CASCADE); la supresión no se toca.
 */
export const GET = withTenant(async (_request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const seq = await buscarOFallar(ctx.tenantModels.MailingSequence, id, "Esa secuencia");
  return ok({ secuencia: serializarSecuencia(seq, { historial: await historialDeSecuencia(ctx, seq) }) });
});

export const PATCH = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const seq = await buscarOFallar(ctx.tenantModels.MailingSequence, id, "Esa secuencia");
  const body = await leerBody(request);
  const cambios = normalizarDatosSecuencia(body, { evento: seq.evento });

  if ("activa" in body) {
    const encender = body.activa === true;
    if (encender && !seq.activa) {
      assertNotDemoPaidCall(ctx, "Encender una secuencia");
      const lista = campanaLista({ asunto: cambios.asunto ?? seq.asunto, bloques: cambios.bloques ?? seq.bloques });
      if (!lista.ok) throw new ValidationError(`No se puede encender: ${lista.motivo.toLowerCase()}`);
      exigirSes(ctx);
      cambios.activadaDesde = new Date();
    }
    cambios.activa = encender;
  }
  if (!Object.keys(cambios).length) throw new ValidationError("No hay nada que cambiar");

  const antes = { activa: seq.activa };
  await seq.update(cambios);
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "activa" in cambios && cambios.activa !== antes.activa ? (cambios.activa ? "mailing.secuencia.encendida" : "mailing.secuencia.apagada") : "mailing.secuencia.updated",
    entity: "mailing_sequence",
    entityId: seq.id,
    before: antes,
    after: { nombre: seq.nombre, activa: seq.activa, campos: Object.keys(cambios) },
  });
  return ok({ secuencia: serializarSecuencia(seq, { historial: await historialDeSecuencia(ctx, seq) }) });
});

export const DELETE = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const seq = await buscarOFallar(ctx.tenantModels.MailingSequence, id, "Esa secuencia");
  const antes = { nombre: seq.nombre, evento: seq.evento, activa: seq.activa };
  await seq.destroy();
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.secuencia.deleted",
    entity: "mailing_sequence",
    entityId: id,
    before: antes,
  });
  return ok({ borrado: true });
});
