/**
 * lib/billing/eliminarCobro.js — borrar el cobro, ¿y la cuota que lo creó?
 *
 * QUÉ RESUELVE (AV-0190 de Aumenta, «MOROSIDAD - Eliminar cobros futuros»:
 * «quieren saber que si al eliminar el cobro se borra la cuota — quieren tener
 * la opción de eliminar también la cuota»).
 *
 * Hasta hoy «Eliminar cobro» borraba el cobro y punto, sin decir una palabra de
 * la cuota. Y la cuota es lo que de verdad manda: sigue viva, sigue activa y
 * VUELVE A CREAR el cobro del mes en curso en cuanto alguien la toca o lanza
 * «Generar el mes» (`cobroDeCuota.js`). Quien borraba el cobro creyendo que
 * había dado de baja a la familia se lo encontraba otra vez a los dos días, sin
 * entender por qué. En producción (18/09/2026) había 9 cuotas de Aumenta sin un
 * solo cobro detrás: exactamente eso.
 *
 * Así que la pantalla ya no pregunta «¿sí o no?», pregunta QUÉ de las dos
 * cosas, con las consecuencias escritas. Aquí vive esa pregunta —una sola, para
 * las dos pantallas que borran cobros (Cobros y el cajón de caja)— y el reparto
 * de qué se lleva la cuota por delante. Los NÚMEROS de esa pregunta (cuántos
 * cobros más se lleva la cuota, cuántos de meses futuros) los cuenta el servidor
 * en `lib/billing/cuotaDelCobro.js`, que es también quien explica la diferencia
 * entre cobro y cuota — la pregunta literal del aviso AV-0190.
 *
 * ── Y BORRAR SIGUE SIN SER DAR DE BAJA ─────────────────────────────────────
 * Lo normal cuando una familia se va es la BAJA de la cuota (`endDate`), que
 * conserva lo cobrado y deja de generar. Borrar es para el alta equivocada. La
 * pregunta lo dice, porque es justo el momento en que hace falta saberlo.
 */

import { cobroSePuedeRehacer } from "./cuotas.js";

/** Las dos respuestas posibles (las lee la pantalla y las manda el fetch). */
export const SOLO_EL_COBRO = "solo-el-cobro";
export const COBRO_Y_CUOTA = "cobro-y-cuota";

/**
 * La pregunta que se hace al eliminar un cobro que nació de una cuota.
 *
 * Devuelve el objeto que espera `elegir()` de `components/ui/Dialogo.jsx`, para
 * que las dos pantallas pregunten exactamente lo mismo.
 *
 * ── LAS FRASES LAS TRAE EL SERVIDOR, CON LAS FILAS DELANTE ─────────────────
 * `cuota` es lo que devuelve `GET /api/billing/payments/[id]/cuota`
 * (`lib/billing/cuotaDelCobro.js`): ahí se ha contado cuántos cobros más tiene
 * esa cuota, cuántos se van con ella y cuántos son de meses que aún no han
 * llegado — que es justo lo que se estaba borrando a mano, uno por mes. Un
 * texto fijo no puede decir «se lleva 10 cobros más», y ese número es lo que
 * hace la decisión. Si la consulta no llegó, se pregunta igual con lo que se
 * sabe seguro: sin números, nunca inventados.
 *
 * @param {object} p
 * @param {string} [p.quien] a quién se le cobra ("María Pérez")
 * @param {string} [p.importe] ya formateado ("190,00 €")
 * @param {string} [p.factura] número de factura, si el cobro va contra una
 * @param {object} [p.cuota] lo que contestó el GET, o null si no llegó
 * @returns {{titulo: string, texto: string, opciones: Array<object>}}
 */
export function preguntaAlEliminarCobroDeCuota({ quien = "", importe = "", factura = "", cuota = null } = {}) {
  const deQuien = quien ? ` de ${quien}` : "";
  const conFactura = factura ? ` La factura ${factura} volverá a quedar pendiente.` : "";
  const cabecera = `Se borrará el cobro${deQuien}${importe ? ` de ${importe}` : ""}.${conFactura}`;

  // Lo que dice el servidor con las filas delante; si no llegó, lo que se sabe
  // seguro de todas formas: que son dos cosas distintas y que la cuota manda.
  const explicacion =
    cuota?.aviso ||
    "El cobro es lo que se paga un mes; la cuota es la orden que lo genera todos los meses. " +
      "No son lo mismo: borrar el cobro no borra la cuota.";
  const pistaSoloElCobro = cuota?.volvera === false
    ? "La cuota se queda como está y no volverá a generarlo."
    : "La cuota sigue activa y volverá a generar el cobro de este mes.";
  const pistaConCuota =
    cuota?.avisoAlBorrarLaCuota ||
    "Se deja de cobrar todos los meses. Lo ya cobrado o facturado se queda en el histórico.";

  const opciones = [
    { valor: SOLO_EL_COBRO, label: "Eliminar solo el cobro", pista: pistaSoloElCobro },
  ];
  // La cuota ya borrada no se puede volver a borrar: ofrecerlo sería mentir.
  if (cuota?.sePuedeBorrarLaCuota !== false) {
    opciones.push({
      valor: COBRO_Y_CUOTA,
      label: "Eliminar el cobro y la cuota",
      pista: pistaConCuota,
      tono: "peligro",
    });
  }

  return {
    titulo: "Eliminar el cobro",
    texto:
      `${cabecera}\n\n${explicacion}\n\n` +
      "Si la familia se va pero lo cobrado hasta ahora es bueno, lo que toca casi siempre es " +
      "darle de BAJA a la cuota en Cuotas: deja de cobrarse desde la fecha que digas y se conserva el histórico.",
    opciones,
  };
}

/**
 * Qué se lleva por delante borrar una cuota.
 *
 * Los cobros que todavía no son dinero ni papel se van con ella —son los que
 * ella misma creó y que ya no va a cobrar nadie—; el dinero cobrado y lo ya
 * facturado se queda, con su `cuotaId` apuntando a una cuota que ya no existe,
 * que es exactamente lo que pasó.
 *
 * @param {Array<object>} cobros filas de `Payment` de esa cuota
 * @param {object} [opciones]
 * @param {string} [opciones.salvo] id de un cobro que ya se ha borrado aparte
 * @returns {{seBorran: Array<object>, seQuedan: Array<object>, total: number}}
 */
export function repartoAlBorrarLaCuota(cobros, { salvo = null } = {}) {
  const todos = Array.isArray(cobros) ? cobros : [];
  const lista = salvo ? todos.filter((c) => String(c?.id) !== String(salvo)) : todos;
  const seBorran = [];
  const seQuedan = [];
  for (const c of lista) (cobroSePuedeRehacer(c).ok ? seBorran : seQuedan).push(c);
  return { seBorran, seQuedan, total: lista.length };
}
