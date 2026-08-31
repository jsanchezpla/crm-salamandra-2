/**
 * lib/fichaje/parsers/index.js — QUÉ LECTOR usa cada cliente.
 *
 * Es la costura del módulo, y conviene entenderla antes de tocar nada:
 *
 *   El módulo Fichaje es UNIVERSAL —tablas, endpoints, pantallas, totales y
 *   avisos son los mismos para todos— y lo único que cambia de un cliente a
 *   otro es CÓMO SE LEE SU EXCEL. Cada reloj de fichar escupe un formato
 *   distinto y cada centro lo retoca a su manera; pretender un formato común
 *   sería pedirle al cliente que cambie su hoja, que es justo lo que no va a
 *   hacer.
 *
 * Añadir un cliente nuevo = escribir un fichero en esta carpeta y una línea en
 * `POR_TENANT`. Nada más: ni migración, ni endpoint, ni pantalla.
 *
 * Un lector exporta:
 *   meta   { key, nombre, descripcion }
 *   parse(workbook, { periodo }) → { filas, anotaciones, avisos, nombres }
 *
 * y su contrato es el mismo en los tres casos importantes: no lanza nunca,
 * devuelve lo que ha entendido y lo que no, y jamás adivina a quién pertenece
 * una fila —eso lo decide el mapeo de nombres, que es una persona.
 */

import * as aumenta from "./aumenta.js";
import * as aumentaReloj from "./aumentaReloj.js";
import * as generico from "./generico.js";

export const PARSERS = {
  [aumenta.meta.key]: aumenta,
  // El volcado del reloj de Aumenta. Ningún tenant apunta aquí directo: el
  // lector `aumenta` reconoce el formato y delega solo (mismo cliente, dos
  // ficheros según la época que se importe).
  [aumentaReloj.meta.key]: aumentaReloj,
  [generico.meta.key]: generico,
};

/**
 * Lector por tenant. Quien no esté aquí usa el genérico, que es el formato de
 * la plantilla descargable — así un cliente nuevo puede usar el módulo el
 * primer día sin que nadie le escriba código.
 */
const POR_TENANT = {
  aumenta: "aumenta",
};

export function parserDeTenant(slug) {
  const key = POR_TENANT[slug] || generico.meta.key;
  return PARSERS[key] || generico;
}

/** Para la pantalla: qué lector le va a tocar y cómo se llama. */
export function describirParser(slug) {
  const p = parserDeTenant(slug);
  return { ...p.meta, esPropio: Boolean(POR_TENANT[slug]) };
}
