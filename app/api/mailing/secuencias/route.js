import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { autorDe, emailValido, exigirMailing, leerBody, serializarSecuencia, texto } from "../../../../lib/mailing/comun.js";
import { normalizarBloques } from "../../../../lib/mailing/bloques.js";
import { EVENTOS, EVENTOS_KEYS } from "../../../../lib/mailing/secuencias.js";

/**
 * /api/mailing/secuencias — los correos automáticos por eventos del CRM.
 *
 * GET lista (con el catálogo de eventos para la pantalla). POST crea una
 * secuencia APAGADA: encenderla es un PATCH explícito con `activa: true`, que
 * es cuando se sella `activadaDesde` (a partir de ahí cuenta; el histórico no).
 */
export function normalizarDatosSecuencia(body, { evento } = {}) {
  const ev = evento ?? body.evento;
  if (!EVENTOS_KEYS.includes(ev)) throw new ValidationError(`Evento desconocido. Vale uno de: ${EVENTOS_KEYS.join(", ")}`);
  const cambios = {};
  if ("nombre" in body) cambios.nombre = texto(body.nombre, 160, { requerido: true, nombre: "El nombre de la secuencia" });
  if ("dias" in body) {
    const d = Math.round(Number(body.dias));
    if (!Number.isFinite(d) || d < 0 || d > 3650) throw new ValidationError("Los días tienen que estar entre 0 y 3650");
    cambios.dias = EVENTOS[ev].usaDias ? d : 0;
  }
  if ("hora" in body) {
    const h = Math.round(Number(body.hora));
    if (!Number.isFinite(h) || h < 0 || h > 23) throw new ValidationError("La hora tiene que estar entre 0 y 23");
    cambios.hora = h;
  }
  if ("asunto" in body) cambios.asunto = texto(body.asunto, 200);
  if ("preheader" in body) cambios.preheader = texto(body.preheader, 200);
  if ("bloques" in body) cambios.bloques = normalizarBloques(body.bloques);
  if ("replyTo" in body) cambios.replyTo = body.replyTo ? emailValido(body.replyTo, "El correo de respuesta") : null;
  return cambios;
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  exigirMailing(ctx);
  const filas = await ctx.tenantModels.MailingSequence.findAll({ order: [["createdAt", "ASC"]] });
  return ok({
    secuencias: filas.map((s) => serializarSecuencia(s)),
    eventos: EVENTOS_KEYS.map((k) => ({ key: k, ...EVENTOS[k] })),
    conClientes: ctx.tenantHasModule("clients"),
    conCitas: ctx.tenantHasModule("citas"),
  });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const body = await leerBody(request);
  const evento = body.evento;
  const datos = normalizarDatosSecuencia({ nombre: body.nombre, dias: body.dias ?? EVENTOS[evento]?.diasPorDefecto ?? 0, hora: body.hora ?? 10, asunto: body.asunto, preheader: body.preheader, bloques: body.bloques ?? [], replyTo: body.replyTo }, { evento });
  if (!datos.nombre) throw new ValidationError("El nombre de la secuencia no puede quedar vacío");
  const seq = await ctx.tenantModels.MailingSequence.create({ ...datos, evento, activa: false, createdBy: autorDe(request) });
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.secuencia.created",
    entity: "mailing_sequence",
    entityId: seq.id,
    after: { nombre: seq.nombre, evento },
  });
  return ok({ secuencia: serializarSecuencia(seq) });
});
