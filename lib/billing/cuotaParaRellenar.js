/**
 * lib/billing/cuotaParaRellenar.js — de qué se rellena la cuota de una familia
 * en las pantallas de dinero, y cuándo se puede pisar lo que ya hay escrito
 * (01/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad decidible SIN base de datos de
 * «al elegir a la familia, ponme su cuota». Cobros y Facturas lo resolvían cada
 * uno por su cuenta dentro del JSX y los dos se equivocaban en lo mismo, así
 * que la decisión se saca aquí y la fija `scripts/_smoke-cuota-para-rellenar.mjs`
 * sin levantar nada.)
 *
 * ── LOS DOS FALLOS QUE LO TRAEN ────────────────────────────────────────────
 *
 * 1. **Se quedaba la cuota del paciente ANTERIOR** (Rodrigo, 01/09/2026: «cuando
 *    cambio de paciente se queda fija la cuota del paciente anterior»). Las dos
 *    pantallas rellenaban al elegir familia, pero cuando la siguiente no tenía
 *    cuota conocida se salían sin haber borrado: en pantalla quedaban los
 *    conceptos —y el IMPORTE— de la otra familia, y ese importe es el que se
 *    cobra. En Aumenta, 827 de las 1.087 fichas no tienen cuota conocida.
 *
 * 2. **Solo salía UNA cuota.** Una familia puede tener varias filas en
 *    `billing_cuotas` (una por hijo) y las paga todas. Facturas cogía
 *    `cuotas[0]` y facturaba al primer hermano en silencio.
 *
 * La regla, entonces: con paciente elegido, lo suyo; sin paciente, todo lo de
 * la familia; y lo que se rellenó solo se puede volver a rellenar solo.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Las cuotas que entran al rellenar.
 *
 * Con paciente elegido, las DE ESE paciente: dos hermanos pagan cosas distintas
 * y una factura es de uno. Si NINGUNA es suya, las de la familia entera — una
 * cuota puede no tener paciente asignado (las 260 de Aumenta vienen así del
 * volcado de Organízate) y dejar la pantalla vacía por eso sería esconder lo
 * único que se sabe.
 *
 * Sin paciente elegido, todas: la factura es de la familia y la familia paga
 * las dos.
 */
export function cuotasQueEntran(cuotas, patientId = null) {
  const lista = Array.isArray(cuotas) ? cuotas : [];
  if (!patientId) return lista;
  const suyas = lista.filter((c) => String(c?.patientId ?? "") === String(patientId));
  return suyas.length ? suyas : lista;
}

/**
 * Los ids de concepto de esas cuotas, en su orden y **sin deduplicar**: dos
 * hermanos con la misma terapia son dos líneas, no una.
 */
export function conceptosDeCuotas(cuotas) {
  return (Array.isArray(cuotas) ? cuotas : []).flatMap((c) =>
    Array.isArray(c?.conceptIds) ? c.conceptIds.map(String) : []
  );
}

/**
 * El importe PACTADO con la familia (la suma de los `amount` escritos), o null
 * si hay que calcularlo desde el catálogo.
 *
 * Solo manda si TODAS sus cuotas lo tienen escrito: mezclar un precio pactado
 * con otro que va «a lo que digan sus conceptos» no se puede sumar sin mentir,
 * y ahí gana el catálogo, que es lo que el usuario ve línea a línea.
 *
 * Sin esto se cobraba la tarifa a quien tenía otro precio acordado.
 */
export function importePactado(cuotas) {
  const lista = Array.isArray(cuotas) ? cuotas : [];
  if (!lista.length) return null;
  const escrito = (c) => c?.amount !== null && c?.amount !== undefined && c?.amount !== "";
  if (!lista.every(escrito)) return null;
  return round2(lista.reduce((s, c) => s + (Number(c.amount) || 0), 0));
}

/**
 * La huella de unas líneas de factura: lo justo para saber si alguien las ha
 * tocado desde que las puso la cuota. Se queda con lo que el usuario edita
 * (texto, precio, cantidad, descuento e IVA) y no con el resto del objeto, que
 * cambia por dentro sin que nadie escriba nada.
 */
export function huellaLineas(lineas) {
  return JSON.stringify(
    (Array.isArray(lineas) ? lineas : []).map((l) => [
      String(l?.description ?? "").trim(),
      Number(l?.unitPrice) || 0,
      Number(l?.quantity) || 0,
      Number(l?.discountPct) || 0,
      Number(l?.vatRate) || 0,
    ])
  );
}

/**
 * ¿Se puede escribir encima de lo que hay?
 *
 * Sí cuando está en blanco (nunca hubo nada) o cuando es EXACTAMENTE lo que
 * puso la cuota anterior y nadie lo ha tocado. Lo escrito a mano no se pisa
 * nunca: para eso está el botón «Poner su cuota».
 *
 * La segunda mitad es la que arregla cambiar de familia: antes, lo puesto para
 * la familia anterior ya no estaba «en blanco», así que se quedaba tal cual.
 */
export function sePuedeRellenar({ lineas, enBlanco, huellaPuesta }) {
  if (enBlanco) return true;
  if (huellaPuesta === null || huellaPuesta === undefined) return false;
  return huellaLineas(lineas) === huellaPuesta;
}
