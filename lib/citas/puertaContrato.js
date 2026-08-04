/**
 * Puerta de contratos: quién puede reservar sin haber firmado.
 *
 * Nace de nutri_laura (04/08/2026, Rodrigo). El contrato del centro tapaba el
 * PORTAL —«Mis citas», «Mis documentos»— pero la agenda pública iba por otra
 * puerta y esa estaba abierta: cualquiera con el enlace elegía hora y dejaba la
 * tarjeta retenida sin haber firmado nada. El orden que quiere la consulta es
 * firmar → pedir cita → pagar, y hasta hoy el sistema no lo comprobaba en
 * ningún sitio.
 *
 * ── LA EXCEPCIÓN QUE LE DA SENTIDO ──────────────────────────────────────────
 * La VALORACIÓN INICIAL se salta la puerta (el tipo de cita marcado con
 * `isInitialAssessment`). Es la primera visita, cuando la persona todavía no ha
 * decidido si empieza: pedirle que firme el acuerdo de servicio para conocer a
 * la profesional la espanta en la puerta. Sin esta excepción la puerta sería un
 * muro: nadie podría entrar nunca, porque para firmar hay que ser ya paciente.
 *
 * ── HERMANA, NO GEMELA, DE LA PUERTA DE ADMISIÓN ────────────────────────────
 * `puertaFormulario.js` pregunta «¿te admito como paciente?» y mira la bandeja
 * de solicitudes. Esta pregunta «¿has firmado lo que hay que firmar?» y mira
 * las firmas de la ficha. Son independientes: se pueden encender por separado y
 * una reserva puede chocar con las dos.
 *
 * Apagada por defecto. Se enciende por tenant en Configuración → Citas, y solo
 * hace algo si el centro tiene contrato configurado: sin plantillas ni contrato
 * en papel, exigir una firma dejaría fuera al 100% de la gente por algo que no
 * existe.
 */

import { Op } from "sequelize";

import { contractSituation, effectiveSigners, findClientContract } from "../clients/clientContract.js";
import { situacionDocumentos } from "../clients/contratoFirma.js";

const TEMPLATE_SOURCE = "contract_template";

/** Errores de «esa tabla no existe en este schema» (42P01). */
function tablaAusente(err) {
  return err?.parent?.code === "42P01" || err?.original?.code === "42P01";
}

/** ¿Este tenant exige contratos firmados para reservar? */
export function exigeContratoFirmado(tenant) {
  return tenant?.settings?.citas?.contratoObligatorio === true;
}

/** ¿Esta cita se salta la puerta por ser la primera visita? */
export function esCitaDeValoracion(eventType) {
  return Boolean(eventType?.isInitialAssessment);
}

/**
 * Estado de firmas de un email.
 *
 *   "firmado"       — no le falta ninguna firma: puede reservar
 *   "pendiente"     — tiene ficha y le falta firmar algo
 *   "sin_ficha"     — no hay nadie con ese correo: no ha empezado
 *   "sin_contrato"  — el centro no tiene contrato que firmar → NO se bloquea
 *   "sin_datos"     — no se pudo mirar (tabla ausente, BD caída) → NO se bloquea
 *
 * ⚠️ Al contrario que la puerta de admisión, los dos casos de «no se pudo
 * mirar» ABREN en vez de cerrar. Y es a propósito: aquella protege de que entre
 * gente sin admitir, mientras que esta solo ordena el papeleo de quien ya es
 * paciente. Dejar a la consulta entera sin poder dar citas porque una tabla no
 * existe es mucho peor que una firma que llega tarde.
 *
 * Se mira por email —lo único que compartimos con una reserva anónima— y con
 * `iLike`, porque nadie escribe su correo dos veces igual.
 */
