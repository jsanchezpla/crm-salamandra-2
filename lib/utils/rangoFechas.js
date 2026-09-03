/**
 * lib/utils/rangoFechas.js — un periodo «desde / hasta» leído de la URL, en
 * un solo sitio (03/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: nació dentro de
 * `lib/clinica/estadisticas.js` y lo necesitaba igual el módulo Productos para
 * sus estadísticas de venta. Dos copias de «qué es un rango válido» divergen
 * la primera vez que alguien arregla una: por ejemplo el desfase de zona
 * horaria que documenta `fechaLocal.js`, que ya se arregló una vez y no puede
 * volver a arreglarse en un sitio y no en el otro.)
 *
 * Lo PURO (`fechaISO`, `rangoDe`) vive en `fechaLocal.js` y aquí se re-exporta:
 * este fichero importa `apiResponse.js` → `next/server`, y eso no se puede
 * cargar desde una prueba de `npm test`.
 */

import { error } from "./apiResponse.js";
import { fechaISO, rangoDe } from "./fechaLocal.js";

export { fechaISO, rangoDe };

/** Rango pedido en la URL, o el mes en curso. Devuelve `{ rango }` o `{ veto }`. */
export function rangoPedido(request) {
  const sp = new URL(request.url).searchParams;
  const hoy = new Date();
  const primeroDeMes = fechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const rango = rangoDe(sp.get("desde") || primeroDeMes, sp.get("hasta") || fechaISO(hoy));
  if (!rango) return { veto: error("Fechas inválidas: se espera desde/hasta en formato AAAA-MM-DD", 422) };
  return { rango };
}
