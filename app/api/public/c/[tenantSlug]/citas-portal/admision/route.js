import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, unauthorized, notFound, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { verifyPortalSession, readBearer } from "../../../../../../../lib/citas/portalSession.js";
import {
  exigeFormularioAceptado,
  urlDelFormulario,
  estadoDeAdmision,
  mensajeDePuerta,
} from "../../../../../../../lib/citas/puertaFormulario.js";

/**
 * GET /api/public/c/[tenantSlug]/citas-portal/admision — ¿puede reservar ya?
 * (05/08/2026, Rodrigo)
 *
 * ── EL PROBLEMA QUE RESUELVE ────────────────────────────────────────────────
 * La puerta de admisión avisaba TARDE. Quien acababa de crearse la cuenta y
 * pulsaba «Reservar cita» veía la agenda entera, elegía día y hora, rellenaba
 * sus datos… y solo entonces se enteraba de que antes hacía falta el
 * formulario. El servidor cortaba bien, pero después de hacerle trabajar.
 *
 * El aviso no se podía subir a la primera pantalla porque `/info` es público y
 * anónimo: dice que la puerta EXISTE, nunca el estado de nadie. Con la sesión
 * del portal sí se puede, porque el correo va firmado y es suyo — enseñarle su
 * propia situación no es filtrar nada.
 *
 * ── LO QUE NO ES ────────────────────────────────────────────────────────────
 * Esto NO protege: `/book` vuelve a comprobarlo y devuelve el mismo aviso. Es
 * para que nadie recorra media reserva antes de enterarse.
 *
 * Y NO acepta un email por parámetro a propósito: se saca de la sesión firmada.
 * Aceptarlo convertiría el endpoint en un buscador de las pacientes del centro
 * («¿está fulanita aceptada?»).
 */
export const GET = withPublicTenant(
  async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
    try {
      if (!hasModule("citas")) return notFound("Módulo no disponible");

      let email;
      try {
        ({ email } = await verifyPortalSession(readBearer(request), slug));
      } catch {
        return unauthorized("Sesión no válida");
      }

      // Sin la puerta encendida no hay nada que contestar: puede reservar.
      if (!exigeFormularioAceptado(tenant)) {
        return ok({ admitida: true, estado: "no_aplica", aviso: null, urlFormulario: null });
      }

      const estado = hasModule("formularios")
        ? await estadoDeAdmision(tenantModels.FormSubmission, email)
        : "sin_bandeja";

      if (estado === "aceptada") {
        return ok({ admitida: true, estado, aviso: null, urlFormulario: null });
      }

      // `identificado: true` siempre: venimos de una sesión verificada, así que
      // sí se le puede decir «tu solicitud está en revisión» en vez del texto
      // genérico que se le da a un anónimo.
      const aviso = mensajeDePuerta(estado, { identificado: true, nombre: tenant?.name });

      return ok({
        admitida: false,
        estado,
        aviso,
        urlFormulario: aviso.mostrarEnlace ? urlDelFormulario(tenant) : null,
      });
    } catch (err) {
      return serverError(err);
    }
  },
  { rateLimit: { limit: 60, windowMs: 60_000, key: "citas-portal-admision" } }
);