export async function estadoDeContratos(tenantModels, email) {
  const { Client, ContractTemplate, ContractSignature, Document } = tenantModels ?? {};
  if (!Client || !email) return "sin_datos";

  let client;
  try {
    client = await Client.findOne({
      where: {
        [Op.or]: [
          { email: { [Op.iLike]: email } },
          { portalEmail: { [Op.iLike]: email } },
        ],
      },
    });
  } catch (err) {
    if (!tablaAusente(err)) throw err;
    return "sin_datos";
  }
  if (!client) return "sin_ficha";

  // ¿Hay algo que firmar en este centro? Plantillas estructuradas o el PDF del
  // contrato de siempre. Si no hay ninguna de las dos, no hay puerta.
  let plantillas = [];
  if (ContractTemplate) {
    try {
      plantillas = await ContractTemplate.findAll({ where: { active: true }, order: [["createdAt", "ASC"]] });
    } catch (err) {
      if (!tablaAusente(err)) throw err;
      return "sin_datos";
    }
  }

  let contratoFicha = null;
  let hayPlantillaPdf = false;
  if (Document) {
    try {
      contratoFicha = await findClientContract(Document, client);
      hayPlantillaPdf = !!(await Document.findOne({ where: { source: TEMPLATE_SOURCE } }));
    } catch (err) {
      if (!tablaAusente(err)) throw err;
    }
  }
  if (plantillas.length === 0 && !hayPlantillaPdf && !contratoFicha) return "sin_contrato";

  // El contrato firmado EN PAPEL vale igual que el firmado aquí: la familia ya
  // firmó, y volver a pedírselo por pantalla sería pedirlo dos veces.
  if (contratoFicha) return "firmado";

  let firmas = [];
  if (ContractSignature) {
    try {
      firmas = await ContractSignature.findAll({ where: { clientId: client.id } });
    } catch (err) {
      if (!tablaAusente(err)) throw err;
      return "sin_datos";
    }
  }

  if (plantillas.length > 0) {
    const firmantes = effectiveSigners(client);
    const docs = situacionDocumentos({ plantillas, firmas, firmantes, firmante: null, client });
    return docs.completo ? "firmado" : "pendiente";
  }

  // Contrato clásico (un PDF, una firma).
  const situacion = contractSituation({ client, signatures: firmas, contratoEnPapel: false });
  return situacion.contratoCompleto ? "firmado" : "pendiente";
}

/** ¿Este estado deja pasar? Todo lo que no sea «le falta firmar» pasa. */
export function dejaReservar(estado) {
  return estado !== "pendiente" && estado !== "sin_ficha";
}

/**
 * Qué se le responde a quien todavía no puede reservar.
 *
 * `identificado` = la petición trae sesión verificada del portal, así que
 * sabemos que el correo es suyo de verdad. A una petición anónima no se le
 * puede decir si un email concreto tiene ficha o no: eso convertiría este
 * endpoint en un buscador de pacientes de la consulta. Por eso a los anónimos
 * se les da siempre el mismo texto.
 */
export function mensajeDeContrato(estado, { identificado = false, nombre = null, valoracion = null } = {}) {
  const quien = nombre ? ` de ${nombre}` : "";
  // Lo que de verdad puede hacer quien se topa con esto: pedir la primera
  // visita, que no exige nada. Sin ella el aviso sería un callejón sin salida.
  const salida = valoracion
    ? ` Si es tu primera vez, puedes pedir una ${valoracion.toLowerCase()} sin firmar nada.`
    : "";

  if (identificado && estado === "pendiente") {
    return {
      codigo: "CONTRATO_PENDIENTE",
      titulo: "Te falta firmar",
      texto: `Antes de dar cita hace falta que firmes los documentos del centro. Los tienes en tu área privada y se firman en un minuto.${salida}`,
      irAlPortal: true,
    };
  }

  return {
    codigo: "CONTRATO_REQUERIDO",
    titulo: "Antes de reservar, firma los documentos",
    texto: `Para dar cita hace falta tener firmados los documentos${quien}. Se hacen desde tu área privada.${salida}`,
    irAlPortal: true,
  };
}
