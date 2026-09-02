/**
 * lib/billing/nifCliente.js — el NIF/CIF con el que se factura a un cliente.
 *
 * (Fichero nuevo en /lib, regla #2: la respuesta a «¿qué NIF lleva esta
 * factura?» la necesitan SEIS sitios —el PDF, el candado de emisión, el
 * listado, el libro registro de IVA, el Excel por cliente y la analítica— y
 * hasta hoy cada uno leía `client.taxId` por su cuenta. Con dos columnas en
 * juego, seis lecturas sueltas garantizan que el PDF que se le manda a la
 * familia y el libro de IVA que se le manda a la gestoría acaben diciendo
 * cosas distintas de la MISMA factura. Eso no es un descuadre de pantalla: son
 * dos documentos oficiales que no cuadran.)
 *
 * ── LAS DOS COLUMNAS ────────────────────────────────────────────────────────
 *   `taxId`        el documento de la PERSONA de la ficha. En un centro
 *                  clínico es el DNI/NIE del titular, y es el que sale en el
 *                  contrato que firma en el área privada.
 *   `fiscalTaxId`  a nombre de quién se emite la FACTURA (08/08/2026, petición
 *                  del Centro Aumenta). Puede ser el otro progenitor, o una
 *                  empresa con CIF.
 *
 * El respaldo a `taxId` es OBLIGATORIO y no una comodidad: en spain_enzymes y
 * en demo los clientes son empresas cuyo `taxId` YA es su CIF. Sin él, sus
 * facturas empezarían a salir sin NIF el día del despliegue.
 */

/** El NIF/CIF que va en la factura, o null si no hay ninguno. */
export function nifDeCliente(client) {
  const preferido = client?.fiscalTaxId ?? client?.fiscal_tax_id;
  const respaldo = client?.taxId ?? client?.tax_id;
  const elegido = String(preferido ?? "").trim() || String(respaldo ?? "").trim();
  return elegido || null;
}

/** El nombre que va en la factura: la razón social si la hay, si no el de la ficha. */
export function nombreFiscalDeCliente(client) {
  const elegido = String(client?.fiscalName ?? "").trim() || String(client?.name ?? "").trim();
  return elegido || null;
}

/**
 * Los atributos que hay que pedirle a Sequelize cuando se incluye el cliente
 * en una consulta de facturación.
 *
 * Existe porque los `include` de este módulo llevan lista blanca de
 * `attributes`, y una lista blanca a la que se le olvida un campo no da error:
 * devuelve `undefined` en silencio. Así, añadir un campo fiscal se hace en un
 * sitio y no en cinco consultas repartidas por cuatro carpetas.
 */
// `guardians` desde el 02/09/2026: una factura puede ir a nombre de un tutor
// de la familia, y el listado tiene que poder decir «a nombre de quién».
export const ATRIBUTOS_CLIENTE_FACTURA = ["id", "name", "fiscalName", "taxId", "fiscalTaxId", "guardians"];
