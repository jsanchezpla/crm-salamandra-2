import { withPublicTenant } from "../../../../../../lib/tenant/publicTenantContext.js";
import { ok, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { normalizarPreguntas } from "../../../../../../lib/citas/preguntasCita.js";
import { duracionDeContacto } from "../../../../../../lib/citas/slots.js";
import { verifyPortalSession, readBearer } from "../../../../../../lib/citas/portalSession.js";
import { tiposConBonoActivo, filtrarTiposPara, soloSuPrograma } from "../../../../../../lib/citas/tiposVisibles.js";
import {
  puedeReservarValoracionInicial,
  esValoracionInicial,
} from "../../../../../../lib/citas/valoracionInicial.js";

/**
 * GET /api/public/c/[tenantSlug]/event-types
 *
 * Devuelve los EventType del tenant con active=true y 'online' en modalities.
 * Filtra los campos sensibles (meetUrl, location, phoneNumber, buffers).
 *
 * TIPOS OCULTOS (05/08/2026): los marcados `is_hidden` no salen para nadie,
 * salvo para quien llegue con sesión verificada del portal (`Authorization:
 * Bearer`) y tenga un BONO ACTIVO de ese tipo. Es la asignación a dedo: la
 * paciente que pagó por transferencia ve SU tipo de cita y nadie más.
 *
 * La cabecera es OPCIONAL: sin ella el endpoint responde lo de siempre. Un
 * bearer inválido o caducado se trata como si no viniera —se enseñan los
 * públicos— en vez de devolver 401: esta pantalla es la agenda pública y no
 * puede caerse porque a alguien se le haya pasado la sesión.
 */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return notFound("Módulo no disponible");

    const { EventType } = tenantModels;
    const rows = await EventType.findAll({
      where: { active: true },
      order: [["order", "ASC"], ["createdAt", "ASC"]],
    });

    // ¿Quién está mirando? Solo se toma el correo de una sesión FIRMADA por el
    // CRM, nunca de un parámetro: si valiera un `?email=`, los tipos ocultos se
    // destaparían probando correos.
    let email = null;
    try {
      const bearer = readBearer(request);
      if (bearer) {
        const session = await verifyPortalSession(bearer, slug);
        email = session?.email ?? null;
      }
    } catch {
      // Sesión caducada o manipulada: se sigue como anónima.
    }

    const conBono = await tiposConBonoActivo(tenantModels, email);

    // La valoración inicial es de una sola vez (ver lib/citas/valoracionInicial.js).
    // Se pregunta AQUÍ y no se repite la condición en la vista: el cliente ya
    // detectó que ocultarla en un sitio y no en otro la dejaba accesible.
    //
    // Solo se puede filtrar a quien viene identificado: a un anónimo no sabemos
    // si ya la tuvo, así que se le enseña y lo corta `/book` con su email.
    const valoracion = email
      ? await puedeReservarValoracionInicial(tenantModels, email)
      : { puede: true };

    // Con un programa en marcha se ve SOLO ese (06/08/2026, Rodrigo). Va
    // después de `filtrarTiposPara` —que es quien destapa el tipo oculto— y
    // antes de todo lo demás: si se estrecha a su programa, lo de la valoración
    // ya no pinta nada.
    const data = soloSuPrograma(filtrarTiposPara(rows, conBono), conBono)
      .filter((r) => valoracion.puede || !esValoracionInicial(r))
      .filter((r) => Array.isArray(r.modalities) && r.modalities.includes("online"))
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        /*
         * ⚠️ LO QUE DURA LA SESIÓN, NO EL BLOQUE (07/08/2026, Rodrigo).
         *
         * `r.duration` es el hueco que ocupa en la agenda; los descansos previo
         * y posterior se restan por dentro (ver `lib/citas/slots.js`). Con «60
         * minutos y 10 de margen después», la paciente está 50 minutos en
         * consulta —y eso es lo que tiene que leer antes de reservar—.
         *
         * Se enseñaba el bloque: la web decía 60 y la sesión eran 50. Aquí no
         * es un detalle de pantalla, es lo que se le está ofreciendo.
         */
        duration: duracionDeContacto(r),
        color: r.color,
        additionalDataLabel: r.additionalDataLabel,
        additionalDataRequired: r.additionalDataRequired,
        minNoticeHours: r.minNoticeHours,
        maxAdvanceDays: r.maxAdvanceDays,
        // Precio en céntimos (null = gratuita). El widget lo muestra y, si hay
        // precio, la reserva pasará por el checkout.
        price: r.price ?? null,
        // Bono de sesiones y pago a plazos (04/08/2026). Con `sessionsCount`
        // a 1 el widget se comporta exactamente como siempre.
        sessionsCount: r.sessionsCount ?? 1,
        instalmentPrice: r.instalmentPrice ?? null,
        instalmentMonths: r.instalmentMonths ?? null,
        // Preguntas que hay que responder al reservar ESTE tipo de cita. Viven
        // en el propio tipo desde el 04/08/2026 (antes se enganchaba un
        // formulario del módulo Formularios, ver lib/citas/preguntasCita.js).
        // Array vacío = no pregunta nada, que es como están todas hoy.
        preguntas: normalizarPreguntas(r.formQuestions),
        // La primera visita: se entra sin firmar contratos (04/08/2026). El
        // portal la necesita para ofrecerla ANTES de la pantalla de firma.
        isInitialAssessment: Boolean(r.isInitialAssessment),
        // Este tipo solo lo está viendo porque tiene bono. El widget lo usa
        // para decir «tu programa» en vez de ofrecerlo como una compra más.
        soloParaTi: Boolean(r.isHidden),
        order: r.order,
      }));

    return ok(data);
  } catch (err) {
    return serverError(err);
  }
});
