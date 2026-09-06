import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { AppError, ValidationError } from "../../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { buscarOFallar, exigirMailing, idDeRuta, serializarContacto } from "../../../../../../lib/mailing/comun.js";
import { enviarConfirmacion } from "../../../../../../lib/mailing/confirmacion.js";
import { assertNotDemoPaidCall } from "../../../../../../lib/demo/isDemo.js";

/**
 * POST /api/mailing/contactos/[id]/confirmar — (volver a) mandar el correo de
 * confirmación a un contacto `pendiente`. Manda correo: guard de demo.
 */
export const POST = withTenant(async (request, rc, ctx) => {
  exigirMailing(ctx);
  assertNotDemoPaidCall(ctx, "El correo de confirmación");
  const id = await idDeRuta(rc);
  const contacto = await buscarOFallar(ctx.tenantModels.MailingContact, id, "Ese contacto");
  if (contacto.estado !== "pendiente") throw new ValidationError("Solo se pide confirmación a un contacto pendiente");

  const r = await enviarConfirmacion(ctx, contacto, { request });
  if (!r.ok) throw new AppError(`No se ha podido mandar la confirmación: ${r.error}`, 502);

  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.contacto.confirmacion_enviada",
    entity: "mailing_contact",
    entityId: contacto.id,
  });
  return ok({ contacto: serializarContacto(contacto) });
});
