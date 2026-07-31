/**
 * Contrato del Centro a nivel de CLIENTE (sprint Aumenta 2026-07, punto 1.1).
 *
 * (Fichero nuevo en /lib, regla #2: el contrato dejó de vivir en el PACIENTE.
 * Quien firma y quien paga son los padres —el cliente—, no el niño; con dos
 * hermanos en el centro había DOS contratos para UNA misma familia y con padres
 * separados no se sabía cuál de los dos tutores había firmado. La lógica de
 * "cuál es el contrato de esta familia" la comparten el endpoint del cliente, el
 * de pacientes y el futuro portal, así que vive aquí y no duplicada en cada uno.)
 *
 * El PDF NO se guarda en una columna propia: es una fila de `documents` (el
 * archivo central del CRM, source='contrato') y `clients.contract_document_id`
 * apunta a ella. Así el contrato aparece también en el buscador de Documentos y
 * no hay un segundo almacén de ficheros que mantener.
 *
 * El estado de FIRMA es cosa aparte (`ContractSignature` + lib/clients/guardians.js):
 * este fichero solo responde "¿hay contrato subido y cuál es?".
 */

import { contractFullySigned, signersOf } from "./guardians.js";

/** `documents.source` del contrato firmado de una familia. */
export const CONTRACT_SOURCE = "contrato";

/** Vista pública del documento del contrato (sin storagePath ni owner). */
export function serializeContract(doc) {
  if (!doc) return null;
  const j = doc.toJSON ? doc.toJSON() : doc;
  return {
    id: j.id,
    name: j.fileName,
    mimeType: j.mimeType,
    fileSize: Number(j.fileSize),
    uploadedAt: j.createdAt ?? null,
  };
}

/**
 * Documento del contrato de un cliente, o null.
 *
 * Primero por el puntero `contractDocumentId`; si apunta a un documento que ya
 * no existe (o de otro cliente: aislamiento), cae al último documento con
 * source='contrato' de ese cliente. El puntero puede quedarse obsoleto si
 * alguien borra el documento desde el módulo Documentos, y sin este respaldo la
 * ficha diría "sin contrato" teniendo uno subido.
 */
export async function findClientContract(Document, client) {
  if (!Document || !client) return null;
  const clientId = client.id ?? client;

  if (client.contractDocumentId) {
    const doc = await Document.findByPk(client.contractDocumentId);
    if (doc && String(doc.clientId) === String(clientId) && doc.source === CONTRACT_SOURCE) return doc;
  }
  return Document.findOne({
    where: { clientId, source: CONTRACT_SOURCE },
    order: [["createdAt", "DESC"]],
  });
}

/**
 * Quién tiene que firmar esta ficha.
 *
 * Normalmente son los tutores marcados como firmantes. Si la ficha no tiene
 * tutores estructurados (la mayoría: `guardians` es de julio de 2026 y el
 * grueso de los clientes es anterior), firma el TITULAR de la ficha. Sin este
 * respaldo, `contractFullySigned` devolvería siempre false —"no hay
 * firmantes"— y el portal dejaría a la familia encerrada en la pantalla del
 * contrato sin nadie que pudiera firmarlo.
 *
 * El `id` del titular es el del propio cliente: es lo que se guarda en
 * `ContractSignature.guardianId`, que solo necesita ser estable y único por
 * firmante dentro de la ficha.
 */
export function effectiveSigners(client) {
  const guardians = Array.isArray(client?.guardians) ? client.guardians : [];
  const marcados = signersOf(guardians);
  if (marcados.length) {
    return marcados.map((g) => ({ id: String(g.id), name: g.name || "Tutor/a", email: g.email ?? null, titular: false }));
  }
  if (!client?.id) return [];
  return [{ id: String(client.id), name: client.name || "Titular", email: client.email ?? null, titular: true }];
}

/**
 * Situación del contrato de una familia, tal cual la necesitan la ficha del
 * CRM y el portal.
 *
 * `contratoEnPapel` = el PDF firmado que el equipo subió a la ficha. Cuenta
 * como firmado y desactiva la firma web: quien ya firmó en papel no tiene que
 * volver a firmar en pantalla (decisión de Rodrigo, 31/07).
 */
export function contractSituation({ client, signatures, contratoEnPapel = false }) {
  const firmantes = effectiveSigners(client);
  const firmados = new Set((signatures ?? []).map((s) => String(s.guardianId ?? s.guardian_id).toLowerCase()));
  const yaFirmaron = firmantes.filter((g) => firmados.has(g.id.toLowerCase()));
  const pendientes = firmantes.filter((g) => !firmados.has(g.id.toLowerCase()));
  return {
    firmantes: firmantes.length,
    firmas: yaFirmaron.length,
    pendientes: pendientes.map((g) => g.name),
    viaPapel: !!contratoEnPapel,
    contratoCompleto: !!contratoEnPapel || (firmantes.length > 0 && pendientes.length === 0),
  };
}

/** Compatibilidad: la ficha del CRM solo quería el recuento. */
export function signatureStatus(client, signatures, contratoEnPapel = false) {
  return contractSituation({ client, signatures, contratoEnPapel });
}

// Reexportado para que el portal no tenga que importar de dos sitios.
export { contractFullySigned };
