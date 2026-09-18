/**
 * lib/clinica/cobrosDelDiagnostico.js — el diagnóstico se cobra POR FASES, y
 * cada fase se manda a cobro desde el expediente (18/09/2026, Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: las mismas dos fases las pintan la ficha
 * del expediente —con sus botones— y las escribe `POST /[id]/cobrar`, y el
 * importe de la segunda tiene que ser EXACTAMENTE el que anuncia la primera.
 * Escrito en los dos sitios, el día que alguien cambiara el precio de la
 * entrevista la pantalla ofrecería 300 € y el endpoint apuntaría 350. PURO a
 * propósito: sin ORM, para que lo importe también el navegador.)
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * Hasta hoy el dinero de un diagnóstico nacía SOLO en las dos decisiones:
 * «Parar» apuntaba los 50 € de la entrevista y «Seguir» apuntaba el producto
 * entero (350 € / 650 €). O sea que la familia que sigue —la mayoría— nunca
 * pagaba la entrevista aparte: se le cobraba todo junto al final, y el centro
 * no tenía forma de pedir los 50 € el día de la entrevista.
 *
 * Rodrigo: «poder facturar por fases el diagnóstico (50 € EI y 600 o 300 del
 * diagnóstico) y poder hacerlo desde la pestaña de diagnóstico, mandarlo a
 * cobro y generar un cobro desde ahí».
 *
 * Así que son DOS FASES, y las dos se generan a mano desde el expediente:
 *
 *   1. ENTREVISTA — 50 € (o el concepto «Entrevista Inicial» del centro).
 *      Se manda a cobro el día de la entrevista, decida lo que decida la
 *      familia después. Queda atada en `diagnosticos.entrevista_payment_id`.
 *   2. PRODUCTO — lo que queda del producto una vez descontada la entrevista:
 *      300 € en el simple (350 − 50) y 600 € en el completo (650 − 50). El
 *      descuento no es nuevo ni es de este fichero: lo calcula
 *      `cobroDelProducto` con `descuentoDeLaEntrevista`, y por eso cobrar la
 *      entrevista ANTES de «Seguir» deja el producto en 300/600 solo.
 *
 * ── EL ORDEN IMPORTA, Y SE DICE ────────────────────────────────────────────
 * «Seguir» sigue apuntando el cobro del producto con lo que valga en ESE
 * momento: si nadie cobró la entrevista, vale el producto entero (350/650,
 * entrevista incluida), que es lo correcto. Lo que NO se hace es tocar un
 * cobro ya apuntado: si la entrevista se manda a cobro DESPUÉS de seguir, el
 * de 350 € ya está en Cobros y ahí lo arregla una persona. Por eso
 * `avisoDeOrden` existe: para decirlo antes de que pase, no después.
 *
 * Lo que no está aquí: quién puede cobrar (`lib/citas/quienDaBonos.js`, la
 * misma regla que parar y seguir) y cómo se escribe la fila de `payments`
 * (`lib/billing/cobroDelBono.js`, que es la frontera céntimos/euros).
 */

import { ENTREVISTA, ROTULO_ESTADO } from "./diagnostico.js";

/** Las dos fases, en el orden en que se cobran. */
export const FASE_ENTREVISTA = "entrevista";
export const FASE_PRODUCTO = "producto";
export const FASES = Object.freeze([FASE_ENTREVISTA, FASE_PRODUCTO]);

/** Estados en los que todavía tiene sentido apuntar la entrevista. */
const ESTADOS_CON_ENTREVISTA = Object.freeze(["entrevista", "en_curso", "no_continua"]);

const redondea = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** ¿Es una fase de las que existen? */
export function esFase(v) {
  return FASES.includes(String(v ?? "").trim());
}

/**
 * En qué anda un cobro ya apuntado: `cobrado`, `pendiente`, `devuelto` o
 * `otro` (un estado que no conocemos: se enseña tal cual y no se toca).
 */
