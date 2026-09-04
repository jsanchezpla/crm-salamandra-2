/**
 * Fuente única de estados de un lead de Captación (`OutreachLead.status`).
 *
 * Es el seguimiento MANUAL del comercial: a quién he escrito o llamado ya, y a
 * quién he decidido no perseguir. Contesta la pregunta «¿por dónde iba?» cuando
 * la lista trae sesenta empresas y se trabaja a ratos.
 *
 * No se solapa con los otros dos rastros, que siguen siendo la verdad de lo suyo:
 *   · `converted` (+ clientId)  ya es cliente; manda sobre el status en la UI.
 *   · `analysis.sentAt`         el CRM envió el correo modelo de esa línea.
 *
 * `status` es STRING en BD y no ENUM (igual que `source`): añadir un estado no
 * debe exigir una migración de tipo en todos los tenants. Esta lista es la que
 * valida los endpoints para que no entren valores arbitrarios desde el front.
 */

export const LEAD_STATUSES = ["new", "contacted", "discarded"];

export const LEAD_STATUS_LABELS = {
  new: "Sin contactar",
  contacted: "Contactado",
  discarded: "Descartado",
};

export const DEFAULT_LEAD_STATUS = "new";

export function isAllowedLeadStatus(value) {
  return typeof value === "string" && LEAD_STATUSES.includes(value);
}

/** Etiqueta humana de un lead, teniendo en cuenta que ser cliente manda. */
export function leadStatusLabel(lead) {
  if (lead?.converted) return "Cliente";
  return LEAD_STATUS_LABELS[lead?.status] ?? LEAD_STATUS_LABELS[DEFAULT_LEAD_STATUS];
}
