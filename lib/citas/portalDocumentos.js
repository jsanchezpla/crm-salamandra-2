/**
 * Qué documentos ve —y puede abrir— una paciente en su portal.
 *
 * ── POR QUÉ ESTO VIVE AQUÍ Y NO EN CADA RUTA (06/08/2026) ───────────────────
 * La condición estaba escrita DOS veces: en el listado
 * (`citas-portal/documents`) y en la descarga (`citas-portal/documents/[id]`).
 * Al publicar la copia del contrato firmado se añadió `contrato_firmado` al
 * listado y no a la descarga, así que el portal enseñaba el contrato y los
 * consentimientos… y al pulsar encima respondía 404: «No pudimos abrir el
 * documento». La paciente veía sus papeles y no podía abrir ninguno.
 *
 * Es una regla de seguridad duplicada, que es la peor clase de duplicado: las
 * dos copias tienen que decir lo mismo o el portal miente en una de las dos
 * direcciones —enseña de más o abre de menos—. Ahora se escribe una vez.
 *
 * Fuentes:
 *   · `ficha`             — lo que el equipo sube a la ficha y marca visible.
 *   · `informe`           — informes clínicos publicados con «Enviar al paciente».
 *   · `contrato_firmado`  — SU copia del contrato y los consentimientos, con
 *                           los datos, el clausulado y la firma dentro.
 */

import { Op } from "sequelize";

export const FUENTES_VISIBLES = ["ficha", "informe", "contrato_firmado"];

/**
 * Filtro de Sequelize con la condición completa: de SU ficha, de una fuente
 * publicable y compartido con ella (o subido por ella misma).
 */
export function wherePaciente(clientId) {
  return {
    clientId,
    source: { [Op.in]: FUENTES_VISIBLES },
    [Op.or]: [{ clientVisible: true }, { uploadedByClient: true }],
  };
}