export function estadoDeCobro(cobro) {
  const c = cobro?.toJSON ? cobro.toJSON() : cobro;
  if (!c || typeof c !== "object" || !c.id) return null;
  if (c.refundedAt || c.refunded_at || c.status === "refunded") return "devuelto";
  if (c.status === "completed") return "cobrado";
  if (c.status === "pending") return "pendiente";
  return "otro";
}

export const ROTULO_ESTADO_COBRO = Object.freeze({
  cobrado: "cobrado",
  pendiente: "pendiente de cobro",
  devuelto: "devuelto",
  otro: "apuntado",
});

/**
 * El cobro del PRODUCTO entre los del expediente: el de su bono
 * (`payments.pack_id`). Se prefiere uno vivo —pendiente o cobrado— sobre uno
 * devuelto: un producto devuelto y vuelto a cobrar tiene las dos filas, y la
 * fase la manda la viva. PURO.
 */
export function cobroDeProductoEntre(expediente, cobros) {
  const packId = expediente?.packId ?? expediente?.pack_id ?? null;
  if (!packId) return null;
  const lista = (Array.isArray(cobros) ? cobros : []).filter(Boolean).map((c) => (c.toJSON ? c.toJSON() : c));
  const suyos = lista.filter((c) => String(c.packId ?? c.pack_id ?? "") === String(packId));
  if (!suyos.length) return null;
  return suyos.find((c) => estadoDeCobro(c) !== "devuelto") ?? suyos[0];
}

/**
 * Lo que cuesta la fase de la ENTREVISTA: el importe del concepto del centro
 * si lo tiene, y si no los 50 € de fábrica. Se le pasa lo que devuelve
 * `cobroDeLaEntrevista(concepto)`; sin nada, los 50 €.
 */
export function importeDeLaEntrevista(cobroEntrevista = null) {
  const n = Number(cobroEntrevista?.importeEuros);
  return Number.isFinite(n) && n >= 0 ? redondea(n) : ENTREVISTA.importeEuros;
}

/**
 * LAS DOS FASES de un expediente, ya cruzadas con lo que hay apuntado y con
 * quién mira. Es lo que la ficha pinta y lo que el endpoint vuelve a
 * comprobar antes de escribir.
 *
 *   expediente     la fila de `diagnosticos` (status, packId)
 *   cobroEntrevista  su fila de `payments` de la entrevista, o null
 *   cobroProducto    su fila de `payments` del bono, o null
 *   importeEntrevista  euros de la fase 1 (`importeDeLaEntrevista`)
 *   cobroDelProducto   lo que devuelve `cobroDelProducto` para ESTE
 *                      expediente (`cobroAlSeguir` de la fila): de ahí sale el
 *                      importe de la fase 2, ya con la entrevista descontada
 *   puedeDecidir     `puedeDarBonos` de quien mira
 *
 * Cada fase: `{ clave, titulo, importe, estadoCobro, rotuloCobro, cobroId,
 * puedeGenerar, motivo }`. `motivo` es por qué NO se puede generar (lo que
 * enseña el botón apagado y lo que devuelve el 409/422), null si se puede.
 */
export function fasesDeCobro({
  expediente,
  cobroEntrevista = null,
  cobroProducto = null,
  importeEntrevista = ENTREVISTA.importeEuros,
  cobroDelProducto = null,
  puedeDecidir = false,
} = {}) {
  const e = expediente?.toJSON ? expediente.toJSON() : (expediente ?? {});
  const status = e.status ?? null;
  const rotulo = ROTULO_ESTADO[status] ?? status ?? "cerrado";
  const puede = puedeDecidir === true;

  const estadoEntrevista = estadoDeCobro(cobroEntrevista);
  const estadoProducto = estadoDeCobro(cobroProducto);
  const importeProducto = cobroDelProducto?.importeEuros ?? cobroDelProducto?.importe ?? null;

  const fase = (clave, titulo, importe, estadoCobro, cobroId, motivo) => ({
    clave,
    titulo,
    importe: importe === null || importe === undefined ? null : redondea(importe),
    estadoCobro,
    rotuloCobro: estadoCobro ? ROTULO_ESTADO_COBRO[estadoCobro] ?? estadoCobro : null,
    cobroId: cobroId ?? null,
    puedeGenerar: !motivo,
    motivo: motivo ?? null,
  });

  return {
    entrevista: fase(
      FASE_ENTREVISTA,
      "Entrevista inicial",
      importeEntrevista,
      estadoEntrevista,
      cobroEntrevista?.id ?? null,
      motivoDeEntrevista({ puede, status, rotulo, estadoEntrevista, importeEntrevista })
    ),
    producto: fase(
      FASE_PRODUCTO,
      e.productoNombre || "Diagnóstico",
      importeProducto,
      estadoProducto,
      cobroProducto?.id ?? null,
      motivoDeProducto({ puede, status, rotulo, estadoProducto, importeProducto, packId: e.packId ?? null })
    ),
  };
}

