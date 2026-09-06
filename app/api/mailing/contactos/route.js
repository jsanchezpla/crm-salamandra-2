import { Op } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { autorDe, emailValido, exigirMailing, leerBody, serializarContacto, texto } from "../../../../lib/mailing/comun.js";
import { enviarConfirmacion } from "../../../../lib/mailing/confirmacion.js";
import { assertNotDemoPaidCall } from "../../../../lib/demo/isDemo.js";

/**
 * /api/mailing/contactos — los correos SUELTOS de la lista: los que no son de
 * ninguna ficha de cliente.
 *
 *   GET  ?q=&estado=    listado (hasta 500)
 *   POST                alta a mano. Exige DECIR de dónde sale el sí:
 *                       `consentimiento.origen` («hoja de la charla del 12/05»)
 *                       → nace `activo` con by: "equipo"; o bien
 *                       `confirmarPorCorreo: true` → nace `pendiente` y se le
 *                       manda el correo de confirmación (doble opt-in). Las dos
 *                       cosas a la vez también valen. Ninguna, no: un correo
 *                       sin prueba de consentimiento no entra en la lista.
 *
 * Los clientes con la casilla de novedades NO se dan de alta aquí (plan 1.2):
 * se leen de su ficha. Si alguien mete el correo de una ficha, se le dice.
 */
const LIMITE = 500;
const ESTADOS = new Set(["pendiente", "activo", "baja"]);

export const GET = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") || "").trim().toLowerCase();
  const estado = (sp.get("estado") || "").trim();
  const where = {};
  if (ESTADOS.has(estado)) where.estado = estado;
  if (q) where[Op.or] = [{ email: { [Op.iLike]: `%${q}%` } }, { nombre: { [Op.iLike]: `%${q}%` } }];
  const { MailingContact } = ctx.tenantModels;
  const { rows, count } = await MailingContact.findAndCountAll({ where, order: [["createdAt", "DESC"]], limit: LIMITE });
  const porEstado = Object.fromEntries(
    (await MailingContact.findAll({
      attributes: ["estado", [ctx.tenantSequelize.fn("count", ctx.tenantSequelize.col("id")), "n"]],
      group: ["estado"],
      raw: true,
    })).map((f) => [f.estado, Number(f.n)])
  );
  return ok({ contactos: rows.map(serializarContacto), total: count, porEstado });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const body = await leerBody(request);
  const email = emailValido(body.email, "El correo");
  const nombre = texto(body.nombre, 160);
  const origenConsentimiento = texto(body.consentimiento?.origen, 300);
  const confirmarPorCorreo = body.confirmarPorCorreo === true;
  if (!origenConsentimiento && !confirmarPorCorreo) {
    throw new ValidationError("Di de dónde sale el consentimiento (p. ej. «hoja de la charla del 12/05») o pide confirmación por correo");
  }
  if (confirmarPorCorreo) assertNotDemoPaidCall(ctx, "El correo de confirmación");

  const { MailingContact, MailingSuppression, Client } = ctx.tenantModels;

  if (await MailingSuppression.findOne({ where: { email }, attributes: ["id", "motivo"] })) {
    throw new ValidationError("Esa dirección está en la lista de supresión (se dio de baja, rebotó o se quejó): no se puede volver a meter");
  }
  if (ctx.tenantHasModule("clients")) {
    try {
      const ficha = await Client.findOne({ where: { email }, attributes: ["id", "name"] });
      if (ficha) {
        throw new ValidationError(`Ese correo es de la ficha de «${ficha.name}»: márcale la casilla de novedades en su ficha, no lo metas aquí`);
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      // Sin tabla de clientes se sigue: el correo suelto es válido igual.
    }
  }
  if (await MailingContact.findOne({ where: { email }, attributes: ["id"] })) {
    throw new ValidationError("Ese correo ya está en la lista");
  }

  const { ip } = datosPeticion(request);
  const ahora = new Date().toISOString();
  const contacto = await MailingContact.create({
    email,
    nombre,
    origen: "manual",
    estado: origenConsentimiento ? "activo" : "pendiente",
    consentimiento: origenConsentimiento
      ? { granted: true, at: ahora, ip: ip ? String(ip).slice(0, 64) : null, userAgent: null, by: "equipo", origen: origenConsentimiento }
      : { granted: false, at: null, ip: null, userAgent: null, by: null, origen: "pendiente de confirmación por correo" },
    notas: texto(body.notas, 2000),
    createdBy: autorDe(request),
  });

  let confirmacion = null;
  if (confirmarPorCorreo) {
    confirmacion = await enviarConfirmacion(ctx, contacto, { request });
  }

  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.contacto.created",
    entity: "mailing_contact",
    entityId: contacto.id,
    after: { estado: contacto.estado, origen: contacto.origen, confirmacionEnviada: !!confirmacion?.ok },
  });

  return ok({ contacto: serializarContacto(contacto), confirmacion });
});
