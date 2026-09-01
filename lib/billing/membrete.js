/**
 * membrete — qué logo y qué pie viste cada documento de facturación
 * (31/08/2026).
 *
 * La factura lleva su membrete de siempre (`logoUrl` + `invoiceFooterText`).
 * El presupuesto tiene los suyos (`quoteLogoUrl` + `quoteFooterText`) y, si
 * están VACÍOS, cae a los de la factura: así un centro con un solo membrete no
 * configura nada dos veces, y uno que quiera vestir el presupuesto distinto
 * (que es un documento comercial, no fiscal) rellena solo lo suyo.
 *
 * La regla es UNA y con nombre para que el PDF de descarga, el del correo y el
 * del lote no decidan cada uno por su cuenta.
 */
export function membreteDe(settings, documento) {
  const s = settings || {};
  const texto = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (documento === "presupuesto") {
    return {
      logoUrl: texto(s.quoteLogoUrl) || texto(s.logoUrl),
      footerText: texto(s.quoteFooterText) || texto(s.invoiceFooterText),
    };
  }
  return {
    logoUrl: texto(s.logoUrl),
    footerText: texto(s.invoiceFooterText),
  };
}
