/**
 * recuperacionFalta — el nombre que la falta necesitaba (31/08/2026, Rodrigo):
 * la justificada ES la recuperable. Aquí vive esa equivalencia y la regla de
 * qué citas pueden apuntarse como «la que la recupera» — antes eso se cuadraba
 * a mano entre compañeras y no quedaba escrito en ningún sitio.
 */

export function esRecuperable(booking) {
  return booking?.status === "no_show" && booking?.noShowJustified === true;
}

/** El rótulo de la falta, con la palabra que usa el centro DELANTE. */
export function rotuloFalta(booking) {
  if (booking?.status !== "no_show") return null;
  return booking.noShowJustified
    ? "Falta recuperable (justificada)"
    : "Falta no recuperable (sin justificar)";
}

/**
 * Qué citas pueden recuperar esta falta: otras citas del MISMO cliente,
 * vivas (una cancelada o otra falta no recuperan nada), y POSTERIORES a la
 * falta — la recuperación viene después, no antes. Ordenadas por fecha para
 * que la más cercana salga la primera.
 */
export function citasQuePuedenRecuperar(citas, falta) {
  if (!falta?.id) return [];
  const cuando = new Date(falta.scheduledAt ?? 0).getTime();
  return (Array.isArray(citas) ? citas : [])
    .filter((c) => c && c.id !== falta.id)
    .filter((c) => !falta.clientId || c.clientId === falta.clientId)
    .filter((c) => ["pending", "confirmed", "completed"].includes(c.status))
    .filter((c) => new Date(c.scheduledAt ?? 0).getTime() > cuando)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
}
