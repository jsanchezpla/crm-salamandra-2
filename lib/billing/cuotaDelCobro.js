/**
 * lib/billing/cuotaDelCobro.js — qué le pasa a la CUOTA cuando se borra un cobro
 * (18/09/2026, AV-0190 de Aumenta, «MOROSIDAD - Eliminar cobros futuros»).
 *
 * ── LA PREGUNTA, EN SUS PALABRAS ───────────────────────────────────────────
 *
 *   «No sabemos si eliminando los cobros uno a uno (que es un peñazo y se podría
 *    poner de una forma más ágil), se elimina la cuota, o para vosotros es lo
 *    mismo cobro que cuota??»
 *
 * O sea: no es un fallo, es que la pantalla nunca ha dicho si cobro y cuota son
 * la misma cosa. Y no lo son:
 *
 *   · el COBRO es lo que una familia paga UN mes — una fila de dinero;
 *   · la CUOTA es la orden que genera ese cobro TODOS los meses.
 *
 * Borrar el cobro no toca la orden, así que con la cuota viva el cobro vuelve en
 * cuanto alguien la edita o genera el mes (`lib/billing/cobroDeCuota.js`). Desde
 * fuera eso no se lee como «la cuota lo ha regenerado»: se lee como que el
 * programa no borra. Y en Aumenta no es el caso raro sino el normal: 304 de sus
 * 352 cobros salen de una cuota y 291 de sus 295 cuotas siguen activas (foto de
 * producción del 18/09/2026).
 *
 * ── Y POR QUÉ ESO ES TAMBIÉN «LOS COBROS FUTUROS» ──────────────────────────
 * Una cuota con tramo deja PUESTOS los cobros de todos sus meses firmados
 * (`lib/billing/cobrosDelTramo.js`), no solo el que corre: en producción hay
 * cuotas con diez pendientes por delante, hasta junio de 2027. Quitar a esa
 * familia era borrar diez filas a mano — el «peñazo». Borrar la cuota se los
 * lleva todos de una vez, así que decir esto bien no es solo un aviso: es la
 * forma ágil de hacerlo que estaban pidiendo.
 *
 * Al revés SÍ estaba contado: borrar una cuota pregunta cuántos cobros se lleva
 * por delante (`app/api/billing/cuotas/[id]/route.js`, 01/09/2026). Esto es el
 * mismo aviso mirando desde el otro lado.
 *
 * Aquí vive solo la REGLA (y sus frases), sin base de datos delante, para que se
 * pueda probar lo que devuelve: `scripts/_smoke-cuota-del-cobro.mjs`.
 */

import { cuotaDeBaja, mesLegible, mesVigente } from "./cuotas.js";

/** El mes 'AAAA-MM' de un cobro, venga como 'AAAA-MM-DD' o como Date. */
export function mesDelCobro(cobro) {
  const v = cobro?.periodMonth ?? null;
  if (!v) return null;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
}

/** «1 cobro» / «3 cobros», que la frase se lee en voz alta. */
function cobros(n) {
  return `${n} ${n === 1 ? "cobro" : "cobros"}`;
}

/**
 * Qué hay que contarle a quien está a punto de borrar este cobro.
 *
 * @param {object} p
 * @param {object|null} p.cobro    la fila de Payment (solo se le miran `cuotaId` y `periodMonth`)
 * @param {object|null} p.cuota    la fila de Cuota de la que salió, o null si no la hay / ya no existe
 * @param {number} p.otrosCobros   cobros de esa cuota SIN contar este
 * @param {number} p.otrosBorrables  de esos, los que se irían con la cuota (pendientes y rehacibles)
 * @param {number} p.otrosFuturos    de esos borrables, los de meses que aún no han llegado
 * @param {string} [p.hoy]         'AAAA-MM-DD' (por defecto, hoy en Madrid)
 * @returns {{estado: string, deCuota: boolean, vigente: boolean, volvera: boolean,
 *            sePuedeBorrarLaCuota: boolean, mes: string|null, aviso: string|null,
 *            avisoAlBorrarLaCuota: string|null, seQuedan: number}}
 *   estado: `sin-cuota` · `cuota-borrada` · `vigente` · `de-baja`
 */
export function loQuePasaConLaCuota({
  cobro,
  cuota = null,
  otrosCobros = 0,
  otrosBorrables = 0,
  otrosFuturos = 0,
  hoy = null,
} = {}) {
  const nada = {
    estado: "sin-cuota", deCuota: false, vigente: false, volvera: false,
    sePuedeBorrarLaCuota: false, mes: null, aviso: null, avisoAlBorrarLaCuota: null, seQuedan: 0,
  };
  if (!cobro?.cuotaId) return nada;

  const mes = mesDelCobro(cobro);
  const cuando = mesLegible(mes || mesVigente());

  // La cuota se borró antes que su cobro: el cobro es lo único que queda de
  // ella, y borrarlo no arrastra nada. Pasa, y no es raro: borrar una cuota deja
  // atrás los cobros que ya eran dinero o papel.
  if (!cuota) {
    return {
      ...nada,
      estado: "cuota-borrada",
      deCuota: true,
      aviso: "Este cobro salió de una cuota mensual que ya no existe, así que no volverá a generarse solo.",
    };
  }

  const deBaja = cuotaDeBaja(cuota, hoy || undefined);
  // Sin contar este, los que NO se van con la cuota: ya son dinero o papel.
  const seQuedan = Math.max(0, Number(otrosCobros || 0) - Number(otrosBorrables || 0));
  const seVan = Math.max(0, Number(otrosBorrables || 0));
  const futuros = Math.min(seVan, Math.max(0, Number(otrosFuturos || 0)));

  const avisoAlBorrarLaCuota = [
    "Se borrará también la cuota mensual de esta familia: dejará de generar cobros.",
    // Los meses que aún no han llegado se nombran aparte: son los que había que
    // borrar uno a uno, y son la razón de que esta opción exista.
    seVan > 0
      ? `Se lleva ${cobros(seVan)} más que siguen pendientes` +
        (futuros > 0 ? `, ${futuros === seVan ? "todos" : `${futuros}`} de meses que aún no han llegado.` : ".")
      : null,
    seQuedan > 0
      ? `${cobros(seQuedan)} ya cobrados o facturados se quedan en el histórico.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  // La diferencia entre las dos palabras, que es lo que preguntaron. Va delante
  // en los dos casos: quien lee esto puede no saber todavía que son dos cosas.
  const queEsQue =
    "El cobro es lo que se paga un mes; la cuota es la orden que lo genera todos los meses. No son lo mismo.";

  if (deBaja) {
    return {
      estado: "de-baja", deCuota: true, vigente: false, volvera: false,
      sePuedeBorrarLaCuota: true, mes, seQuedan, avisoAlBorrarLaCuota,
      aviso:
        `${queEsQue} Este cobro salió de la cuota de esta familia, que YA ESTÁ DE BAJA: ` +
        "no volverá a generarlo. La cuota se queda como está, explicando lo que se cobró.",
    };
  }

  return {
    estado: "vigente", deCuota: true, vigente: true, volvera: true,
    sePuedeBorrarLaCuota: true, mes, seQuedan, avisoAlBorrarLaCuota,
    aviso:
      `${queEsQue} Este cobro salió de la cuota de esta familia, y LA CUOTA SIGUE ACTIVA: ` +
      `borrar el cobro no la borra, y volverá a generar el de ${cuando} en cuanto se edite ` +
      "la cuota o se genere el mes.",
  };
}
