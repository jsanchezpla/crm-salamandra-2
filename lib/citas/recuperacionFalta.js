/**
 * recuperacionFalta — el nombre que la falta necesitaba (31/08/2026, Rodrigo):
 * la justificada ES la recuperable. Aquí vive esa equivalencia y la regla de
 * qué citas pueden apuntarse como «la que la recupera» — antes eso se cuadraba
 * a mano entre compañeras y no quedaba escrito en ningún sitio.
 */

export function esRecuperable(booking) {
  return booking?.status === "no_show" && booking?.noShowJustified === true;
}

/**
 * El rótulo de la falta.
 *
 * Delante va JUSTIFICADA o INJUSTIFICADA (01/09/2026, Rodrigo): es lo que se
 * decide al marcarla —son los dos botones de la ficha de la cita— y lo que hay
 * que reconocer de un vistazo en una lista. «Recuperable» se queda detrás,
 * entre paréntesis, porque sigue siendo la consecuencia que importa cuando hay
 * que cuadrar una recuperación (31/08/2026), pero no es el nombre del hecho.
 */
export function rotuloFalta(booking) {
  if (booking?.status !== "no_show") return null;
  return booking.noShowJustified
    ? "Falta justificada (recuperable)"
    : "Falta injustificada (no se recupera)";
}

/**
 * Cuántos días ANTES de la falta puede estar la cita que la recupera
 * (15/09/2026, AV-0139 de Aumenta). Hasta entonces solo valían las
 * posteriores, pero una falta avisada con tiempo se recupera a menudo
 * ADELANTANDO la sesión («falta el 30 y se la hago el 29»). Con tope, para que
 * una familia con 130 citas no vea en la lista sesiones viejas que no
 * recuperan nada.
 */
export const DIAS_ANTES_RECUPERACION = 7;

/** Desde cuándo hay que pedir citas al servidor para esta falta (ISO). */
export function desdeParaRecuperar(falta) {
  const cuando = new Date(falta?.scheduledAt ?? 0).getTime();
  return new Date(cuando - DIAS_ANTES_RECUPERACION * 86400000).toISOString();
}

/**
 * Qué citas pueden recuperar esta falta: otras citas del MISMO cliente, vivas
 * (una cancelada o otra falta no recuperan nada), posteriores a la falta o
 * hasta DIAS_ANTES_RECUPERACION días antes. Ordenadas por cercanía a la falta,
 * sea antes o después, para que la probable salga la primera.
 */
export function citasQuePuedenRecuperar(citas, falta) {
  if (!falta?.id) return [];
  const cuando = new Date(falta.scheduledAt ?? 0).getTime();
  const desde = cuando - DIAS_ANTES_RECUPERACION * 86400000;
  const distancia = (c) => Math.abs(new Date(c.scheduledAt).getTime() - cuando);
  return (Array.isArray(citas) ? citas : [])
    .filter((c) => c && c.id !== falta.id)
    .filter((c) => !falta.clientId || c.clientId === falta.clientId)
    .filter((c) => ["pending", "confirmed", "completed"].includes(c.status))
    .filter((c) => c.scheduledAt && new Date(c.scheduledAt).getTime() >= desde)
    .sort((a, b) => distancia(a) - distancia(b));
}