/** Por qué no se puede mandar a cobro la entrevista, o null. */
function motivoDeEntrevista({ puede, status, rotulo, estadoEntrevista, importeEntrevista }) {
  if (!puede) return MOTIVO_SIN_PERMISO_COBRO;
  if (estadoEntrevista) return `La entrevista ya está ${ROTULO_ESTADO_COBRO[estadoEntrevista] ?? estadoEntrevista}`;
  if (!ESTADOS_CON_ENTREVISTA.includes(status)) return `Este diagnóstico está en «${rotulo}»: ya no admite cobros nuevos`;
  if (!(Number(importeEntrevista) > 0)) return "La entrevista de este centro no tiene precio: ponlo en el concepto «Entrevista Inicial»";
  return null;
}

/** Por qué no se puede mandar a cobro el producto, o null. */
function motivoDeProducto({ puede, status, rotulo, estadoProducto, importeProducto, packId }) {
  if (!puede) return MOTIVO_SIN_PERMISO_COBRO;
  if (estadoProducto) return `El diagnóstico ya está ${ROTULO_ESTADO_COBRO[estadoProducto] ?? estadoProducto}`;
  if (status !== "en_curso") {
    return status === "entrevista"
      ? "Pulsa «Seguir con el diagnóstico»: el cobro del producto nace con su bono"
      : `Este diagnóstico está en «${rotulo}»: ya no admite cobros nuevos`;
  }
  if (!packId) return "Este diagnóstico no tiene bono: pulsa «Seguir con el diagnóstico» antes de cobrarlo";
  if (importeProducto === null) return "No hay precio para este producto: ponlo en su concepto del catálogo o en Configuración → Diagnósticos";
  if (!(Number(importeProducto) > 0)) return "Ya no queda nada por cobrar de este producto";
  return null;
}

/**
 * La frase del 403 de cobrar: la misma regla que parar, seguir y desbloquear
 * (`lib/citas/quienDaBonos.js`), dicha para lo que es.
 */
export const MOTIVO_SIN_PERMISO_COBRO = "Solo dirección o quien lleve Facturación puede mandar a cobro un diagnóstico";

/**
 * El aviso que la pantalla enseña ANTES de pulsar «Seguir» cuando la
 * entrevista no se ha mandado a cobro todavía: el producto nacerá entero.
 * Null cuando no hay nada que avisar. PURO.
 */
export function avisoDeOrden({ cobroEntrevista = null, cobroDelProducto = null } = {}) {
  if (cobroEntrevista) return null;
  const importe = cobroDelProducto?.importeEuros ?? cobroDelProducto?.importe ?? null;
  if (importe === null || !(Number(importe) > 0)) return null;
  return "La entrevista inicial aún no se ha mandado a cobro: el diagnóstico nacerá con su precio entero (la entrevista va dentro). Si quieres cobrarla aparte, mándala a cobro antes de seguir.";
}

/** El texto del cobro de la entrevista cuando el centro no tiene concepto. */
export const TEXTO_ENTREVISTA_SIN_CONCEPTO = ENTREVISTA.textoSinConcepto;
