/**
 * lib/billing/camposGasto.js — qué campos del cuerpo acepta un gasto (Cost).
 *
 * (Fichero nuevo en /lib, regla #2: mismo patrón que lib/billing/parseSort.js,
 * una regla que comparten POST /api/billing/costs y PATCH /costs/[id].)
 *
 * QUÉ RESUELVE: la lista de campos que dejaban pasar esos dos endpoints estaba
 * escrita dos veces, y en las dos faltaba `supplierId`. La columna existía, el
 * import de la contabilidad de Aumenta la rellenaba y `DELETE /api/proveedores/[id]`
 * la contaba para negarse a borrar un proveedor con gastos; pero un gasto dado
 * de alta desde el CRM nacía siempre sin proveedor, así que el «cuánto llevamos
 * gastado con este proveedor» se quedaba congelado en lo importado sin que nada
 * chillara. Con la lista en un solo sitio, el próximo campo no puede entrar
 * solo en la mitad de los endpoints.
 *
 * Aquí NO se valida nada que necesite preguntarle a la base (que el proveedor
 * sea de este tenant, que el empleado exista): eso es del endpoint.
 */

/**
 * Relaciones opcionales del gasto. El desplegable vacío llega como `""` y estas
 * columnas son UUID (salvo `partnerId`, que es un id de settings), así que `""`
 * tiene que salir de aquí como `null` o Postgres rechaza la fila entera.
 */
const RELACIONES = ["employeeId", "partnerId", "clientId", "supplierId", "inventoryProductId"];

/** Lo mismo, para los textos opcionales: `""` guardado es basura, no un dato. */
const VACIO_ES_NULO = [...RELACIONES, "attachmentUrl"];

/**
 * Campos del gasto que se aceptan del cuerpo de la petición.
 *
 * `taxAmount` y `total` NO están y no pueden estar: se calculan desde
 * `taxBase × vatRate` en el endpoint. Si se aceptaran, un cliente podría mandar
 * un IVA que no cuadra con la base y el Libro IVA dejaría de sumar.
 * `projectId` tampoco: es una FK durmiente sin UI (ver Cost.model.js).
 */
export const CAMPOS_GASTO = [
  "type",
  "category",
  "description",
  "incurredAt",
  ...RELACIONES,
  "attachmentUrl",
  "vatDeductible",
];

function vacioEsNulo(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto === "" ? null : texto;
}

/**
 * Devuelve SOLO las claves que vengan en el cuerpo, ya normalizadas. Que una
 * clave falte y que llegue vacía son cosas distintas: la primera no se toca (el
 * PATCH deja el valor que había), la segunda borra el dato.
 *
 * @param {object} body cuerpo de la petición, tal cual
 * @returns {object} objeto listo para `create()` o `update()`
 */
export function camposGasto(body) {
  const campos = {};
  if (!body || typeof body !== "object") return campos;

  for (const clave of CAMPOS_GASTO) {
    if (!(clave in body)) continue;
    if (clave === "vatDeductible") campos[clave] = !!body[clave];
    else if (VACIO_ES_NULO.includes(clave)) campos[clave] = vacioEsNulo(body[clave]);
    else campos[clave] = body[clave];
  }

  return campos;
}
