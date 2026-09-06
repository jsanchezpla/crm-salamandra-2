import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { buscarOFallar, exigirMailing, idDeRuta, leerBody, serializarContacto, texto } from "../../../../../lib/mailing/comun.js";

/**
 * /api/mailing/contactos/[id] — editar o quitar un correo suelto.
 *
 * PATCH cambia nombre y notas, y permite APUNTAR el consentimiento a un
 * contacto que estaba `pendiente` (llegó la hoja firmada, lo dijo por
 * teléfono…): pasa a `activo` con `by: "equipo"` y el origen que se escriba.
 * Nunca al revés: quitarle el sí a alguien es darlo de baja, y eso va a la
 * lista de supresión (`/api/mailing/supresiones`), no a un PATCH.
 *
 * DELETE borra la fila. Si estaba de baja, la supresión se queda: borrar el
 * contacto no le devuelve el correo.
 */
export const PATCH = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const { MailingContact } = ctx.tenantModels;
  const contacto = await buscarOFallar(MailingContact, id, "Ese contacto");
  const body = await leerBody(request);

  const cambios = {};
  if ("nombre" in body) cambios.nombre = texto(body.nombre, 160);
  if ("notas" in body) cambios.notas = texto(body.notas, 2000);
  if (body.consentimiento?.origen !== undefined) {
    if (contacto.estado === "baja") throw new ValidationError("Está de baja: no se le puede volver a marcar el sí desde aquí");
    const origen = texto(body.consentimiento.origen, 300, { requerido: true, nombre: "El origen del consentimiento" });
    const { ip } = datosPeticion(request);
    cambios.consentimiento = {
      granted: true,
      at: new Date().toISOString(),
      ip: ip ? String(ip).slice(0, 64) : null,
      userAgent: null,
      by: "equipo",
      origen,
    };
    cambios.estado = "activo";
  }
  if (!Object.keys(cambios).length) throw new ValidationError("No hay nada que cambiar");

  const antes = { estado: contacto.estado };
  await contacto.update(cambios);
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.contacto.updated",
    entity: "mailing_contact",
    entityId: contacto.id,
    before: antes,
    after: { estado: contacto.estado, campos: Object.keys(cambios) },
  });
  return ok({ contacto: serializarContacto(contacto) });
});

export const DELETE = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const { MailingContact } = ctx.tenantModels;
  const contacto = await buscarOFallar(MailingContact, id, "Ese contacto");
  const resumen = { estado: contacto.estado, origen: contacto.origen };
  await contacto.destroy();
  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.contacto.deleted",
    entity: "mailing_contact",
    entityId: id,
    before: resumen,
  });
  return ok({ borrado: true });
});
