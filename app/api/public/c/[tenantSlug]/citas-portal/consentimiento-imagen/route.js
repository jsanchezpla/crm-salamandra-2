import { withPublicTenant } from "../../../../../../../lib/tenant/publicTenantContext.js";
import { ok, error, serverError } from "../../../../../../../lib/utils/apiResponse.js";
import { auditar } from "../../../../../../../lib/utils/auditoria.js";
import { gatePortal, resolvePortalContractSession } from "../../../../../../../lib/citas/portalContract.js";
import { bufferFromDataUrl, writeSignature } from "../../../../../../../lib/clients/signatureStorage.js";
import { registrarImagenPortal, yaRespondido } from "../../../../../../../lib/clinica/consents.js";
import { CUPO_PORTAL } from "../../../../../../../lib/citas/portalRateLimit.js";

/**
 * Consentimiento de IMAGEN, firmado por la familia desde el portal
 * (sprint 8, 02/08/2026).
 *
 * Sale del sprint 3: de 1.178 pacientes de Aumenta **solo 5** tenían el
 * consentimiento de imagen recogido. No es que estuviera en otro sitio, es que
 * no se pedía. Esta pantalla es la vía práctica de recogerlo sin papeleo.
 *
 * ── Las tres reglas que no se pueden saltar ────────────────────────────────
 *
 * 1. **NO es obligatorio.** Se puede decir que no y seguir usando el portal.
 *    Un consentimiento que hay que dar para entrar no es un consentimiento.
 * 2. **El «no» se guarda con su fecha.** Demuestra que se preguntó y evita
 *    volver a preguntarlo en cada visita.
 * 3. **Es POR PACIENTE**, no por familia: son las imágenes de un niño concreto.
 *    Con dos hermanos, se contesta dos veces. Firma el tutor.
 *
 * La firma dibujada solo se pide al aceptar: no se firma una negativa.
 */

// 42P01 = la tabla no existe en este schema (tenant sin módulo de pacientes).
const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

async function pacientesDeLaFamilia(tenantModels, clientId) {
  const { Patient } = tenantModels;
  if (!Patient) return null;
  try {
    return await Patient.findAll({
      where: { clientId },
      attributes: ["id", "firstName", "lastName", "consents"],
      order: [["firstName", "ASC"]],
    });
  } catch (err) {
    if (tablaAusente(err)) return null;
    throw err;
  }
}

/** Estado: a quién le falta contestar. */
export const GET = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gatePortal(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client, guardian } = await resolvePortalContractSession(request, slug, tenantModels);
    if (response) return response;
    if (!client) return error("Todavía no tenemos tu ficha. Escríbenos y lo revisamos.", 409);

    const pacientes = await pacientesDeLaFamilia(tenantModels, client.id);
    // Sin módulo de pacientes esta pantalla sencillamente no aplica: se devuelve
    // vacío en vez de un error, para que el portal no enseñe un aviso rojo por
    // algo que en su centro no existe.
    if (!pacientes) return ok({ disponible: false, pacientes: [] });

    return ok({
      disponible: true,
      firmante: guardian ? { id: guardian.id, nombre: guardian.name } : null,
      pacientes: pacientes.map((p) => {
        const e = p.consents?.images ?? null;
        return {
          id: p.id,
          nombre: [p.firstName, p.lastName].filter(Boolean).join(" "),
          respondido: yaRespondido(p.consents, "images"),
          aceptado: !!e?.granted,
          respondidoEl: e?.at ?? null,
        };
      }),
    });
  } catch (err) {
    return serverError(err);
  }
}, { rateLimit: CUPO_PORTAL });

/** Respuesta. Body: { patientId, acepto: bool, signature?: dataURL } */
export const POST = withPublicTenant(async (request, _ctx, { slug, tenant, tenantModels, hasModule }) => {
  try {
    const blocked = gatePortal(tenant, hasModule);
    if (blocked) return blocked;

    const { response, client, guardian } = await resolvePortalContractSession(request, slug, tenantModels);
    if (response) return response;
    if (!client) return error("Todavía no tenemos tu ficha. Escríbenos y lo revisamos.", 409);

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    if (!body?.patientId) return error("Falta el paciente", 422);
    if (typeof body.acepto !== "boolean") {
      // A propósito: no hay valor por defecto. Si el front no manda una respuesta
      // explícita es que la pantalla está mal, y presumir un "sí" o un "no"
      // sería inventarse el consentimiento.
      return error("Falta la respuesta: hay que decir si se acepta o no", 422);
    }

    const { Patient } = tenantModels;
    if (!Patient) return error("Este centro no gestiona pacientes", 503);

    let paciente;
    try {
      paciente = await Patient.findOne({ where: { id: body.patientId, clientId: client.id } });
    } catch (err) {
      if (tablaAusente(err)) return error("Este centro no gestiona pacientes", 503);
      throw err;
    }
    // Se comprueba que el paciente sea DE ESTA familia: sin esto, cualquiera con
    // sesión de portal podría firmar por el hijo de otro.
    if (!paciente) return error("Ese paciente no es de tu familia", 403);

    let firmaPath = null;
    if (body.acepto) {
      const buffer = bufferFromDataUrl(body?.signature);
      if (!buffer) return error("La firma no ha llegado bien. Vuelve a dibujarla, por favor.", 422);
      firmaPath = await writeSignature(tenant.slug, client.id, buffer);
    }

    const consents = registrarImagenPortal(paciente.consents, {
      granted: body.acepto,
      firmaPath,
      guardianId: guardian?.id ?? null,
      firmante: guardian?.name ?? null,
      ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
      userAgent: request.headers.get("user-agent") || null,
    });
    await paciente.update({ consents });

    await auditar({
      tenantId: tenant.id,
      userId: null, // el portal no es un usuario del CRM
      ip: request.headers.get("x-forwarded-for") ?? null,
      action: body.acepto ? "patient.consent.images.granted" : "patient.consent.images.refused",
      entity: "Patient",
      entityId: paciente.id,
      // Sin nombres: la auditoría vive en master y la comparten todos los
      // clientes. Basta con saber qué se contestó y cuándo.
      after: { images: consents.images.granted, at: consents.images.at, canal: "portal" },
    });

    return ok({ aceptado: consents.images.granted, respondidoEl: consents.images.at });
  } catch (err) {
    return serverError(err);
  }
}, { rateLimit: CUPO_PORTAL });
