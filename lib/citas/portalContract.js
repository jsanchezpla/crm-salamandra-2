/**
 * portalContract — el Contrato del Centro visto desde el PORTAL de la familia
 * (sprint Aumenta 2026-07, puntos 2.1 y 2.2).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten tres endpoints públicos —el
 * estado del contrato, la firma y «Mis documentos», que se cierra mientras
 * falte alguna firma—. Los ficheros de rutas de Next solo deben exportar los
 * manejadores HTTP, así que la lógica común no puede vivir en uno de ellos.)
 *
 * Qué se firma: el contrato ESTÁNDAR del centro (`documents.source =
 * 'contract_template'`, uno por tenant). Si el equipo ya subió a la ficha el
 * contrato firmado en PAPEL, cuenta como firmado y no se pide firma web
 * (decisión de Rodrigo, 31/07).
 */

import { forbidden, notFound, unauthorized } from "../utils/apiResponse.js";
import { verifyPortalSession, readBearer } from "./portalSession.js";
import { normalizeEmail } from "./validation.js";
import { resolvePortalAccess } from "./portalClient.js";
import { contractSituation, effectiveSigners, findClientContract } from "../clients/clientContract.js";

export const TEMPLATE_SOURCE = "contract_template";

/** Mismo portón que el resto del portal: módulo citas + SSO encendido. */
export function gatePortal(tenant, hasModule) {
  if (!hasModule("citas")) return notFound("Módulo no disponible");
  if (tenant.settings?.widget?.sso?.enabled !== true) return forbidden("Portal no habilitado");
  return null;
}

/** Sesión + ficha + tutor que ha entrado. Devuelve `{ response }` si falla. */
export async function resolvePortalContractSession(request, slug, tenantModels) {
  let email;
  try {
    ({ email } = await verifyPortalSession(readBearer(request), slug));
  } catch {
    return { response: unauthorized("Sesión no válida o caducada") };
  }
  const normalized = normalizeEmail(email);
  if (!normalized) return { response: unauthorized("Sesión no válida o caducada") };
  const { client, guardian } = await resolvePortalAccess(tenantModels, normalized);
  return { client, guardian, email: normalized };
}

// 42P01 = la tabla no existe en este schema. Pasa en tenants que no han corrido
// la migración del sprint: el portal no debe caerse por eso.
const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

/**
 * Situación del contrato + qué papel juega QUIEN ha entrado.
 *
 * `bloqueado` es la respuesta a «¿le cierro el resto del portal?». Si la ficha
 * no tiene a nadie que pueda firmar no se bloquea nada: sería una puerta sin
 * llave, y la familia se quedaría encerrada sin manera de salir.
 */
export async function estadoContrato(tenantModels, client, guardian) {
  const { Document, ContractSignature } = tenantModels;

  let contratoFicha = null;
  let plantilla = null;
  if (Document) {
    try {
      contratoFicha = await findClientContract(Document, client);
      plantilla = await Document.findOne({ where: { source: TEMPLATE_SOURCE }, order: [["createdAt", "DESC"]] });
    } catch (err) {
      if (!tablaAusente(err)) throw err;
    }
  }
  const enPapel = !!contratoFicha;

  let firmas = [];
  if (ContractSignature) {
    try {
      firmas = await ContractSignature.findAll({ where: { clientId: client.id } });
    } catch (err) {
      if (!tablaAusente(err)) throw err;
    }
  }

  const situacion = contractSituation({ client, signatures: firmas, contratoEnPapel: enPapel });
  const firmantes = effectiveSigners(client);

  // Quién ha entrado: si la ficha tiene tutores, el del email de la sesión; si
  // no los tiene, el titular (que es con cuyo correo se entra).
  const firmante = guardian
    ? firmantes.find((f) => f.id.toLowerCase() === String(guardian.id).toLowerCase()) ?? null
    : firmantes.find((f) => f.titular) ?? null;

  const miFirma = firmante
    ? firmas.find((f) => String(f.guardianId).toLowerCase() === firmante.id.toLowerCase()) ?? null
    : null;

  return {
    situacion,
    firmante,
    miFirma,
    plantilla,
    // El PDF que le toca a ESTA familia: el suyo firmado en papel si lo hay, y
    // si no el contrato estándar del centro. Se devuelve ya resuelto para que
    // la descarga no vuelva a buscarlo (y no lo busque MAL: la sesión del
    // portal trae la ficha sin `contractDocumentId`).
    documento: contratoFicha ?? plantilla,
    enPapel,
    // SIN CONTRATO ESTÁNDAR SUBIDO NO SE BLOQUEA NADA (arreglo del 31/07, el
    // mismo día del despliegue). El cerrojo se activaba con solo tener el
    // portal encendido, y el único tenant con portal es nutri_laura, que no
    // usa contratos: a sus pacientes REALES les apareció una pantalla
    // pidiéndoles firmar un documento que no existe. Que el centro suba su
    // Contrato del Centro es justo la señal de que quiere pedir la firma.
    bloqueado: !situacion.contratoCompleto && situacion.firmantes > 0 && !!plantilla,
  };
}
