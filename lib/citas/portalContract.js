/**
 * portalContract — el Contrato del Centro visto desde el PORTAL de la familia
 * (sprint Aumenta 2026-07, puntos 2.1 y 2.2).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten tres endpoints públicos —el
 * estado del contrato, la firma y «Mis documentos», que se cierra mientras
 * falte alguna firma—. Los ficheros de rutas de Next solo deben exportar los
 * manejadores HTTP, así que la lógica común no puede vivir en uno de ellos.)
 *
 * Qué se firma, por orden de preferencia:
 *
 * 1. Las PLANTILLAS ESTRUCTURADAS del centro (`ContractTemplate`), desde el
 *    04/08/2026: piden datos, enseñan el clausulado en pantalla y llevan una
 *    aceptación por anexo. Es lo que necesita el contrato de tunutrilaura.
 * 2. Si no las hay, el contrato ESTÁNDAR en PDF (`documents.source =
 *    'contract_template'`, uno por tenant) con una firma y nada más. Es lo que
 *    sigue usando Aumenta y no se toca.
 *
 * En los dos casos: si el equipo ya subió a la ficha el contrato firmado en
 * PAPEL, cuenta como firmado y no se pide firma web (decisión de Rodrigo,
 * 31/07).
 */

import { forbidden, notFound, unauthorized } from "../utils/apiResponse.js";
import { verifyPortalSession, readBearer } from "./portalSession.js";
import { normalizeEmail } from "./validation.js";
import { resolvePortalAccess } from "./portalClient.js";
import { contractSituation, effectiveSigners, findClientContract } from "../clients/clientContract.js";
import { serializarPlantilla, situacionDocumentos, camposDe } from "../clients/contratoFirma.js";
import { camposQueFaltan, separarPorMomento } from "../clients/datosFicha.js";

export const TEMPLATE_SOURCE = "contract_template";

/** `templateKey` del contrato de toda la vida: PDF suelto y una sola firma. */
export const FIRMA_SIMPLE = "simple";

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

/** Plantillas estructuradas activas del centro. El contrato principal, primero. */
export async function plantillasActivas(tenantModels) {
  const { ContractTemplate } = tenantModels;
  if (!ContractTemplate) return [];
  try {
    // `onlyMinors ASC` deja el contrato principal delante del consentimiento
    // parental, que es el orden en el que hay que firmarlos: el segundo solo
    // aparece si la fecha de nacimiento del primero dice que es menor.
    return await ContractTemplate.findAll({
      where: { active: true },
      order: [
        ["onlyMinors", "ASC"],
        ["createdAt", "ASC"],
      ],
    });
  } catch (err) {
    if (!tablaAusente(err)) throw err;
    return [];
  }
}

// Qué documento le toca a quién sale de `lib/clients/contratoFirma.js`: no
// depende de la sesión ni de HTTP, y allí se puede probar sin servidor.

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

  // ── Contrato estructurado (datos + anexos) ────────────────────────────────
  const plantillas = await plantillasActivas(tenantModels);
  const estructurado = plantillas.length > 0;
  const docs = situacionDocumentos({ plantillas, firmas, firmantes, firmante, client });

  // Con plantillas estructuradas la firma "mía" es la del documento que toca
  // ahora; sin ellas, la única que hay (la del contrato de siempre).
  const siguiente = estructurado ? docs.siguiente : null;
  const miFirma = estructurado
    ? (siguiente ? null : docs.misFirmas[docs.misFirmas.length - 1] ?? null)
    : docs.misFirmas.find((f) => f.templateKey === FIRMA_SIMPLE) ?? docs.misFirmas[0] ?? null;

  if (estructurado) {
    situacion.firmas = firmantes.length - docs.leFalta.length;
    situacion.pendientes = docs.leFalta.map((f) => f.name);
    situacion.contratoCompleto = enPapel || docs.completo;
  }

  return {
    situacion,
    firmante,
    miFirma,
    plantilla,
    // Lo que hay que enseñar AHORA: un solo documento cada vez, con sus campos
    // y su clausulado. `null` = este centro no usa contrato estructurado.
    siguienteDocumento: siguiente ? serializarPlantilla(siguiente, client) : null,
    // Los datos de la FICHA que faltan, repartidos en dos momentos
    // (04/08/2026, Rodrigo: «después de firmar los contratos se piden los
    // datos, no antes»):
    //   · `datosPendientes` — los marcados `previo` en la plantilla, hoy solo
    //     la fecha de nacimiento. No pueden esperar: deciden si además hace
    //     falta el consentimiento del tutor, y sin saberlo ese documento
    //     aparecía a mitad de firmar.
    //   · `datosPosteriores` — todo lo demás (domicilio, facturación…). Se
    //     piden cuando ya no queda nada que firmar: pedírselos antes es un
    //     peaje en la puerta a quien todavía no ha decidido nada.
    // Se calculan sobre TODOS los documentos y no solo sobre el siguiente: si
    // no, al acabar el último no quedaría nada que pedir.
    ...(() => {
      // Deduplicado por destino: el contrato y el consentimiento parental
      // piden ambos «nombre», y preguntar dos veces por el mismo hueco de la
      // ficha haría que la segunda saliera ya rellena y sin sentido.
      const vistos = new Set();
      const todos = plantillas.flatMap((p) => camposDe(p)).filter((c) => {
        if (!c.ficha || vistos.has(c.ficha)) return false;
        vistos.add(c.ficha);
        return true;
      });
      const huecos = camposQueFaltan(todos, client);
      const { previos, posteriores } = separarPorMomento(huecos);
      // Los previos solo cuentan mientras quede algo que firmar: a quien ya
      // firmó todo no se le vuelve a parar por una fecha.
      return {
        datosPendientes: siguiente ? previos : [],
        datosPosteriores: posteriores,
      };
    })(),
    documentosPendientes: estructurado ? docs.pendientes.length : 0,
    estructurado,
    // El PDF que le toca a ESTA familia: el suyo firmado en papel si lo hay, y
    // si no el contrato estándar del centro. Se devuelve ya resuelto para que
    // la descarga no vuelva a buscarlo (y no lo busque MAL: la sesión del
    // portal trae la ficha sin `contractDocumentId`).
    documento: contratoFicha ?? plantilla,
    enPapel,
    // SIN CONTRATO SUBIDO (o sin plantilla activa) NO SE BLOQUEA NADA (arreglo
    // del 31/07, el mismo día del despliegue). El cerrojo se activaba con solo
    // tener el portal encendido, y el único tenant con portal era nutri_laura,
    // que entonces no usaba contratos: a sus pacientes REALES les apareció una
    // pantalla pidiéndoles firmar un documento que no existía. Que el centro
    // suba su contrato —o active una plantilla— es justo la señal de que quiere
    // pedir la firma.
    bloqueado: !situacion.contratoCompleto && situacion.firmantes > 0 && (estructurado || !!plantilla),
  };
}
