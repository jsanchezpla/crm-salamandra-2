import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { auditar } from "../../../../../../../lib/utils/auditoria.js";
import {
  gatePortal,
  resolvePortalContractSession,
  estadoContrato,
  plantillasActivas,
  huecosDeFicha,
} from "../../../../../../../lib/citas/portalContract.js";
import { validarDatos } from "../../../../../../../lib/clients/contratoFirma.js";
import { actualizacionDeFicha } from "../../../../../../../lib/clients/datosFicha.js";
import { desajusteDeEdad } from "../../../../../../../lib/formularios/edadDeclarada.js";
import { notifyAdmins } from "../../../../../../../lib/notifications/notifyUsers.js";
import { CUPO_PORTAL } from "../../../../../../../lib/citas/portalRateLimit.js";

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
/**
 * GET — los datos de contacto que el CRM YA tiene de ella (06/08/2026, Rodrigo).
 *
 * Nace de quitar una pantalla: al pedir cita se le pedían nombre, correo y
 * teléfono que la consulta ya tenía apuntados desde el formulario de admisión.
 * Con esto, la reserva se confirma en el mismo botón de elegir la hora.
 *
 * Devuelve SOLO lo de quien entra —la ficha se resuelve desde su sesión
 * firmada, no desde ningún parámetro— y solo estos tres campos: es lo que hace
 * falta para reservar. Nada de DNI, domicilio ni fecha de nacimiento, que no
 * pintan nada en una agenda y no tienen por qué salir a un endpoint público.
 *
 *   200 → { nombre, email, telefono, completo }
 */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gatePortal(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client } = await resolvePortalContractSession(request, slug, tenantModels);
    if (response) return response;

    const nombre = String(client?.name ?? "").trim();
    const email = String(client?.email ?? "").trim();
    const telefono = String(client?.phone ?? "").trim();

    return ok({
      nombre: nombre || null,
      email: email || null,
      telefono: telefono || null,
      // `completo` = con esto se puede reservar sin preguntarle nada más. Lo
      // decide el servidor para que la pantalla no tenga que saber qué exige
      // una reserva.
      completo: !!(nombre && email && telefono),
    });
  } catch (err) {
    return serverError(err);
  }
}, { rateLimit: CUPO_PORTAL });

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

    /*
     * EXACTAMENTE LOS MISMOS CAMPOS QUE SE LE ENSEÑARON (06/08/2026, Rodrigo).
     *
     * Antes esto se calculaba aquí sobre la plantilla que toca firmar, mientras
     * que la pantalla los recibía calculados sobre TODAS. Los dos universos se
     * separaron el día que el consentimiento parental pasó a ir primero, y el
     * servidor empezó a exigir un DNI que la pantalla no preguntaba: el botón
     * «Continuar» no se dejaba pulsar y no había casilla donde arreglarlo.
     *
     * Ahora sale de la misma función (`huecosDeFicha`) y se valida SOLO lo
     * previo, que es lo que esta pantalla pide. El resto (domicilio,
     * facturación) se pide después de firmar, en su momento.
     */
    const plantillas = await plantillasActivas(tenantModels);
    const { previos } = huecosDeFicha(plantillas, client);
    if (previos.length === 0) return ok({ completo: true, faltan: [] });

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }

    // `client` va para que la edad decida los obligatorios (el DNI no lo es
    // mientras sea menor, ver `campoEsObligatorio`), y para que la fecha que
    // acaba de escribir cuente antes que la que hubiera en la ficha.
    const dat = validarDatos({ fields: previos }, body?.datos, client);
    if (dat.error) return error(dat.error, 422);

    const update = actualizacionDeFicha(previos, client, dat.datos);
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
}, { rateLimit: CUPO_PORTAL });
