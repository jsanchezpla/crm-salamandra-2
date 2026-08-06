import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { auditar } from "../../../../../../../lib/utils/auditoria.js";
import { gatePortal, resolvePortalContractSession, estadoContrato } from "../../../../../../../lib/citas/portalContract.js";
import { camposDe, validarDatos } from "../../../../../../../lib/clients/contratoFirma.js";
import { camposQueFaltan, actualizacionDeFicha } from "../../../../../../../lib/clients/datosFicha.js";
import { desajusteDeEdad } from "../../../../../../../lib/formularios/edadDeclarada.js";
import { notifyAdmins } from "../../../../../../../lib/notifications/notifyUsers.js";

/**
 * POST — «Completa tus datos», el paso previo a firmar (04/08/2026).
 *
 * La paciente rellena lo que le FALTA en su ficha (DNI, fecha de nacimiento,
 * domicilio…) y se guarda donde tiene que estar: en su ficha del CRM, no
 * enterrado dentro de una firma. Antes esos datos se pedían dentro del propio
 * contrato y se quedaban ahí: Laura veía la ficha igual de vacía que antes, y
 * la fecha de nacimiento —lo que decide si hace falta el consentimiento de su
 * tutor— solo se sabía cuando ya había empezado a firmar.
 *
 * SOLO SE RELLENAN HUECOS. Lo que la ficha ya tiene no se pregunta ni se
 * sobrescribe: puede ser una corrección que hizo el centro a mano, y perderla
 * por lo que teclee alguien desde el móvil sería peor que no preguntar nada.
 * La regla vive en `lib/clients/datosFicha.js`, compartida con la firma.
 *
 * Body: { datos: { clave: valor } }
 */
export const POST = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gatePortal(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client, guardian } = await resolvePortalContractSession(request, slug, tenantModels);
    if (response) return response;
    if (!client) return error("Todavía no tenemos tu ficha. Escríbenos y lo revisamos.", 409);

    const { siguienteDocumento, estructurado } = await estadoContrato(tenantModels, client, guardian);
    if (!estructurado || !siguienteDocumento) {
      return ok({ completo: true, faltan: [] });
    }

    const campos = camposDe(siguienteDocumento);
    const faltan = camposQueFaltan(campos, client);
    if (faltan.length === 0) return ok({ completo: true, faltan: [] });

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }

    // Se valida contra la plantilla ENTERA (mismos formatos que al firmar) pero
    // solo se exige lo que falta: pedirle a alguien la localidad de la firma en
    // esta pantalla sería preguntarle por un dato que aún no ha ocurrido.
    const soloFaltan = campos.filter((c) => faltan.some((f) => f.key === c.key));
    // `client` va para que la edad decida los obligatorios: el DNI no lo es
    // por debajo de los 14 (ver `campoEsObligatorio`).
    const dat = validarDatos({ fields: soloFaltan }, body?.datos, client);
    if (dat.error) return error(dat.error, 422);

    const update = actualizacionDeFicha(campos, client, dat.datos);
    if (update) await client.update(update);

    /*
     * ¿La fecha de nacimiento cuadra con la edad que declaró en el formulario?
     * (06/08/2026, Rodrigo). Si no cuadra —y no se explica por un cumpleaños de
     * por medio— le salta el aviso a la profesional en la campana. No bloquea:
     * la paciente sigue su camino y quien decide qué hacer es la consulta.
     */
    if (hasModule("formularios") && update?.birthDate) {
      const desajuste = await desajusteDeEdad({
        FormSubmission: tenantModels.FormSubmission,
        email: client.email,
        birthDate: update.birthDate,
      });
      if (desajuste) {
        await notifyAdmins({
          tenantId: tenant.id,
          tenantModels,
          type: "cliente.edad_no_cuadra",
          title: "La edad no cuadra con el formulario",
          body:
            `${client.name || "Una paciente"} declaró ${desajuste.declarada} años en el formulario y ` +
            `la fecha de nacimiento de su ficha da ${desajuste.real}. Conviene comprobarlo antes de la primera cita: ` +
            `de la edad dependen el consentimiento del tutor y el DNI.`,
          entityType: "Client",
          entityId: client.id,
          dedupe: true,
        });
      }
    }

    const despues = await estadoContrato(tenantModels, client, guardian);

    await auditar({
      tenantId: tenant.id,
      userId: null, // el portal no es un usuario del CRM
      ip: request.headers.get("x-forwarded-for") ?? null,
      action: "client.datos.completados",
      entity: "Client",
      entityId: client.id,
      // QUÉ campos se rellenaron, no su contenido: la auditoría vive en master
      // y la comparten todos los clientes; ahí no puede acabar el DNI de nadie.
      after: { campos: Object.keys(dat.datos), desde: "portal" },
    });

    // La respuesta viaja con la MISMA forma que el estado del contrato: la
    // pantalla la mezcla en su estado tal cual y sigue el flujo sin recargar.
    // Con la fecha de nacimiento ya guardada puede haber aparecido de golpe el
    // consentimiento parental, y `plantilla` ya trae el documento que toca.
    return ok({
      datosPendientes: despues.datosPendientes ?? [],
      datosPosteriores: despues.datosPosteriores ?? [],
      plantilla: despues.siguienteDocumento ?? null,
      documentosPendientes: despues.documentosPendientes ?? 0,
      quedanDocumentos: despues.documentosPendientes ?? 0,
    });
  } catch (err) {
    return serverError(err);
  }
});
